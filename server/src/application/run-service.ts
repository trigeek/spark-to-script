// SPDX-License-Identifier: AGPL-3.0-only

import { randomUUID } from "node:crypto";
import type { ProjectRepository } from "./repository.js";
import { RunEventBroker } from "./run-event-broker.js";
import { RunExecutor } from "./run-executor.js";
import {
  normalizeCreativeIntent,
  type AgentRun,
  type CreativeIntent,
  type CreativeProject,
  type CreativeProjectSnapshot,
  type RunInputSnapshot,
  type RunKind,
  type RunSnapshot,
  type WorkspaceView,
} from "../domain/entities.js";
import { DomainError } from "../domain/errors.js";
import type { ModelGateway } from "../model/model-gateway.js";

type ConfiguredExecution = {
  gateway: ModelGateway;
  executor: RunExecutor;
};

const modelGatewaySetupError = {
  code: "model_gateway_not_configured",
  message: "Configure a model API connection before starting co-creation.",
} as const;

export type RuntimeConfiguration =
  | { modelGatewayConfigured: true; setupError: null }
  | { modelGatewayConfigured: false; setupError: typeof modelGatewaySetupError };

export class RunService {
  readonly #repository: ProjectRepository;
  readonly #execution: ConfiguredExecution | null;
  readonly #broker: RunEventBroker;
  readonly #now: () => string;

  constructor(
    repository: ProjectRepository,
    execution: ConfiguredExecution | null,
    broker: RunEventBroker,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.#repository = repository;
    this.#execution = execution;
    this.#broker = broker;
    this.#now = now;
  }

  createProject(creativeIntent: CreativeIntent): CreativeProject {
    let normalizedIntent: CreativeIntent;
    try {
      normalizedIntent = normalizeCreativeIntent(creativeIntent);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Creative intent is invalid";
      throw new DomainError("invalid_creative_intent", message);
    }

    const initialPrompt = normalizedIntent.initialPrompt;
    const now = this.#now();
    return this.#repository.createProject({
      id: randomUUID(),
      title: initialPrompt.length > 48 ? `${initialPrompt.slice(0, 48)}…` : initialPrompt,
      creativeIntent: normalizedIntent,
      lastWorkspace: "cocreate",
      createdAt: now,
      updatedAt: now,
    });
  }

  listProjects(): CreativeProjectSnapshot[] {
    return this.#repository.listProjectSnapshots();
  }

  getRuntimeConfiguration(): RuntimeConfiguration {
    return this.#execution
      ? { modelGatewayConfigured: true, setupError: null }
      : { modelGatewayConfigured: false, setupError: modelGatewaySetupError };
  }

  getProject(projectId: string): CreativeProjectSnapshot {
    const snapshot = this.#repository.getProjectSnapshot(projectId);
    if (!snapshot) throw new DomainError("project_not_found", "Creative project not found", 404);
    return snapshot;
  }

  updateProjectWorkspace(projectId: string, workspace: WorkspaceView): CreativeProject {
    return this.#repository.updateProjectWorkspace(projectId, workspace, this.#now());
  }

  createRun(
    projectId: string,
    input: { kind: RunKind },
    options: { autoStart?: boolean } = {},
  ): RunSnapshot {
    const project = this.getProject(projectId).project;
    const execution = this.#requireExecution();
    const createdAt = this.#now();
    const inputSnapshot: RunInputSnapshot = {
      creativeIntent: { ...project.creativeIntent },
    };
    const run: AgentRun = {
      id: randomUUID(),
      projectId,
      kind: input.kind,
      status: "queued",
      adapterKind: execution.gateway.adapterKind,
      modelId: execution.gateway.modelId,
      inputSnapshot,
      outputRef: null,
      errorCode: null,
      errorSummary: null,
      retryOfRunId: null,
      startedAt: null,
      completedAt: null,
      createdAt,
    };
    const created = this.#repository.createRun(run);
    this.#broker.publish(created.event);
    if (options.autoStart !== false) queueMicrotask(() => void execution.executor.start(run.id));
    return { run, artifact: null, events: [created.event], lastEventId: created.event.id };
  }

  getRun(runId: string): RunSnapshot {
    const snapshot = this.#repository.getRunSnapshot(runId);
    if (!snapshot) throw new DomainError("run_not_found", "Agent run not found", 404);
    return snapshot;
  }

  cancelRun(runId: string): RunSnapshot {
    const cancelled = this.#repository.cancelRun(runId, this.#now());
    if (!cancelled) throw new DomainError("run_not_cancellable", "Run is not cancellable", 409);
    this.#execution?.executor.cancelActive(runId);
    this.#broker.publish(cancelled.event);
    return this.getRun(runId);
  }

  retryRun(runId: string): RunSnapshot {
    const original = this.getRun(runId).run;
    if (original.status !== "failed" && original.status !== "cancelled") {
      throw new DomainError("run_not_retryable", "Only failed or cancelled runs can be retried", 409);
    }
    const execution = this.#requireExecution();
    const createdAt = this.#now();
    const retry: AgentRun = {
      id: randomUUID(),
      projectId: original.projectId,
      kind: original.kind,
      status: "queued",
      adapterKind: execution.gateway.adapterKind,
      modelId: execution.gateway.modelId,
      inputSnapshot: { creativeIntent: { ...original.inputSnapshot.creativeIntent } },
      outputRef: null,
      errorCode: null,
      errorSummary: null,
      retryOfRunId: original.id,
      startedAt: null,
      completedAt: null,
      createdAt,
    };
    const created = this.#repository.createRun(retry);
    this.#broker.publish(created.event);
    queueMicrotask(() => void execution.executor.start(retry.id));
    return { run: retry, artifact: null, events: [created.event], lastEventId: created.event.id };
  }

  #requireExecution(): ConfiguredExecution {
    if (!this.#execution) {
      throw new DomainError(
        modelGatewaySetupError.code,
        modelGatewaySetupError.message,
        503,
      );
    }
    return this.#execution;
  }
}
