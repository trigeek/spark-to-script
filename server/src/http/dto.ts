// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord, runKinds, type CreativeIntent, type RunKind, type WorkspaceView } from "../domain/entities.js";
import { DomainError } from "../domain/errors.js";

export type CreateProjectInput = { creativeIntent: CreativeIntent };
export type CreateRunInput = { kind: RunKind };
export type UpdateProjectInput = { lastWorkspace: WorkspaceView };

export function decodeCreateProject(value: unknown): CreateProjectInput {
  requireObjectWithKeys(value, ["creativeIntent"]);
  const creativeIntent = value.creativeIntent;
  requireObjectWithKeys(creativeIntent, ["initialPrompt"]);
  if (typeof creativeIntent.initialPrompt !== "string") {
    throw new DomainError("invalid_request", "creativeIntent.initialPrompt must be a string");
  }
  return { creativeIntent: { initialPrompt: creativeIntent.initialPrompt } };
}

export function decodeCreateRun(value: unknown): CreateRunInput {
  requireObjectWithKeys(value, ["kind"]);
  if (!isRunKind(value.kind)) {
    throw new DomainError("invalid_request", "kind must be a supported AgentRun kind");
  }
  return { kind: value.kind };
}

export function decodeUpdateProject(value: unknown): UpdateProjectInput {
  requireObjectWithKeys(value, ["lastWorkspace"]);
  if (value.lastWorkspace !== "cocreate" && value.lastWorkspace !== "review") {
    throw new DomainError("invalid_request", "lastWorkspace must be cocreate or review");
  }
  return { lastWorkspace: value.lastWorkspace };
}

function isRunKind(value: unknown): value is RunKind {
  return typeof value === "string" && runKinds.some((kind) => kind === value);
}

function requireObjectWithKeys(
  value: unknown,
  allowedKeys: readonly string[],
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new DomainError("invalid_request", "Request body must be an object");
  const unexpectedKey = Object.keys(value).find((key) => !allowedKeys.includes(key));
  if (unexpectedKey) throw new DomainError("invalid_request", `Unexpected request field: ${unexpectedKey}`);
}
