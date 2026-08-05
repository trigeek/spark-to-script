// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isRecord } from "../src/domain/entities.js";
import { createSparkToScriptRuntime, type SparkToScriptRuntime } from "../src/runtime.js";
import type { ModelGateway } from "../src/model/model-gateway.js";
import { TestModelGateway, validDirectionProposal } from "./support/test-model-gateway.js";

let runtime: SparkToScriptRuntime | null = null;
let temporaryDirectory: string | null = null;

afterEach(async () => {
  await runtime?.close();
  runtime = null;
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = null;
});

describe("Spark to Script HTTP and SSE", () => {
  it("creates generic records and replays only committed events after the SSE cursor", async () => {
    const baseUrl = await startRuntime(new TestModelGateway([{
      type: "success",
      deltas: ["Preparing a direction"],
      output: validDirectionProposal(),
    }]));
    const projectResponse = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creativeIntent: { initialPrompt: "Explain a difficult idea clearly" } }),
    });
    expect(projectResponse.status).toBe(201);
    const projectId = readNestedString(await projectResponse.json(), "project", "id");

    const runResponse = await fetch(`${baseUrl}/api/projects/${projectId}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "directions" }),
    });
    expect(runResponse.status).toBe(201);
    const runId = readNestedString(await runResponse.json(), "run", "id");

    const eventResponse = await fetch(`${baseUrl}/api/runs/${runId}/events?after=0`);
    expect(eventResponse.headers.get("content-type")).toContain("text/event-stream");
    const events = parseSse(await eventResponse.text());
    expect(events[0]?.type).toBe("run.queued");
    expect(events.at(-1)?.type).toBe("run.awaiting_user");

    const snapshotResponse = await fetch(`${baseUrl}/api/runs/${runId}`);
    const snapshot = await snapshotResponse.json();
    expect(readNestedString(snapshot, "run", "status")).toBe("awaiting_user");
    expect(readNumber(snapshot, "lastEventId")).toBe(events.at(-1)?.id);

    const artifactEvent = events.find((event) => event.type === "artifact.proposed");
    if (!artifactEvent) throw new Error("Expected an artifact.proposed event");
    const replayResponse = await fetch(`${baseUrl}/api/runs/${runId}/events?after=${artifactEvent.id}`);
    const replay = parseSse(await replayResponse.text());
    expect(replay.map((event) => event.type)).toEqual(["run.awaiting_user"]);
  });

  it("returns setup-required before writing a run when production has no gateway", async () => {
    const baseUrl = await startRuntime();
    const healthResponse = await fetch(`${baseUrl}/api/health`);
    expect(healthResponse.status).toBe(200);
    const healthBody = await healthResponse.json();
    expect(readBoolean(healthBody, "modelGatewayConfigured")).toBe(false);
    expect(readNestedString(healthBody, "setupError", "code")).toBe("model_gateway_not_configured");

    const projectResponse = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creativeIntent: { initialPrompt: "A local pre-alpha project" } }),
    });
    const projectId = readNestedString(await projectResponse.json(), "project", "id");

    const runResponse = await fetch(`${baseUrl}/api/projects/${projectId}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "research" }),
    });
    expect(runResponse.status).toBe(503);
    const errorBody = await runResponse.json();
    expect(readNestedString(errorBody, "error", "code")).toBe("model_gateway_not_configured");

    const projectSnapshot = await fetch(`${baseUrl}/api/projects/${projectId}`).then((response) => response.json());
    expect(readNullableField(projectSnapshot, "latestRun")).toBeNull();
  });

  it("decodes unknown input safely and exposes no compatibility route", async () => {
    const baseUrl = await startRuntime();
    const response = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creativeIntent: { initialPrompt: 42 }, apiKey: "must-not-echo" }),
    });
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toContain("invalid_request");
    expect(body).not.toContain("must-not-echo");

    const legacyResponse = await fetch(`${baseUrl}/api/episodes`);
    expect(legacyResponse.status).toBe(404);
  });
});

async function startRuntime(gateway?: ModelGateway): Promise<string> {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "spark-to-script-http-"));
  const options: { databasePath: string; gateway?: ModelGateway } = {
    databasePath: join(temporaryDirectory, "runtime.sqlite"),
  };
  if (gateway) options.gateway = gateway;
  runtime = createSparkToScriptRuntime(options);
  await runtime.recover();
  await new Promise<void>((resolve) => runtime?.server.listen(0, "127.0.0.1", resolve));
  const address = runtime.server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP listener address");
  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

type ParsedSseEvent = { id: number; type: string };

function parseSse(text: string): ParsedSseEvent[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => decodeSseEvent(JSON.parse(line.slice(6)) as unknown));
}

function decodeSseEvent(value: unknown): ParsedSseEvent {
  if (!isRecord(value) || typeof value.id !== "number" || typeof value.type !== "string") {
    throw new Error("Expected an SSE run event");
  }
  return { id: value.id, type: value.type };
}

function readNestedString(value: unknown, outerKey: string, innerKey: string): string {
  if (!isRecord(value) || !isRecord(value[outerKey]) || typeof value[outerKey][innerKey] !== "string") {
    throw new Error(`Expected ${outerKey}.${innerKey} to be a string`);
  }
  return value[outerKey][innerKey];
}

function readNumber(value: unknown, key: string): number {
  if (!isRecord(value) || typeof value[key] !== "number") throw new Error(`Expected ${key} to be a number`);
  return value[key];
}

function readBoolean(value: unknown, key: string): boolean {
  if (!isRecord(value) || typeof value[key] !== "boolean") throw new Error(`Expected ${key} to be a boolean`);
  return value[key];
}

function readNullableField(value: unknown, key: string): unknown {
  if (!isRecord(value) || !(key in value)) throw new Error(`Expected ${key} to exist`);
  return value[key];
}
