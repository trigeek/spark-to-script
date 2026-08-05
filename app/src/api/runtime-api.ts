// SPDX-License-Identifier: AGPL-3.0-only

export const runtimeStatuses = [
  "queued",
  "running",
  "awaiting_user",
  "completed",
  "failed",
  "cancelled",
] as const;
export type RuntimeStatus = (typeof runtimeStatuses)[number];

export type RuntimeWorkspace = "cocreate" | "review";

export type RuntimeCreativeIntent = {
  initialPrompt: string;
};

export type RuntimeCreativeProject = {
  id: string;
  title: string;
  creativeIntent: RuntimeCreativeIntent;
  lastWorkspace: RuntimeWorkspace;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeRun = {
  id: string;
  projectId: string;
  kind: "research" | "directions" | "structure" | "draft" | "revision";
  status: RuntimeStatus;
  adapterKind: string;
  modelId: string;
  inputSnapshot: { creativeIntent: RuntimeCreativeIntent };
  outputRef: string | null;
  errorCode: string | null;
  errorSummary: string | null;
  retryOfRunId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type RuntimeArtifact = {
  id: string;
  runId: string;
  projectId: string;
  kind: "creative-direction-proposal";
  schemaVersion: 1;
  status: "proposed";
  payload: {
    schemaVersion: 1;
    label: string;
    summary: string;
    nextDecision: string;
  };
  createdAt: string;
};

export type RuntimeRunSnapshot = {
  run: RuntimeRun;
  artifact: RuntimeArtifact | null;
  events: RuntimeRunEvent[];
  lastEventId: number;
};

export type RuntimeCreativeProjectSnapshot = {
  project: RuntimeCreativeProject;
  latestRun: RuntimeRunSnapshot | null;
};

export type RuntimeConfiguration =
  | { modelGatewayConfigured: true; setupError: null }
  | {
    modelGatewayConfigured: false;
    setupError: { code: "model_gateway_not_configured"; message: string };
  };

export type RuntimeRunEventPayloads = {
  "run.queued": { status: "queued" };
  "run.started": { status: "running" };
  "model.started": { adapterKind: string; modelId: string };
  "model.delta": { text: string };
  "proposal.validating": { schema: "creative-direction-proposal@1" };
  "artifact.proposed": { artifactId: string; artifactKind: RuntimeArtifact["kind"] };
  "run.awaiting_user": { status: "awaiting_user" };
  "run.completed": { status: "completed" };
  "run.failed": { code: string; summary: string };
  "run.cancelled": { status: "cancelled" };
};

export type RuntimeRunEventOf<T extends RuntimeEventType> = {
  id: number;
  runId: string;
  type: T;
  payload: RuntimeRunEventPayloads[T];
  createdAt: string;
};

export type RuntimeRunEvent = {
  [T in RuntimeEventType]: RuntimeRunEventOf<T>;
}[RuntimeEventType];

const runtimeKinds = ["research", "directions", "structure", "draft", "revision"] as const;
const runtimeEventTypes = [
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
export type RuntimeEventType = (typeof runtimeEventTypes)[number];

export interface RuntimeApiClient {
  getRuntimeConfiguration(): Promise<RuntimeConfiguration>;
  listProjects(): Promise<RuntimeCreativeProjectSnapshot[]>;
  getProject(projectId: string): Promise<RuntimeCreativeProjectSnapshot>;
  createProject(initialPrompt: string): Promise<RuntimeCreativeProject>;
  updateProjectWorkspace(projectId: string, lastWorkspace: RuntimeWorkspace): Promise<RuntimeCreativeProject>;
  createRun(projectId: string): Promise<RuntimeRunSnapshot>;
  getRun(runId: string): Promise<RuntimeRunSnapshot>;
  cancelRun(runId: string): Promise<RuntimeRunSnapshot>;
  retryRun(runId: string): Promise<RuntimeRunSnapshot>;
  subscribeToRunEvents(
    runId: string,
    afterEventId: number,
    onEvent: (event: RuntimeRunEvent) => void,
    onDisconnect: () => void,
  ): () => void;
}

export const runtimeApi: RuntimeApiClient = {
  async getRuntimeConfiguration() {
    return decodeRuntimeConfiguration(await request("/api/health"));
  },

  async listProjects() {
    const value = await request("/api/projects");
    const record = requireRecord(value, "projects response");
    if (!Array.isArray(record.projects)) throw new Error("projects response is invalid");
    return record.projects.map(decodeProjectSnapshot);
  },

  async getProject(projectId) {
    return decodeProjectSnapshot(await request(`/api/projects/${encodeURIComponent(projectId)}`));
  },

  async createProject(initialPrompt) {
    const value = requireRecord(await request("/api/projects", {
      method: "POST",
      body: JSON.stringify({ creativeIntent: { initialPrompt } }),
    }), "create project response");
    return decodeProject(value.project);
  },

  async updateProjectWorkspace(projectId, lastWorkspace) {
    const value = requireRecord(await request(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      body: JSON.stringify({ lastWorkspace }),
    }), "update project response");
    return decodeProject(value.project);
  },

  async createRun(projectId) {
    return decodeRunSnapshot(await request(`/api/projects/${encodeURIComponent(projectId)}/runs`, {
      method: "POST",
      body: JSON.stringify({ kind: "research" }),
    }));
  },

  async getRun(runId) {
    return decodeRunSnapshot(await request(`/api/runs/${encodeURIComponent(runId)}`));
  },

  async cancelRun(runId) {
    return decodeRunSnapshot(await request(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }));
  },

  async retryRun(runId) {
    return decodeRunSnapshot(await request(`/api/runs/${encodeURIComponent(runId)}/retry`, { method: "POST" }));
  },

  subscribeToRunEvents(runId, afterEventId, onEvent, onDisconnect) {
    const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events?after=${afterEventId}`);
    source.onmessage = (message) => {
      try {
        const event = decodeRunEvent(JSON.parse(message.data) as unknown);
        onEvent(event);
        if (isSettledRunEventType(event.type)) source.close();
      } catch {
        source.close();
        onDisconnect();
      }
    };
    source.onerror = () => {
      source.close();
      onDisconnect();
    };
    return () => source.close();
  },
};

function decodeRuntimeConfiguration(value: unknown): RuntimeConfiguration {
  const record = requireRecord(value, "runtime configuration");
  if (record.status !== "ok" || typeof record.modelGatewayConfigured !== "boolean") {
    throw new Error("runtime configuration is invalid");
  }
  if (record.modelGatewayConfigured) {
    if (record.setupError !== null) throw new Error("configured runtime must not include a setup error");
    return { modelGatewayConfigured: true, setupError: null };
  }
  const setupError = requireRecord(record.setupError, "runtime configuration.setupError");
  if (setupError.code !== "model_gateway_not_configured") {
    throw new Error("runtime configuration setup error is invalid");
  }
  return {
    modelGatewayConfigured: false,
    setupError: {
      code: "model_gateway_not_configured",
      message: requireString(setupError.message, "runtime configuration.setupError.message"),
    },
  };
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const value = await response.json() as unknown;
  if (!response.ok) {
    const message = readApiErrorMessage(value) ?? `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return value;
}

function decodeProjectSnapshot(value: unknown): RuntimeCreativeProjectSnapshot {
  const record = requireRecord(value, "project snapshot");
  return {
    project: decodeProject(record.project),
    latestRun: record.latestRun === null ? null : decodeRunSnapshot(record.latestRun),
  };
}

function decodeProject(value: unknown): RuntimeCreativeProject {
  const record = requireRecord(value, "project");
  const creativeIntent = requireRecord(record.creativeIntent, "project.creativeIntent");
  const lastWorkspace = requireString(record.lastWorkspace, "project.lastWorkspace");
  if (lastWorkspace !== "cocreate" && lastWorkspace !== "review") {
    throw new Error("project.lastWorkspace is invalid");
  }
  return {
    id: requireString(record.id, "project.id"),
    title: requireString(record.title, "project.title"),
    creativeIntent: {
      initialPrompt: requireString(creativeIntent.initialPrompt, "project.creativeIntent.initialPrompt"),
    },
    lastWorkspace,
    createdAt: requireString(record.createdAt, "project.createdAt"),
    updatedAt: requireString(record.updatedAt, "project.updatedAt"),
  };
}

function decodeRunSnapshot(value: unknown): RuntimeRunSnapshot {
  const record = requireRecord(value, "run snapshot");
  if (!Array.isArray(record.events)) throw new Error("run snapshot.events must be an array");
  return {
    run: decodeRun(record.run),
    artifact: record.artifact === null ? null : decodeArtifact(record.artifact),
    events: record.events.map(decodeRunEvent),
    lastEventId: requireNumber(record.lastEventId, "run snapshot.lastEventId"),
  };
}

function decodeRun(value: unknown): RuntimeRun {
  const record = requireRecord(value, "run");
  const status = requireString(record.status, "run.status");
  if (!runtimeStatuses.includes(status as RuntimeStatus)) throw new Error("run.status is invalid");
  const kind = requireString(record.kind, "run.kind");
  if (!runtimeKinds.includes(kind as RuntimeRun["kind"])) throw new Error("run.kind is invalid");
  const input = requireRecord(record.inputSnapshot, "run.inputSnapshot");
  const creativeIntent = requireRecord(input.creativeIntent, "run.inputSnapshot.creativeIntent");
  return {
    id: requireString(record.id, "run.id"),
    projectId: requireString(record.projectId, "run.projectId"),
    kind: kind as RuntimeRun["kind"],
    status: status as RuntimeStatus,
    adapterKind: requireString(record.adapterKind, "run.adapterKind"),
    modelId: requireString(record.modelId, "run.modelId"),
    inputSnapshot: {
      creativeIntent: {
        initialPrompt: requireString(creativeIntent.initialPrompt, "run.inputSnapshot.creativeIntent.initialPrompt"),
      },
    },
    outputRef: requireNullableString(record.outputRef, "run.outputRef"),
    errorCode: requireNullableString(record.errorCode, "run.errorCode"),
    errorSummary: requireNullableString(record.errorSummary, "run.errorSummary"),
    retryOfRunId: requireNullableString(record.retryOfRunId, "run.retryOfRunId"),
    startedAt: requireNullableString(record.startedAt, "run.startedAt"),
    completedAt: requireNullableString(record.completedAt, "run.completedAt"),
    createdAt: requireString(record.createdAt, "run.createdAt"),
  };
}

function decodeArtifact(value: unknown): RuntimeArtifact {
  const record = requireRecord(value, "artifact");
  const payload = requireRecord(record.payload, "artifact.payload");
  if (record.kind !== "creative-direction-proposal" || record.schemaVersion !== 1 || record.status !== "proposed") {
    throw new Error("artifact shape is unsupported");
  }
  if (payload.schemaVersion !== 1) throw new Error("artifact payload schema is unsupported");
  return {
    id: requireString(record.id, "artifact.id"),
    runId: requireString(record.runId, "artifact.runId"),
    projectId: requireString(record.projectId, "artifact.projectId"),
    kind: "creative-direction-proposal",
    schemaVersion: 1,
    status: "proposed",
    payload: {
      schemaVersion: 1,
      label: requireString(payload.label, "artifact.payload.label"),
      summary: requireString(payload.summary, "artifact.payload.summary"),
      nextDecision: requireString(payload.nextDecision, "artifact.payload.nextDecision"),
    },
    createdAt: requireString(record.createdAt, "artifact.createdAt"),
  };
}

function decodeRunEvent(value: unknown): RuntimeRunEvent {
  const record = requireRecord(value, "run event");
  const rawType = requireString(record.type, "run event.type");
  if (!runtimeEventTypes.includes(rawType as RuntimeEventType)) throw new Error("run event.type is invalid");
  const type = rawType as RuntimeEventType;
  const payload = requireRecord(record.payload, "run event.payload");
  const common = {
    id: requireNumber(record.id, "run event.id"),
    runId: requireString(record.runId, "run event.runId"),
    createdAt: requireString(record.createdAt, "run event.createdAt"),
  };

  switch (type) {
    case "run.queued":
      return { ...common, type, payload: { status: requireLiteral(payload.status, "queued", "run.queued.status") } };
    case "run.started":
      return { ...common, type, payload: { status: requireLiteral(payload.status, "running", "run.started.status") } };
    case "model.started":
      return {
        ...common,
        type,
        payload: {
          adapterKind: requireString(payload.adapterKind, "model.started.adapterKind"),
          modelId: requireString(payload.modelId, "model.started.modelId"),
        },
      };
    case "model.delta":
      return { ...common, type, payload: { text: requireString(payload.text, "model.delta.text") } };
    case "proposal.validating":
      return {
        ...common,
        type,
        payload: {
          schema: requireLiteral(
            payload.schema,
            "creative-direction-proposal@1",
            "proposal.validating.schema",
          ),
        },
      };
    case "artifact.proposed":
      return {
        ...common,
        type,
        payload: {
          artifactId: requireString(payload.artifactId, "artifact.proposed.artifactId"),
          artifactKind: requireLiteral(
            payload.artifactKind,
            "creative-direction-proposal",
            "artifact.proposed.artifactKind",
          ),
        },
      };
    case "run.awaiting_user":
      return {
        ...common,
        type,
        payload: { status: requireLiteral(payload.status, "awaiting_user", "run.awaiting_user.status") },
      };
    case "run.completed":
      return { ...common, type, payload: { status: requireLiteral(payload.status, "completed", "run.completed.status") } };
    case "run.failed":
      return {
        ...common,
        type,
        payload: {
          code: requireString(payload.code, "run.failed.code"),
          summary: requireString(payload.summary, "run.failed.summary"),
        },
      };
    case "run.cancelled":
      return { ...common, type, payload: { status: requireLiteral(payload.status, "cancelled", "run.cancelled.status") } };
  }
}

export function isSettledRunEventType(type: RuntimeEventType): boolean {
  return type === "run.awaiting_user" || type === "run.completed" || type === "run.failed" || type === "run.cancelled";
}

function readApiErrorMessage(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.error) || typeof value.error.message !== "string") return null;
  return value.error.message;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function requireNullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requireString(value, label);
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a number`);
  return value;
}

function requireLiteral<const T extends string | number>(value: unknown, expected: T, label: string): T {
  if (value !== expected) throw new Error(`${label} must be ${String(expected)}`);
  return expected;
}
