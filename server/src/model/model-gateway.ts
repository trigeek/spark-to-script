// SPDX-License-Identifier: AGPL-3.0-only

import type { RunInputSnapshot, RunKind } from "../domain/entities.js";

export type ModelRequest = {
  runId: string;
  task: RunKind;
  input: RunInputSnapshot;
};

export type ModelEvent =
  | { type: "delta"; text: string }
  | { type: "output"; value: unknown };

export interface ModelGateway {
  readonly adapterKind: string;
  readonly modelId: string;
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
}
