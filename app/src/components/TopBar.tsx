// SPDX-License-Identifier: AGPL-3.0-only

import * as Popover from "@radix-ui/react-popover";
import { ArrowLeft, Check, ChevronDown, Clock3, FileText, Plus } from "lucide-react";
import type { RuntimeCreativeProjectSnapshot, RuntimeWorkspace } from "../api/runtime-api";
import { formatDate } from "../runtime/presentation";
import { projectView, workspaceLabel } from "../runtime/view-model";
import { IconButton } from "./ui";

export function TopBar({
  title,
  workspace,
  onWorkspaceChange,
  onBack,
  mode,
  projects,
  activeProjectId,
  saved,
  onProjectChange,
  onNewProject,
}: {
  title: string;
  workspace: RuntimeWorkspace;
  onWorkspaceChange: (workspace: RuntimeWorkspace) => void;
  onBack: () => void;
  mode: "home" | "workspace";
  projects: RuntimeCreativeProjectSnapshot[];
  activeProjectId?: string;
  saved: boolean;
  onProjectChange: (id: string) => void;
  onNewProject: () => void;
}) {
  return (
    <header className="top-bar">
      <div className="top-bar__identity">
        <IconButton label={mode === "workspace" ? "返回主页" : "查看全部项目"} onClick={onBack}>
          <ArrowLeft size={20} />
        </IconButton>
        {mode === "workspace" ? (
          <Popover.Root>
            <Popover.Trigger asChild>
              <button type="button" className="project-switcher-trigger" title={title} aria-label="切换项目">
                <span>{title}</span>
                <ChevronDown size={15} />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content className="project-switcher" align="start" sideOffset={10} collisionPadding={16}>
                <div className="project-switcher__heading">切换项目</div>
                <div className="project-switcher__list">
                  {projects.slice(0, 4).map((snapshot) => {
                    const project = projectView(snapshot);
                    return (
                      <Popover.Close asChild key={project.id}>
                        <button
                          type="button"
                          className={project.id === activeProjectId ? "project-switcher__item is-current" : "project-switcher__item"}
                          onClick={() => onProjectChange(project.id)}
                        >
                          <FileText size={17} />
                          <span>
                            <strong>{project.title}</strong>
                            <small>{workspaceLabel(project.lastWorkspace)} · {project.checkpointLabel}</small>
                          </span>
                          <span className="project-switcher__time">
                            {project.id === activeProjectId ? <Check size={14} /> : formatDate(project.updatedAt)}
                          </span>
                        </button>
                      </Popover.Close>
                    );
                  })}
                </div>
                <Popover.Close asChild>
                  <button type="button" className="project-switcher__new" onClick={onNewProject}>
                    <Plus size={16} /> 新建项目
                  </button>
                </Popover.Close>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        ) : (
          <div className="top-bar__title" title={title}>{title}</div>
        )}
        <span className={saved ? "save-status is-saved" : "save-status"}>{saved ? <><Check size={13} />已保存</> : null}</span>
      </div>

      <nav className={mode === "workspace" ? "space-tabs" : "space-tabs is-disabled"} aria-label="创作空间">
        <button type="button" className={workspace === "cocreate" ? "is-active" : ""} aria-current={workspace === "cocreate" ? "page" : undefined} onClick={() => mode === "workspace" && onWorkspaceChange("cocreate")} aria-disabled={mode !== "workspace"}>共创</button>
        <button type="button" className={workspace === "review" ? "is-active" : ""} aria-current={workspace === "review" ? "page" : undefined} onClick={() => mode === "workspace" && onWorkspaceChange("review")} aria-disabled={mode !== "workspace"}>终稿审阅</button>
      </nav>

      <div className="top-bar__actions">
        <button type="button" className="quiet-button" disabled title="有正式版本后可查看">
          <Clock3 size={16} />版本历史
        </button>
      </div>
    </header>
  );
}
