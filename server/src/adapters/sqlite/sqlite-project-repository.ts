// SPDX-License-Identifier: AGPL-3.0-only

import { chmodSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ArtifactTransition, ProjectRepository } from "../../application/repository.js";
import {
  isRecord,
  parseCreativeDirectionProposal,
  parseCreativeIntent,
  runEventTypes,
  runKinds,
  runStatuses,
  type AgentRun,
  type CreativeProject,
  type CreativeProjectSnapshot,
  type RunArtifact,
  type RunEvent,
  type RunEventOf,
  type RunEventPayloads,
  type RunEventType,
  type RunInputSnapshot,
  type RunSnapshot,
  type RunStatus,
  type WorkspaceView,
} from "../../domain/entities.js";
import { DomainError } from "../../domain/errors.js";

export class SqliteProjectRepository implements ProjectRepository {
  readonly #database: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") prepareDatabasePath(databasePath);
    this.#database = new DatabaseSync(databasePath);
    if (databasePath !== ":memory:") setOwnerOnlyPermissions(databasePath, 0o600);
    this.#database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    if (databasePath !== ":memory:") setOwnerOnlyPermissions(databasePath, 0o600);
    this.#migrate();
  }

  close(): void {
    this.#database.close();
  }

  createProject(project: CreativeProject): CreativeProject {
    this.#database.prepare(`
      INSERT INTO creative_projects (id, title, creative_intent_json, last_workspace, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      project.id,
      project.title,
      JSON.stringify(project.creativeIntent),
      project.lastWorkspace,
      project.createdAt,
      project.updatedAt,
    );
    return project;
  }

  listProjectSnapshots(): CreativeProjectSnapshot[] {
    const rows = this.#database.prepare("SELECT * FROM creative_projects ORDER BY updated_at DESC").all();
    return rows.map((row) => {
      const project = mapProject(row);
      return { project, latestRun: this.#getLatestRunSnapshot(project.id) };
    });
  }

  getProjectSnapshot(projectId: string): CreativeProjectSnapshot | null {
    const row = this.#database.prepare("SELECT * FROM creative_projects WHERE id = ?").get(projectId);
    if (!row) return null;
    return { project: mapProject(row), latestRun: this.#getLatestRunSnapshot(projectId) };
  }

  updateProjectWorkspace(projectId: string, lastWorkspace: WorkspaceView, updatedAt: string): CreativeProject {
    const result = this.#database.prepare(`
      UPDATE creative_projects SET last_workspace = ?, updated_at = ? WHERE id = ?
    `).run(lastWorkspace, updatedAt, projectId);
    if (result.changes !== 1) {
      throw new DomainError("project_not_found", "Creative project not found", 404);
    }
    const row = this.#database.prepare("SELECT * FROM creative_projects WHERE id = ?").get(projectId);
    if (!row) throw new DomainError("project_not_found", "Creative project not found", 404);
    return mapProject(row);
  }

  createRun(run: AgentRun): { run: AgentRun; event: RunEventOf<"run.queued"> } {
    return this.#transaction(() => {
      this.#database.prepare(`
        INSERT INTO agent_runs (
          id, project_id, kind, status, adapter_kind, model_id, input_snapshot_json,
          output_ref, error_code, error_summary, retry_of_run_id, started_at, completed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        run.id,
        run.projectId,
        run.kind,
        run.status,
        run.adapterKind,
        run.modelId,
        JSON.stringify(run.inputSnapshot),
        run.outputRef,
        run.errorCode,
        run.errorSummary,
        run.retryOfRunId,
        run.startedAt,
        run.completedAt,
        run.createdAt,
      );
      const event = this.#insertEvent(run.id, "run.queued", { status: "queued" }, run.createdAt);
      return { run, event };
    });
  }

  getRun(runId: string): AgentRun | null {
    const row = this.#database.prepare("SELECT * FROM agent_runs WHERE id = ?").get(runId);
    return row ? mapRun(row) : null;
  }

  getRunSnapshot(runId: string): RunSnapshot | null {
    const run = this.getRun(runId);
    if (!run) return null;
    return {
      run,
      artifact: this.#getArtifactForRun(runId),
      events: this.listEvents(runId),
      lastEventId: this.#lastEventId(runId),
    };
  }

  listIncompleteRuns(): AgentRun[] {
    return this.#database.prepare(`
      SELECT * FROM agent_runs WHERE status IN ('queued', 'running') ORDER BY created_at ASC
    `).all().map((row) => mapRun(row));
  }

  markRunRunning(runId: string, startedAt: string): {
    run: AgentRun;
    event: RunEventOf<"run.started"> | null;
  } | null {
    return this.#transaction(() => {
      const current = this.getRun(runId);
      if (!current) return null;
      if (current.status === "running") return { run: current, event: null };
      if (current.status !== "queued") return null;

      this.#database.prepare(`
        UPDATE agent_runs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'
      `).run(startedAt, runId);
      const event = this.#insertEvent(runId, "run.started", { status: "running" }, startedAt);
      const run = this.getRun(runId);
      if (!run) throw new DomainError("run_not_found", "Agent run not found", 404);
      return { run, event };
    });
  }

  appendEvent<T extends RunEventType>(
    runId: string,
    type: T,
    payload: RunEventPayloads[T],
    createdAt: string,
  ): RunEventOf<T> {
    if (!this.getRun(runId)) throw new DomainError("run_not_found", "Agent run not found", 404);
    return this.#insertEvent(runId, type, payload, createdAt);
  }

  hasEvent(runId: string, type: RunEventType): boolean {
    const row = this.#database.prepare(`
      SELECT 1 AS present FROM run_events WHERE run_id = ? AND type = ? LIMIT 1
    `).get(runId, type);
    return Boolean(row);
  }

  listEvents(runId: string, afterEventId = 0): RunEvent[] {
    return this.#database.prepare(`
      SELECT * FROM run_events WHERE run_id = ? AND id > ? ORDER BY id ASC
    `).all(runId, afterEventId).map((row) => mapEvent(row));
  }

  saveArtifactAndAwaitingUser(runId: string, proposed: RunArtifact, completedAt: string): ArtifactTransition {
    return this.#transaction(() => {
      const current = this.getRun(runId);
      if (!current) throw new DomainError("run_not_found", "Agent run not found", 404);
      if (current.status === "failed" || current.status === "cancelled" || current.status === "completed") {
        throw new DomainError("run_not_active", "Run can no longer accept an artifact", 409);
      }
      if (proposed.runId !== runId || proposed.projectId !== current.projectId) {
        throw new DomainError("invalid_artifact_reference", "Artifact does not belong to this run", 409);
      }

      let artifact = this.#getArtifactForRun(runId);
      if (!artifact) {
        this.#database.prepare(`
          INSERT INTO run_artifacts (
            id, run_id, project_id, kind, schema_version, status, payload_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          proposed.id,
          proposed.runId,
          proposed.projectId,
          proposed.kind,
          proposed.schemaVersion,
          proposed.status,
          JSON.stringify(proposed.payload),
          proposed.createdAt,
        );
        artifact = proposed;
      }

      const events: RunEvent[] = [];
      if (current.status !== "awaiting_user") {
        this.#database.prepare(`
          UPDATE agent_runs
          SET status = 'awaiting_user', output_ref = ?, completed_at = ?
          WHERE id = ? AND status IN ('queued', 'running')
        `).run(artifact.id, completedAt, runId);
        events.push(this.#insertEvent(runId, "artifact.proposed", {
          artifactId: artifact.id,
          artifactKind: artifact.kind,
        }, completedAt));
        events.push(this.#insertEvent(
          runId,
          "run.awaiting_user",
          { status: "awaiting_user" },
          completedAt,
        ));
      }

      const run = this.getRun(runId);
      if (!run) throw new DomainError("run_not_found", "Agent run not found", 404);
      return { run, artifact, events };
    });
  }

  failRun(runId: string, code: string, summary: string, completedAt: string): {
    run: AgentRun;
    event: RunEventOf<"run.failed">;
  } | null {
    return this.#transaction(() => {
      const current = this.getRun(runId);
      if (!current) throw new DomainError("run_not_found", "Agent run not found", 404);
      if (current.status !== "queued" && current.status !== "running") return null;

      this.#database.prepare(`
        UPDATE agent_runs
        SET status = 'failed', error_code = ?, error_summary = ?, completed_at = ?
        WHERE id = ? AND status IN ('queued', 'running')
      `).run(code, summary, completedAt, runId);
      const event = this.#insertEvent(runId, "run.failed", { code, summary }, completedAt);
      const run = this.getRun(runId);
      if (!run) throw new DomainError("run_not_found", "Agent run not found", 404);
      return { run, event };
    });
  }

  cancelRun(runId: string, completedAt: string): {
    run: AgentRun;
    event: RunEventOf<"run.cancelled">;
  } | null {
    return this.#transaction(() => {
      const current = this.getRun(runId);
      if (!current) throw new DomainError("run_not_found", "Agent run not found", 404);
      if (current.status !== "queued" && current.status !== "running") return null;

      this.#database.prepare(`
        UPDATE agent_runs
        SET status = 'cancelled', error_code = NULL, error_summary = NULL, completed_at = ?
        WHERE id = ? AND status IN ('queued', 'running')
      `).run(completedAt, runId);
      const event = this.#insertEvent(runId, "run.cancelled", { status: "cancelled" }, completedAt);
      const run = this.getRun(runId);
      if (!run) throw new DomainError("run_not_found", "Agent run not found", 404);
      return { run, event };
    });
  }

  #getLatestRunSnapshot(projectId: string): RunSnapshot | null {
    const row = this.#database.prepare(`
      SELECT * FROM agent_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(projectId);
    if (!row) return null;
    const run = mapRun(row);
    return {
      run,
      artifact: this.#getArtifactForRun(run.id),
      events: this.listEvents(run.id),
      lastEventId: this.#lastEventId(run.id),
    };
  }

  #getArtifactForRun(runId: string): RunArtifact | null {
    const row = this.#database.prepare("SELECT * FROM run_artifacts WHERE run_id = ? LIMIT 1").get(runId);
    return row ? mapArtifact(row) : null;
  }

  #lastEventId(runId: string): number {
    const row = this.#database.prepare(`
      SELECT COALESCE(MAX(id), 0) AS last_event_id FROM run_events WHERE run_id = ?
    `).get(runId);
    return row ? readNumber(row, "last_event_id") : 0;
  }

  #insertEvent<T extends RunEventType>(
    runId: string,
    type: T,
    payload: RunEventPayloads[T],
    createdAt: string,
  ): RunEventOf<T> {
    const result = this.#database.prepare(`
      INSERT INTO run_events (run_id, type, payload_json, created_at) VALUES (?, ?, ?, ?)
    `).run(runId, type, JSON.stringify(payload), createdAt);
    const row = this.#database.prepare("SELECT * FROM run_events WHERE id = ?").get(result.lastInsertRowid);
    if (!row) throw new Error("Failed to read the inserted run event");
    const event = mapEvent(row);
    if (event.type !== type) throw new Error("Inserted run event type did not round-trip");
    return event as RunEventOf<T>;
  }

  #transaction<T>(operation: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const row = this.#database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get();
    const version = row ? readNumber(row, "version") : 0;
    if (version >= 1) return;

    this.#transaction(() => {
      this.#database.exec(`
        CREATE TABLE creative_projects (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          creative_intent_json TEXT NOT NULL,
          last_workspace TEXT NOT NULL CHECK(last_workspace IN ('cocreate', 'review')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE agent_runs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES creative_projects(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK(kind IN ('research', 'directions', 'structure', 'draft', 'revision')),
          status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'awaiting_user', 'completed', 'failed', 'cancelled')),
          adapter_kind TEXT NOT NULL,
          model_id TEXT NOT NULL,
          input_snapshot_json TEXT NOT NULL,
          output_ref TEXT,
          error_code TEXT,
          error_summary TEXT,
          retry_of_run_id TEXT REFERENCES agent_runs(id),
          started_at TEXT,
          completed_at TEXT,
          created_at TEXT NOT NULL
        );

        CREATE INDEX agent_runs_project_created_idx ON agent_runs(project_id, created_at DESC);
        CREATE INDEX agent_runs_status_idx ON agent_runs(status);

        CREATE TABLE run_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX run_events_run_id_id_idx ON run_events(run_id, id);

        CREATE TABLE run_artifacts (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
          project_id TEXT NOT NULL REFERENCES creative_projects(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK(kind = 'creative-direction-proposal'),
          schema_version INTEGER NOT NULL CHECK(schema_version = 1),
          status TEXT NOT NULL CHECK(status = 'proposed'),
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(run_id, kind)
        );
      `);
      this.#database.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)")
        .run(new Date().toISOString());
    });
  }
}

function mapProject(row: unknown): CreativeProject {
  return {
    id: readString(row, "id"),
    title: readString(row, "title"),
    creativeIntent: parseCreativeIntent(readJson(row, "creative_intent_json")),
    lastWorkspace: readEnum(row, "last_workspace", ["cocreate", "review"] as const),
    createdAt: readString(row, "created_at"),
    updatedAt: readString(row, "updated_at"),
  };
}

function mapRun(row: unknown): AgentRun {
  return {
    id: readString(row, "id"),
    projectId: readString(row, "project_id"),
    kind: readEnum(row, "kind", runKinds),
    status: readEnum(row, "status", runStatuses),
    adapterKind: readString(row, "adapter_kind"),
    modelId: readString(row, "model_id"),
    inputSnapshot: parseRunInput(readJson(row, "input_snapshot_json")),
    outputRef: readNullableString(row, "output_ref"),
    errorCode: readNullableString(row, "error_code"),
    errorSummary: readNullableString(row, "error_summary"),
    retryOfRunId: readNullableString(row, "retry_of_run_id"),
    startedAt: readNullableString(row, "started_at"),
    completedAt: readNullableString(row, "completed_at"),
    createdAt: readString(row, "created_at"),
  };
}

function mapEvent(row: unknown): RunEvent {
  const common = {
    id: readNumber(row, "id"),
    runId: readString(row, "run_id"),
    createdAt: readString(row, "created_at"),
  };
  const type = readEnum(row, "type", runEventTypes);
  const payload = readJsonRecord(row, "payload_json");

  switch (type) {
    case "run.queued":
      return { ...common, type, payload: { status: readLiteral(payload, "status", "queued") } };
    case "run.started":
      return { ...common, type, payload: { status: readLiteral(payload, "status", "running") } };
    case "model.started":
      return {
        ...common,
        type,
        payload: {
          adapterKind: readString(payload, "adapterKind"),
          modelId: readString(payload, "modelId"),
        },
      };
    case "model.delta":
      return { ...common, type, payload: { text: readString(payload, "text") } };
    case "proposal.validating":
      return {
        ...common,
        type,
        payload: { schema: readLiteral(payload, "schema", "creative-direction-proposal@1") },
      };
    case "artifact.proposed":
      return {
        ...common,
        type,
        payload: {
          artifactId: readString(payload, "artifactId"),
          artifactKind: readLiteral(payload, "artifactKind", "creative-direction-proposal"),
        },
      };
    case "run.awaiting_user":
      return { ...common, type, payload: { status: readLiteral(payload, "status", "awaiting_user") } };
    case "run.completed":
      return { ...common, type, payload: { status: readLiteral(payload, "status", "completed") } };
    case "run.failed":
      return {
        ...common,
        type,
        payload: { code: readString(payload, "code"), summary: readString(payload, "summary") },
      };
    case "run.cancelled":
      return { ...common, type, payload: { status: readLiteral(payload, "status", "cancelled") } };
  }
}

function mapArtifact(row: unknown): RunArtifact {
  const kind = readLiteral(row, "kind", "creative-direction-proposal");
  const schemaVersion = readLiteral(row, "schema_version", 1);
  const status = readLiteral(row, "status", "proposed");
  return {
    id: readString(row, "id"),
    runId: readString(row, "run_id"),
    projectId: readString(row, "project_id"),
    kind,
    schemaVersion,
    status,
    payload: parseCreativeDirectionProposal(readJson(row, "payload_json")),
    createdAt: readString(row, "created_at"),
  };
}

function parseRunInput(value: unknown): RunInputSnapshot {
  if (!isRecord(value)) throw new Error("Invalid persisted run input");
  return { creativeIntent: parseCreativeIntent(value.creativeIntent) };
}

function readJsonRecord(row: unknown, key: string): Record<string, unknown> {
  const value = readJson(row, key);
  if (!isRecord(value)) throw new Error(`Expected ${key} to contain a JSON object`);
  return value;
}

function readJson(row: unknown, key: string): unknown {
  return JSON.parse(readString(row, key)) as unknown;
}

function readString(row: unknown, key: string): string {
  if (!isRecord(row)) throw new Error("Expected a database row object");
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Expected ${key} to be a string`);
  return value;
}

function readNullableString(row: unknown, key: string): string | null {
  if (!isRecord(row)) throw new Error("Expected a database row object");
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`Expected ${key} to be a nullable string`);
  return value;
}

function readNumber(row: unknown, key: string): number {
  if (!isRecord(row)) throw new Error("Expected a database row object");
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`Expected ${key} to be a number`);
}

function readLiteral<const T extends string | number>(row: unknown, key: string, expected: T): T {
  if (!isRecord(row)) throw new Error("Expected an object");
  if (row[key] !== expected) throw new Error(`Expected ${key} to be ${String(expected)}`);
  return expected;
}

function readEnum<const T extends readonly string[]>(row: unknown, key: string, values: T): T[number] {
  const value = readString(row, key);
  if (!values.includes(value)) throw new Error(`Unexpected ${key}: ${value}`);
  return value;
}

function prepareDatabasePath(databasePath: string): void {
  const directory = dirname(databasePath);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    setOwnerOnlyPermissions(directory, 0o700);
    return;
  }
  if (process.platform !== "win32" && (statSync(directory).mode & 0o077) !== 0) {
    throw new Error("Database directory must be accessible only by its owner");
  }
}

function setOwnerOnlyPermissions(path: string, mode: number): void {
  if (process.platform !== "win32") chmodSync(path, mode);
}
