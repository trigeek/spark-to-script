// SPDX-License-Identifier: AGPL-3.0-only

import { randomUUID } from "node:crypto";
import type { ProjectRepository } from "./repository.js";
import { RunEventBroker } from "./run-event-broker.js";
import {
  parseCreativeDirectionProposal,
  type RunArtifact,
  type RunEvent,
} from "../domain/entities.js";
import { GatewayError } from "../domain/errors.js";
import type { ModelGateway } from "../model/model-gateway.js";

export class RunExecutor {
  readonly #repository: ProjectRepository;
  readonly #gateway: ModelGateway;
  readonly #broker: RunEventBroker;
  readonly #active = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  readonly #now: () => string;
  #isDisposing = false;

  constructor(
    repository: ProjectRepository,
    gateway: ModelGateway,
    broker: RunEventBroker,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.#repository = repository;
    this.#gateway = gateway;
    this.#broker = broker;
    this.#now = now;
  }

  start(runId: string): Promise<void> {
    const existing = this.#active.get(runId);
    if (existing) return existing.promise;

    const controller = new AbortController();
    const promise = this.#execute(runId, controller.signal)
      .finally(() => this.#active.delete(runId));
    this.#active.set(runId, { controller, promise });
    return promise;
  }

  async recoverIncompleteRuns(): Promise<void> {
    await Promise.all(this.#repository.listIncompleteRuns().map((run) => this.start(run.id)));
  }

  cancelActive(runId: string): void {
    this.#active.get(runId)?.controller.abort();
  }

  async dispose(): Promise<void> {
    this.#isDisposing = true;
    const active = [...this.#active.values()];
    for (const { controller } of active) controller.abort();
    await Promise.allSettled(active.map(({ promise }) => promise));
  }

  async #execute(runId: string, signal: AbortSignal): Promise<void> {
    try {
      const transition = this.#repository.markRunRunning(runId, this.#now());
      if (!transition) return;
      if (transition.event) this.#broker.publish(transition.event);

      const recoveredSnapshot = this.#repository.getRunSnapshot(runId);
      if (!recoveredSnapshot || recoveredSnapshot.run.status === "awaiting_user") return;
      if (recoveredSnapshot.artifact) {
        const finalized = this.#repository.saveArtifactAndAwaitingUser(
          runId,
          recoveredSnapshot.artifact,
          this.#now(),
        );
        this.#publish(finalized.events);
        return;
      }

      if (!this.#repository.hasEvent(runId, "model.started")) {
        this.#publishOne(this.#repository.appendEvent(runId, "model.started", {
          adapterKind: this.#gateway.adapterKind,
          modelId: this.#gateway.modelId,
        }, this.#now()));
      }

      let output: unknown;
      for await (const event of this.#gateway.stream({
        runId,
        task: transition.run.kind,
        input: transition.run.inputSnapshot,
      }, signal)) {
        if (event.type === "delta") {
          this.#publishOne(this.#repository.appendEvent(runId, "model.delta", { text: event.text }, this.#now()));
        } else {
          output = event.value;
        }
      }

      if (signal.aborted) return;
      this.#publishOne(this.#repository.appendEvent(runId, "proposal.validating", {
        schema: "creative-direction-proposal@1",
      }, this.#now()));
      const payload = parseCreativeDirectionProposal(output);
      const createdAt = this.#now();
      const artifact: RunArtifact = {
        id: randomUUID(),
        runId,
        projectId: transition.run.projectId,
        kind: "creative-direction-proposal",
        schemaVersion: 1,
        status: "proposed",
        payload,
        createdAt,
      };
      const completed = this.#repository.saveArtifactAndAwaitingUser(runId, artifact, createdAt);
      this.#publish(completed.events);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError" && this.#isDisposing) return;
      const current = this.#repository.getRun(runId);
      if (error instanceof Error && error.name === "AbortError" && current?.status === "cancelled") return;

      const normalized = normalizeRunError(error);
      const failed = this.#repository.failRun(runId, normalized.code, normalized.summary, this.#now());
      if (failed) this.#broker.publish(failed.event);
    }
  }

  #publish(events: RunEvent[]): void {
    for (const event of events) this.#broker.publish(event);
  }

  #publishOne(event: RunEvent): void {
    this.#broker.publish(event);
  }
}

function normalizeRunError(error: unknown): { code: string; summary: string } {
  if (error instanceof GatewayError) return { code: error.code, summary: error.message };
  if (error instanceof Error && error.message.startsWith("Model output")) {
    return { code: "invalid_model_output", summary: "Model output failed schema validation" };
  }
  return { code: "runtime_error", summary: "An unexpected runtime error occurred" };
}
