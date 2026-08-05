// SPDX-License-Identifier: AGPL-3.0-only

import { GatewayError } from "../../src/domain/errors.js";
import type { ModelEvent, ModelGateway, ModelRequest } from "../../src/model/model-gateway.js";

export type TestGatewayOutcome =
  | { type: "success"; output: unknown; deltas?: readonly string[]; delayMs?: number }
  | { type: "failure"; code: string; message: string; delayMs?: number };

export class TestModelGateway implements ModelGateway {
  readonly adapterKind = "test-adapter";
  readonly modelId = "test-model";
  readonly #outcomes: TestGatewayOutcome[];

  constructor(outcomes: readonly TestGatewayOutcome[]) {
    this.#outcomes = [...outcomes];
  }

  async *stream(_request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    const outcome = this.#outcomes.shift();
    if (!outcome) throw new GatewayError("test_outcome_missing", "No test gateway outcome was configured");

    await abortableDelay(outcome.delayMs ?? 0, signal);
    if (outcome.type === "failure") throw new GatewayError(outcome.code, outcome.message);
    for (const text of outcome.deltas ?? []) yield { type: "delta", text };
    yield { type: "output", value: outcome.output };
  }
}

export function validDirectionProposal(label = "A focused direction"): unknown {
  return {
    schemaVersion: 1,
    label,
    summary: "A schema-valid proposal produced only by the injected test gateway.",
    nextDecision: "Review the direction before applying it.",
  };
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  if (delayMs === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(): Error {
  const error = new Error("The test model run was cancelled");
  error.name = "AbortError";
  return error;
}
