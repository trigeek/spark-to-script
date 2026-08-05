// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo, useState } from "react";
import { runtimeApi, type RuntimeApiClient } from "./api/runtime-api";
import { CoCreateSpace } from "./components/CoCreateSpace";
import { ProjectsScreen } from "./components/ProjectsScreen";
import { ReviewSpace } from "./components/ReviewSpace";
import { StartScreen } from "./components/StartScreen";
import { TopBar } from "./components/TopBar";
import { useCreativeRuntime } from "./runtime/use-creative-runtime";

type Screen = "home" | "projects" | "workspace";

export default function App({ client = runtimeApi }: { client?: RuntimeApiClient }) {
  const initialProjectId = useMemo(readProjectId, []);
  const [screen, setScreen] = useState<Screen>(initialProjectId ? "workspace" : "home");
  const runtime = useCreativeRuntime(client, initialProjectId);
  const workspace = runtime.activeProject?.project.lastWorkspace ?? "cocreate";

  const openProject = async (projectId: string) => {
    await runtime.openProject(projectId);
    setProjectId(projectId);
    setScreen("workspace");
  };

  const startProject = async (initialPrompt: string) => {
    const snapshot = await runtime.startProject(initialPrompt);
    setProjectId(snapshot.project.id);
    setScreen("workspace");
  };

  const showHome = () => {
    setProjectId(null);
    setScreen("home");
  };

  if (screen === "projects" && !runtime.loading) {
    return <ProjectsScreen projects={runtime.projects} onOpen={(id) => void openProject(id).catch(() => undefined)} onNew={showHome} />;
  }

  return (
    <div className="app-shell">
      <TopBar
        title={screen === "workspace" ? runtime.activeProject?.project.title ?? "恢复项目" : "新项目"}
        workspace={workspace}
        mode={screen === "workspace" ? "workspace" : "home"}
        projects={runtime.projects}
        activeProjectId={runtime.activeProject?.project.id}
        saved={screen === "workspace" && Boolean(runtime.activeProject)}
        onProjectChange={(id) => void openProject(id).catch(() => undefined)}
        onNewProject={showHome}
        onWorkspaceChange={(next) => void runtime.changeWorkspace(next)}
        onBack={() => screen === "workspace" ? showHome() : setScreen("projects")}
      />
      {runtime.error ? <div className="global-error" role="alert">{runtime.error}</div> : null}
      {runtime.loading ? (
        <main className="start-screen is-searching" aria-live="polite"><div className="searching-state"><span>正在恢复项目</span><h1>从本地运行时读取真实状态…</h1></div></main>
      ) : screen === "home" ? (
        <StartScreen starting={runtime.starting} onStart={(prompt) => void startProject(prompt).catch(() => undefined)} recentProjects={runtime.projects} onOpenProject={(id) => void openProject(id).catch(() => undefined)} onMoreProjects={() => setScreen("projects")} />
      ) : runtime.activeProject ? (
        <div className="workspace-stack">
          <div className={workspace === "cocreate" ? "workspace-layer is-visible" : "workspace-layer"} aria-hidden={workspace !== "cocreate"}>
            <CoCreateSpace snapshot={runtime.activeProject} events={runtime.events} onCancel={() => void runtime.cancelRun()} onRetry={() => void runtime.retryRun()} />
          </div>
          <div className={workspace === "review" ? "workspace-layer is-visible" : "workspace-layer"} aria-hidden={workspace !== "review"}>
            <ReviewSpace />
          </div>
        </div>
      ) : (
        <main className="start-screen"><div className="searching-state"><span>无法恢复</span><h1>没有找到这个项目</h1><button type="button" className="primary-button" onClick={showHome}>返回主页</button></div></main>
      )}
    </div>
  );
}

function readProjectId(): string | null {
  return new URL(window.location.href).searchParams.get("project");
}

function setProjectId(projectId: string | null): void {
  const url = new URL(window.location.href);
  if (projectId) url.searchParams.set("project", projectId);
  else url.searchParams.delete("project");
  window.history.replaceState({}, "", url);
}
