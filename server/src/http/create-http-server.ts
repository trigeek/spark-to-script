// SPDX-License-Identifier: AGPL-3.0-only

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ProjectRepository } from "../application/repository.js";
import { RunEventBroker } from "../application/run-event-broker.js";
import { RunService } from "../application/run-service.js";
import type { RunEvent, RunStatus } from "../domain/entities.js";
import { DomainError } from "../domain/errors.js";
import { decodeCreateProject, decodeCreateRun, decodeUpdateProject } from "./dto.js";

type HttpDependencies = {
  service: RunService;
  repository: ProjectRepository;
  broker: RunEventBroker;
  onUnexpectedError?: (error: unknown) => void;
};

export function createSparkToScriptHttpServer(dependencies: HttpDependencies): Server {
  return createServer((request, response) => {
    void routeRequest(request, response, dependencies).catch((error: unknown) => {
      handleError(response, error, dependencies.onUnexpectedError);
    });
  });
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: HttpDependencies,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");

  if (method === "GET" && url.pathname === "/api/health") {
    json(response, 200, { status: "ok", ...dependencies.service.getRuntimeConfiguration() });
    return;
  }

  if (method === "GET" && url.pathname === "/api/projects") {
    json(response, 200, { projects: dependencies.service.listProjects() });
    return;
  }

  if (method === "POST" && url.pathname === "/api/projects") {
    const input = decodeCreateProject(await readJsonBody(request));
    json(response, 201, { project: dependencies.service.createProject(input.creativeIntent) });
    return;
  }

  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch) {
    const projectId = decodePathSegment(projectMatch[1]);
    if (method === "GET") {
      json(response, 200, dependencies.service.getProject(projectId));
      return;
    }
    if (method === "PATCH") {
      const input = decodeUpdateProject(await readJsonBody(request));
      json(response, 200, {
        project: dependencies.service.updateProjectWorkspace(projectId, input.lastWorkspace),
      });
      return;
    }
  }

  const createRunMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/runs$/);
  if (method === "POST" && createRunMatch) {
    const projectId = decodePathSegment(createRunMatch[1]);
    const input = decodeCreateRun(await readJsonBody(request));
    json(response, 201, dependencies.service.createRun(projectId, input));
    return;
  }

  const runEventsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
  if (method === "GET" && runEventsMatch) {
    const runId = decodePathSegment(runEventsMatch[1]);
    dependencies.service.getRun(runId);
    const headerCursor = parseCursor(request.headers["last-event-id"]);
    const queryCursor = parseCursor(url.searchParams.get("after"));
    streamEvents(
      request,
      response,
      runId,
      Math.max(headerCursor, queryCursor),
      dependencies.repository,
      dependencies.broker,
    );
    return;
  }

  const runActionMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/(cancel|retry)$/);
  if (method === "POST" && runActionMatch) {
    const runId = decodePathSegment(runActionMatch[1]);
    const action = runActionMatch[2];
    const snapshot = action === "cancel"
      ? dependencies.service.cancelRun(runId)
      : dependencies.service.retryRun(runId);
    json(response, 200, snapshot);
    return;
  }

  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (method === "GET" && runMatch) {
    json(response, 200, dependencies.service.getRun(decodePathSegment(runMatch[1])));
    return;
  }

  throw new DomainError("not_found", "Route not found", 404);
}

function streamEvents(
  request: IncomingMessage,
  response: ServerResponse,
  runId: string,
  afterEventId: number,
  repository: ProjectRepository,
  broker: RunEventBroker,
): void {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let replaying = true;
  let lastWrittenId = afterEventId;
  let closed = false;
  const buffered: RunEvent[] = [];

  let unsubscribe = () => {};
  const close = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    response.end();
  };

  const write = (event: RunEvent) => {
    if (closed || event.id <= lastWrittenId) return;
    response.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
    lastWrittenId = event.id;
    if (settlesStream(event)) close();
  };

  unsubscribe = broker.subscribe(runId, (event) => {
    if (replaying) buffered.push(event);
    else write(event);
  });

  for (const event of repository.listEvents(runId, afterEventId)) write(event);
  replaying = false;
  for (const event of buffered.sort((left, right) => left.id - right.id)) write(event);
  const current = repository.getRunSnapshot(runId);
  if (current && settlesStatus(current.run.status) && current.lastEventId <= lastWrittenId) close();

  request.on("close", close);
}

function settlesStream(event: RunEvent): boolean {
  return event.type === "run.awaiting_user"
    || event.type === "run.completed"
    || event.type === "run.failed"
    || event.type === "run.cancelled";
}

function settlesStatus(status: RunStatus): boolean {
  return status === "awaiting_user"
    || status === "completed"
    || status === "failed"
    || status === "cancelled";
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new DomainError("request_too_large", "Request body is too large", 413);
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new DomainError("invalid_json", "Request body must be valid JSON");
  }
}

function handleError(response: ServerResponse, error: unknown, onUnexpectedError?: (error: unknown) => void): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  if (error instanceof DomainError) {
    json(response, error.statusCode, { error: { code: error.code, message: error.message } });
    return;
  }
  onUnexpectedError?.(error);
  json(response, 500, { error: { code: "internal_error", message: "Unexpected server error" } });
}

function json(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function decodePathSegment(value: string | undefined): string {
  if (!value) throw new DomainError("invalid_path", "Missing resource id");
  try {
    return decodeURIComponent(value);
  } catch {
    throw new DomainError("invalid_path", "Invalid resource id");
  }
}

function parseCursor(value: string | string[] | null | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}
