// SPDX-License-Identifier: AGPL-3.0-only

export type WorkspaceView = "cocreate" | "review";

export type CreativeIntent = {
  initialPrompt: string;
};

export type CreativeProject = {
  id: string;
  title: string;
  creativeIntent: CreativeIntent;
  lastWorkspace: WorkspaceView;
  createdAt: string;
  updatedAt: string;
};

export const runKinds = ["research", "directions", "structure", "draft", "revision"] as const;
export type RunKind = (typeof runKinds)[number];

export const runStatuses = [
  "queued",
  "running",
  "awaiting_user",
  "completed",
  "failed",
  "cancelled",
] as const;
export type RunStatus = (typeof runStatuses)[number];

export type RunInputSnapshot = {
  creativeIntent: CreativeIntent;
};

export type AgentRun = {
  id: string;
  projectId: string;
  kind: RunKind;
  status: RunStatus;
  adapterKind: string;
  modelId: string;
  inputSnapshot: RunInputSnapshot;
  outputRef: string | null;
  errorCode: string | null;
  errorSummary: string | null;
  retryOfRunId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export const runEventTypes = [
  "run.queued",
  "run.started",
  "model.started",
  "model.delta",
  "proposal.validating",
  "artifact.proposed",
  "run.awaiting_user",
  "run.completed",
  "run.failed",
  "run.cancelled",
] as const;
export type RunEventType = (typeof runEventTypes)[number];

export type CreativeDirectionProposal = {
  schemaVersion: 1;
  label: string;
  summary: string;
  nextDecision: string;
};

export type RunArtifact = {
  id: string;
  runId: string;
  projectId: string;
  kind: "creative-direction-proposal";
  schemaVersion: 1;
  status: "proposed";
  payload: CreativeDirectionProposal;
  createdAt: string;
};

export type RunEventPayloads = {
  "run.queued": { status: "queued" };
  "run.started": { status: "running" };
  "model.started": { adapterKind: string; modelId: string };
  "model.delta": { text: string };
  "proposal.validating": { schema: "creative-direction-proposal@1" };
  "artifact.proposed": { artifactId: string; artifactKind: RunArtifact["kind"] };
  "run.awaiting_user": { status: "awaiting_user" };
  "run.completed": { status: "completed" };
  "run.failed": { code: string; summary: string };
  "run.cancelled": { status: "cancelled" };
};

export type RunEventOf<T extends RunEventType> = {
  id: number;
  runId: string;
  type: T;
  payload: RunEventPayloads[T];
  createdAt: string;
};

export type RunEvent = {
  [T in RunEventType]: RunEventOf<T>;
}[RunEventType];

export type RunSnapshot = {
  run: AgentRun;
  artifact: RunArtifact | null;
  events: RunEvent[];
  lastEventId: number;
};

export type CreativeProjectSnapshot = {
  project: CreativeProject;
  latestRun: RunSnapshot | null;
};

const terminalStatuses = new Set<RunStatus>(["completed", "failed", "cancelled"]);

export function isTerminalStatus(status: RunStatus): boolean {
  return terminalStatuses.has(status);
}

export function normalizeCreativeIntent(value: CreativeIntent): CreativeIntent {
  const initialPrompt = value.initialPrompt.trim();
  if (!initialPrompt) throw new Error("Creative intent is required");
  if (initialPrompt.length > 500) throw new Error("Creative intent is too long");
  return { initialPrompt };
}

export function parseCreativeIntent(value: unknown): CreativeIntent {
  if (!isRecord(value) || typeof value.initialPrompt !== "string") {
    throw new Error("Creative intent does not match creative-intent@1");
  }
  return normalizeCreativeIntent({ initialPrompt: value.initialPrompt });
}

export function parseCreativeDirectionProposal(value: unknown): CreativeDirectionProposal {
  if (!isRecord(value)) throw new Error("Model output is not an object");
  if (
    value.schemaVersion !== 1
    || typeof value.label !== "string"
    || typeof value.summary !== "string"
    || typeof value.nextDecision !== "string"
  ) {
    throw new Error("Model output does not match creative-direction-proposal@1");
  }
  return {
    schemaVersion: 1,
    label: value.label,
    summary: value.summary,
    nextDecision: value.nextDecision,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
