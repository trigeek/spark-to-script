// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { runtimeApi } from "./api/runtime-api";
import type {
  RuntimeApiClient,
  RuntimeArtifact,
  RuntimeCreativeProject,
  RuntimeCreativeProjectSnapshot,
  RuntimeRunEvent,
  RuntimeRunSnapshot,
  RuntimeWorkspace,
  RuntimeStatus,
} from "./api/runtime-api";

afterEach(() => {
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});

describe("Spark to Script runtime surface", () => {
  it("keeps the original shell, material rail and progress strip around a real run", async () => {
    const user = userEvent.setup();
    const client = new TestRuntimeClient();
    const { container } = renderApp(client);

    expect(await screen.findByRole("heading", { name: "这次你想讲什么？" })).toBeInTheDocument();
    expect(container.querySelector(".top-bar")).toBeInTheDocument();
    await user.type(screen.getByLabelText("初步想法"), "真实运行如何恢复？");
    await user.click(screen.getByRole("button", { name: /开始共创/ }));

    expect(await screen.findByRole("heading", { name: "等待运行" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "创作材料" })).toBeInTheDocument();
    expect(screen.getByLabelText("创作进度").querySelectorAll("button")).toHaveLength(6);
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();

    const runId = client.latestRun().run.id;
    client.emit(runId, runEvent(runId, 2, "run.started"));
    expect(await screen.findByRole("heading", { name: "真实运行中" })).toBeInTheDocument();

    client.setStatus(runId, "awaiting_user", directionArtifact(runId, client.latestRun().run.projectId));
    client.emit(runId, runEvent(runId, 7, "artifact.proposed"));
    client.emit(runId, runEvent(runId, 8, "run.awaiting_user"));

    expect(await screen.findByRole("heading", { name: "这次创作真正要回答什么？" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /证据支持的创作方向/ })).toBeChecked();
    expect(screen.getByText(/提案记录/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /用这个方向继续/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "发送想法" })).toBeDisabled();
  });

  it("shows a persisted failure and retries into a new queued run", async () => {
    const user = userEvent.setup();
    const client = new TestRuntimeClient();
    renderApp(client);
    await user.type(await screen.findByLabelText("初步想法"), "失败状态");
    await user.click(screen.getByRole("button", { name: /开始共创/ }));

    const failedRunId = client.latestRun().run.id;
    client.setStatus(failedRunId, "failed", null, "provider_timeout", "上游模型超时");
    client.emit(failedRunId, runEvent(failedRunId, 4, "run.failed"));

    expect(await screen.findByText("运行失败，没有生成提案")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /创建新 Run 重试/ }));
    await waitFor(() => expect(client.latestRun().run.id).not.toBe(failedRunId));
    expect(screen.getByRole("heading", { name: "等待运行" })).toBeInTheDocument();
  });

  it("reconstructs a persisted proposal from the project URL on refresh", async () => {
    const client = new TestRuntimeClient();
    const snapshot = client.seedAwaitingProject("project-restored", "刷新后继续");
    window.history.replaceState({}, "", "/?project=project-restored");
    const { container } = renderApp(client);

    expect(await screen.findByRole("heading", { name: "这次创作真正要回答什么？" })).toBeInTheDocument();
    expect(container.querySelector(".direction-compare")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换项目" })).toHaveAttribute("title", snapshot.project.title);
    expect(client.lastSubscribeAfter).toBe(8);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "切换项目" }));
    expect(await screen.findByText("切换项目")).toBeInTheDocument();
    expect(container.ownerDocument.querySelector(".project-switcher")).toBeInTheDocument();
  });

  it("releases the previous run subscription when switching to a project without a run", async () => {
    const user = userEvent.setup();
    const client = new TestRuntimeClient();
    client.seedAwaitingProject("project-with-run", "已有运行的项目");
    const projectWithoutRun = await client.createProject("尚未运行的项目");
    window.history.replaceState({}, "", "/?project=project-with-run");
    renderApp(client);

    expect(await screen.findByRole("heading", { name: "这次创作真正要回答什么？" })).toBeInTheDocument();
    expect(client.activeSubscriptionCount()).toBe(1);

    await user.click(screen.getByRole("button", { name: "切换项目" }));
    await user.click(screen.getByRole("button", { name: new RegExp(projectWithoutRun.title) }));

    expect(await screen.findByRole("heading", { name: "尚未运行" })).toBeInTheDocument();
    expect(client.activeSubscriptionCount()).toBe(0);
  });

  it("keeps exactly two creation spaces and never fabricates a review draft", async () => {
    const user = userEvent.setup();
    const client = new TestRuntimeClient();
    client.seedAwaitingProject("project-two-spaces", "两页 KISS");
    window.history.replaceState({}, "", "/?project=project-two-spaces");
    const { container } = renderApp(client);

    const navigation = await screen.findByRole("navigation", { name: "创作空间" });
    expect(navigation.querySelectorAll("button")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "终稿审阅" }));
    expect(await screen.findByRole("heading", { name: "还没有可审阅的正式草稿" })).toBeInTheDocument();
    expect(container.querySelector(".review-space")).toBeInTheDocument();
    expect(container.querySelector(".review-toolbar")).toBeInTheDocument();
    expect(container.querySelector(".review-bottom-bar")).toBeInTheDocument();
    expect(screen.queryByText(/信任债/)).not.toBeInTheDocument();
  });

  it("restores the original home recent-project rail and document-style project list", async () => {
    const user = userEvent.setup();
    const client = new TestRuntimeClient();
    client.seedAwaitingProject("project-list", "真实项目入口");
    const { container } = renderApp(client);

    expect(await screen.findByRole("heading", { name: "最近项目" })).toBeInTheDocument();
    expect(container.querySelector(".recent-projects__rail")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "更多" }));
    expect(await screen.findByRole("heading", { name: "你的内容项目" })).toBeInTheDocument();
    expect(container.querySelector(".project-table")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /真实项目入口/ })).toBeInTheDocument();
  });

  it("keeps the persisted project but shows no run or proposal when a model gateway is not configured", async () => {
    const user = userEvent.setup();
    const client = new TestRuntimeClient();
    client.modelGatewayConfigured = false;
    renderApp(client);

    await user.type(await screen.findByLabelText("初步想法"), "先保存意图，再配置模型");
    await user.click(screen.getByRole("button", { name: /开始共创/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Configure a model API connection");
    expect(screen.getByRole("heading", { name: "尚未运行" })).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(client.projectSnapshots()[0]?.latestRun).toBeNull();
    expect(client.createRunCalls).toBe(0);
  });

  it("keeps the persisted project and blocks run creation when runtime configuration is invalid", async () => {
    const user = userEvent.setup();
    const client = new TestRuntimeClient();
    client.configurationError = new Error("runtime configuration is invalid");
    renderApp(client);

    await user.type(await screen.findByLabelText("初步想法"), "配置响应必须可信");
    await user.click(screen.getByRole("button", { name: /开始共创/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("runtime configuration is invalid");
    expect(screen.getByRole("heading", { name: "尚未运行" })).toBeInTheDocument();
    expect(client.projectSnapshots()[0]?.latestRun).toBeNull();
    expect(client.createRunCalls).toBe(0);
  });

  it("validates every SSE payload at the API boundary before components receive it", () => {
    const received = vi.fn();
    const disconnected = vi.fn();
    vi.stubGlobal("EventSource", StubEventSource);

    runtimeApi.subscribeToRunEvents("run-sse", 4, received, disconnected);
    StubEventSource.latest?.emit({
      id: 5,
      runId: "run-sse",
      type: "model.delta",
      payload: { text: "Persisted model text" },
      createdAt: new Date().toISOString(),
    });
    expect(received).toHaveBeenCalledWith(expect.objectContaining({
      type: "model.delta",
      payload: { text: "Persisted model text" },
    }));
    expect(disconnected).not.toHaveBeenCalled();

    StubEventSource.latest?.emit({
      id: 6,
      runId: "run-sse",
      type: "run.failed",
      payload: {},
      createdAt: new Date().toISOString(),
    });
    expect(disconnected).toHaveBeenCalledOnce();
    expect(StubEventSource.latest?.closed).toBe(true);
  });
});

function renderApp(client: RuntimeApiClient) {
  return render(<TooltipProvider><App client={client} /></TooltipProvider>);
}

class TestRuntimeClient implements RuntimeApiClient {
  #projects: RuntimeCreativeProjectSnapshot[] = [];
  #runs = new Map<string, RuntimeRunSnapshot>();
  #listeners = new Map<string, (event: RuntimeRunEvent) => void>();
  #sequence = 0;
  lastSubscribeAfter: number | null = null;
  modelGatewayConfigured = true;
  configurationError: Error | null = null;
  createRunCalls = 0;

  async getRuntimeConfiguration() {
    if (this.configurationError) throw this.configurationError;
    return this.modelGatewayConfigured
      ? { modelGatewayConfigured: true as const, setupError: null }
      : {
        modelGatewayConfigured: false as const,
        setupError: {
          code: "model_gateway_not_configured" as const,
          message: "Configure a model API connection before starting co-creation.",
        },
      };
  }
  async listProjects() { return this.#projects; }
  async getProject(projectId: string) {
    const snapshot = this.#projects.find((item) => item.project.id === projectId);
    if (!snapshot) throw new Error("Project not found");
    return snapshot;
  }
  async createProject(initialPrompt: string) {
    const now = new Date().toISOString();
    const project: RuntimeCreativeProject = {
      id: `project-${++this.#sequence}`,
      title: initialPrompt,
      creativeIntent: { initialPrompt },
      lastWorkspace: "cocreate",
      createdAt: now,
      updatedAt: now,
    };
    this.#projects = [{ project, latestRun: null }, ...this.#projects];
    return project;
  }
  async updateProjectWorkspace(projectId: string, lastWorkspace: RuntimeWorkspace) {
    const snapshot = await this.getProject(projectId);
    const project = { ...snapshot.project, lastWorkspace };
    this.#replaceProject({ ...snapshot, project });
    return project;
  }
  async createRun(projectId: string) {
    this.createRunCalls += 1;
    const snapshot = createRunSnapshot(`run-${++this.#sequence}`, projectId, "queued");
    this.#runs.set(snapshot.run.id, snapshot);
    const project = await this.getProject(projectId);
    this.#replaceProject({ ...project, latestRun: snapshot });
    return snapshot;
  }
  async getRun(runId: string) {
    const snapshot = this.#runs.get(runId);
    if (!snapshot) throw new Error("Run not found");
    return snapshot;
  }
  async cancelRun(runId: string) {
    this.setStatus(runId, "cancelled");
    return this.getRun(runId);
  }
  async retryRun(runId: string) {
    const original = await this.getRun(runId);
    const retry = createRunSnapshot(`run-${++this.#sequence}`, original.run.projectId, "queued", original.run.id);
    this.#runs.set(retry.run.id, retry);
    const project = await this.getProject(original.run.projectId);
    this.#replaceProject({ ...project, latestRun: retry });
    return retry;
  }
  subscribeToRunEvents(runId: string, afterEventId: number, onEvent: (event: RuntimeRunEvent) => void) {
    this.lastSubscribeAfter = afterEventId;
    this.#listeners.set(runId, onEvent);
    return () => this.#listeners.delete(runId);
  }
  emit(runId: string, event: RuntimeRunEvent) {
    const current = this.#runs.get(runId);
    if (current) {
      const updated = {
        ...current,
        events: current.events.some((item) => item.id === event.id) ? current.events : [...current.events, event],
        lastEventId: Math.max(current.lastEventId, event.id),
      };
      this.#runs.set(runId, updated);
      const project = this.#projects.find((item) => item.project.id === current.run.projectId);
      if (project) this.#replaceProject({ ...project, latestRun: updated });
    }
    this.#listeners.get(runId)?.(event);
  }
  latestRun() {
    const run = this.#projects[0]?.latestRun;
    if (!run) throw new Error("No run");
    return run;
  }
  projectSnapshots() {
    return this.#projects;
  }
  activeSubscriptionCount() {
    return this.#listeners.size;
  }
  setStatus(runId: string, status: RuntimeStatus, artifact: RuntimeArtifact | null = null, errorCode: string | null = null, errorSummary: string | null = null) {
    const current = this.#runs.get(runId);
    if (!current) throw new Error("Run not found");
    const updated: RuntimeRunSnapshot = {
      run: { ...current.run, status, errorCode, errorSummary },
      artifact,
      events: current.events,
      lastEventId: current.lastEventId + 1,
    };
    this.#runs.set(runId, updated);
    const project = this.#projects.find((item) => item.project.id === current.run.projectId);
    if (project) this.#replaceProject({ ...project, latestRun: updated });
  }
  seedAwaitingProject(id: string, title: string) {
    const now = new Date().toISOString();
    const project: RuntimeCreativeProject = { id, title, creativeIntent: { initialPrompt: title }, lastWorkspace: "cocreate", createdAt: now, updatedAt: now };
    const run = createRunSnapshot(`run-${id}`, id, "awaiting_user");
    const withArtifact = { ...run, artifact: directionArtifact(run.run.id, id), lastEventId: 8 };
    this.#runs.set(run.run.id, withArtifact);
    const snapshot = { project, latestRun: withArtifact };
    this.#projects = [snapshot];
    return snapshot;
  }
  #replaceProject(snapshot: RuntimeCreativeProjectSnapshot) {
    this.#projects = this.#projects.map((item) => item.project.id === snapshot.project.id ? snapshot : item);
  }
}

class StubEventSource {
  static latest: StubEventSource | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(_url: string) {
    StubEventSource.latest = this;
  }

  emit(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) });
  }

  close(): void {
    this.closed = true;
  }
}

function createRunSnapshot(id: string, projectId: string, status: RuntimeStatus, retryOfRunId: string | null = null): RuntimeRunSnapshot {
  const now = new Date().toISOString();
  return {
    run: {
      id,
      projectId,
      kind: "research",
      status,
      adapterKind: "test-adapter",
      modelId: "test-model",
      inputSnapshot: { creativeIntent: { initialPrompt: "test" } },
      outputRef: null,
      errorCode: null,
      errorSummary: null,
      retryOfRunId,
      startedAt: status === "queued" ? null : now,
      completedAt: status === "awaiting_user" ? now : null,
      createdAt: now,
    },
    artifact: null,
    events: [runEvent(id, 1, "run.queued")],
    lastEventId: 1,
  };
}

function directionArtifact(runId: string, projectId: string): RuntimeArtifact {
  return {
    id: `artifact-${runId}`,
    runId,
    projectId,
    kind: "creative-direction-proposal",
    schemaVersion: 1,
    status: "proposed",
    payload: {
      schemaVersion: 1,
      label: "证据支持的创作方向",
      summary: "从创作者的核心问题展开脚本。",
      nextDecision: "审阅并确认创作方向。",
    },
    createdAt: new Date().toISOString(),
  };
}

function runEvent(runId: string, id: number, type: RuntimeRunEvent["type"]): RuntimeRunEvent {
  const common = { id, runId, createdAt: new Date().toISOString() };
  switch (type) {
    case "run.queued":
      return { ...common, type, payload: { status: "queued" } };
    case "run.started":
      return { ...common, type, payload: { status: "running" } };
    case "model.started":
      return { ...common, type, payload: { adapterKind: "test-adapter", modelId: "test-model" } };
    case "model.delta":
      return { ...common, type, payload: { text: "Persisted test progress" } };
    case "proposal.validating":
      return { ...common, type, payload: { schema: "creative-direction-proposal@1" } };
    case "artifact.proposed":
      return {
        ...common,
        type,
        payload: { artifactId: `artifact-${runId}`, artifactKind: "creative-direction-proposal" },
      };
    case "run.awaiting_user":
      return { ...common, type, payload: { status: "awaiting_user" } };
    case "run.completed":
      return { ...common, type, payload: { status: "completed" } };
    case "run.failed":
      return { ...common, type, payload: { code: "provider_timeout", summary: "Test provider timed out" } };
    case "run.cancelled":
      return { ...common, type, payload: { status: "cancelled" } };
  }
}
