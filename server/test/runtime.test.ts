// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { DomainError } from "../src/domain/errors.js";
import type { RunSnapshot, RunStatus } from "../src/domain/entities.js";
import { createSparkToScriptRuntime, type SparkToScriptRuntime } from "../src/runtime.js";
import { TestModelGateway, validDirectionProposal } from "./support/test-model-gateway.js";

const temporaryDirectories: string[] = [];
const openRuntimes: SparkToScriptRuntime[] = [];

afterEach(async () => {
  while (openRuntimes.length > 0) await openRuntimes.pop()?.close();
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe("Spark to Script runtime foundation", () => {
  it("persists a generic project, durable event order, and one validated proposal", async () => {
    const databasePath = createDatabasePath();
    const gateway = new TestModelGateway([{
      type: "success",
      deltas: ["Planning", "Validating"],
      output: validDirectionProposal(),
    }]);
    const runtime = track(createSparkToScriptRuntime({ databasePath, gateway }));
    const project = runtime.service.createProject({ initialPrompt: "Turn a product insight into a clear script." });
    const created = runtime.service.createRun(project.id, { kind: "directions" });

    const completed = await waitForStatus(runtime, created.run.id, "awaiting_user");
    expect(completed.artifact).toMatchObject({
      projectId: project.id,
      kind: "creative-direction-proposal",
      status: "proposed",
    });
    expect(completed.artifact?.payload.label).toBe("A focused direction");
    expect(runtime.repository.listEvents(created.run.id).map((event) => event.type)).toEqual([
      "run.queued",
      "run.started",
      "model.started",
      "model.delta",
      "model.delta",
      "proposal.validating",
      "artifact.proposed",
      "run.awaiting_user",
    ]);

    await closeTracked(runtime);
    const reopened = track(createSparkToScriptRuntime({ databasePath }));
    const restored = reopened.service.getProject(project.id);
    expect(restored.project.creativeIntent.initialPrompt).toBe("Turn a product insight into a clear script.");
    expect(restored.latestRun?.run.id).toBe(created.run.id);
    expect(restored.latestRun?.artifact?.id).toBe(completed.artifact?.id);
    expect(restored.latestRun?.lastEventId).toBe(completed.lastEventId);
  });

  it("fails before creating a run when no model gateway is configured", () => {
    const runtime = track(createSparkToScriptRuntime({ databasePath: createDatabasePath() }));
    const project = runtime.service.createProject({ initialPrompt: "A creator intent without a model connection" });

    expect(() => runtime.service.createRun(project.id, { kind: "research" })).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "model_gateway_not_configured",
        statusCode: 503,
      }),
    );
    expect(runtime.service.getProject(project.id).latestRun).toBeNull();
  });

  it("rejects invalid model output and persists no artifact", async () => {
    const runtime = track(createSparkToScriptRuntime({
      databasePath: createDatabasePath(),
      gateway: new TestModelGateway([{ type: "success", output: { label: "Incomplete" } }]),
    }));
    const project = runtime.service.createProject({ initialPrompt: "Validate all model output" });
    const created = runtime.service.createRun(project.id, { kind: "directions" });

    const failed = await waitForStatus(runtime, created.run.id, "failed");
    expect(failed.run.errorCode).toBe("invalid_model_output");
    expect(failed.artifact).toBeNull();
    expect(failed.events.at(-1)?.type).toBe("run.failed");
  });

  it("persists a gateway failure without an artifact and retries as a new run", async () => {
    const runtime = track(createSparkToScriptRuntime({
      databasePath: createDatabasePath(),
      gateway: new TestModelGateway([
        { type: "failure", code: "provider_timeout", message: "The configured provider timed out" },
        { type: "success", output: validDirectionProposal("Retry direction") },
      ]),
    }));
    const project = runtime.service.createProject({ initialPrompt: "Recover from a provider failure" });
    const created = runtime.service.createRun(project.id, { kind: "directions" });
    const failed = await waitForStatus(runtime, created.run.id, "failed");
    expect(failed.artifact).toBeNull();
    expect(failed.run.errorCode).toBe("provider_timeout");

    const retry = runtime.service.retryRun(created.run.id);
    expect(retry.run.id).not.toBe(created.run.id);
    expect(retry.run.retryOfRunId).toBe(created.run.id);
    expect(retry.run.inputSnapshot).toEqual(created.run.inputSnapshot);
    const recovered = await waitForStatus(runtime, retry.run.id, "awaiting_user");
    expect(recovered.artifact?.payload.label).toBe("Retry direction");
    expect(runtime.service.getRun(created.run.id).run.status).toBe("failed");
  });

  it("cancels an active run without creating a proposal", async () => {
    const runtime = track(createSparkToScriptRuntime({
      databasePath: createDatabasePath(),
      gateway: new TestModelGateway([{
        type: "success",
        delayMs: 100,
        output: validDirectionProposal(),
      }]),
    }));
    const project = runtime.service.createProject({ initialPrompt: "Cancel a long-running request" });
    const created = runtime.service.createRun(project.id, { kind: "directions" });
    await waitForStatus(runtime, created.run.id, "running");

    const cancelled = runtime.service.cancelRun(created.run.id);
    expect(cancelled.run.status).toBe("cancelled");
    await waitForCondition(() => runtime.repository.listEvents(created.run.id).at(-1)?.type === "run.cancelled");
    expect(runtime.service.getRun(created.run.id).artifact).toBeNull();
  });

  it("recovers an interrupted running record idempotently after restart", async () => {
    const databasePath = createDatabasePath();
    const first = track(createSparkToScriptRuntime({
      databasePath,
      gateway: new TestModelGateway([{ type: "success", output: validDirectionProposal() }]),
    }));
    const project = first.service.createProject({ initialPrompt: "Restore work after a process restart" });
    const created = first.service.createRun(project.id, { kind: "directions" }, { autoStart: false });
    first.repository.markRunRunning(created.run.id, new Date().toISOString());
    await closeTracked(first);

    const restarted = track(createSparkToScriptRuntime({
      databasePath,
      gateway: new TestModelGateway([{ type: "success", output: validDirectionProposal() }]),
    }));
    await restarted.recover();
    const restored = restarted.service.getRun(created.run.id);
    expect(restored.run.status).toBe("awaiting_user");
    expect(restored.artifact).not.toBeNull();

    await restarted.recover();
    const events = restarted.repository.listEvents(created.run.id);
    expect(events.filter((event) => event.type === "artifact.proposed")).toHaveLength(1);
    expect(events.filter((event) => event.type === "run.awaiting_user")).toHaveLength(1);
  });

  it("creates only the generic v1 schema with owner-only local permissions", async () => {
    const databasePath = createDatabasePath();
    const runtime = track(createSparkToScriptRuntime({ databasePath }));
    await closeTracked(runtime);

    if (process.platform !== "win32") {
      expect(statSync(dirname(databasePath)).mode & 0o777).toBe(0o700);
      expect(statSync(databasePath).mode & 0o777).toBe(0o600);
    }

    const database = new DatabaseSync(databasePath, { readOnly: true });
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
      .map((row) => readName(row));
    expect(tables).toContain("creative_projects");
    expect(tables).toContain("agent_runs");
    expect(tables).toContain("run_events");
    expect(tables).toContain("run_artifacts");
    expect(tables).not.toContain("episodes");
    const runColumns = database.prepare("PRAGMA table_info(agent_runs)").all().map((row) => readName(row));
    expect(runColumns).toContain("project_id");
    expect(runColumns).not.toContain("episode_id");
    database.close();
  });
});

async function waitForStatus(
  runtime: SparkToScriptRuntime,
  runId: string,
  expected: RunStatus,
): Promise<RunSnapshot> {
  let latest = runtime.service.getRun(runId);
  await waitForCondition(() => {
    latest = runtime.service.getRun(runId);
    return latest.run.status === expected;
  });
  return latest;
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out while waiting for runtime state");
}

function createDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "spark-to-script-runtime-"));
  temporaryDirectories.push(directory);
  return join(directory, "runtime.sqlite");
}

function track(runtime: SparkToScriptRuntime): SparkToScriptRuntime {
  openRuntimes.push(runtime);
  return runtime;
}

async function closeTracked(runtime: SparkToScriptRuntime): Promise<void> {
  const index = openRuntimes.indexOf(runtime);
  if (index >= 0) openRuntimes.splice(index, 1);
  await runtime.close();
}

function readName(row: unknown): string {
  if (typeof row !== "object" || row === null || !("name" in row) || typeof row.name !== "string") {
    throw new Error("Expected a SQLite name column");
  }
  return row.name;
}
