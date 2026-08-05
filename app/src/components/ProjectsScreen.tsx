// SPDX-License-Identifier: AGPL-3.0-only

import { ArrowRight, AudioLines, FileText, Plus } from "lucide-react";
import type { RuntimeCreativeProjectSnapshot } from "../api/runtime-api";
import { formatDate } from "../runtime/presentation";
import { projectView, workspaceLabel } from "../runtime/view-model";

export function ProjectsScreen({ projects, onOpen, onNew }: { projects: RuntimeCreativeProjectSnapshot[]; onOpen: (id: string) => void; onNew: () => void }) {
  return (
    <main className="projects-screen">
      <header className="projects-header">
        <div className="projects-brand"><AudioLines size={20} aria-hidden="true" /><span>Spark to Script</span></div>
        <button type="button" className="primary-button" onClick={onNew}>新建项目 <Plus size={16} /></button>
      </header>
      <div className="projects-content">
        <div className="projects-title-row"><div><h1>你的内容项目</h1><p>从上次停下的地方继续，项目与真实运行记录保存在本地。</p></div><span>共 {projects.length} 个项目</span></div>
        <div className="project-table" aria-label="内容项目">
          <div className="project-table__head" aria-hidden="true"><span>项目标题</span><span>当前进度</span><span>材料</span><span>版本</span><span>更新时间</span><span>操作</span></div>
          {projects.map((snapshot) => {
            const project = projectView(snapshot);
            return (
              <button key={project.id} type="button" className="project-table__row" onClick={() => onOpen(project.id)}>
                <span className="project-table__title"><FileText size={20} /><span><strong>{project.title}</strong><small>{workspaceLabel(project.lastWorkspace)} · {project.checkpointLabel}</small></span></span>
                <span>{project.checkpointLabel}</span><span>{project.materialCount} 份</span><span>{project.draftLabel}</span><span>{formatDate(project.updatedAt)}</span><span className="project-table__action">继续创作 <ArrowRight size={15} /></span>
              </button>
            );
          })}
          {projects.length === 0 ? <div className="runtime-table-empty">还没有项目。新建项目后会在这里留下可恢复入口。</div> : null}
        </div>
      </div>
    </main>
  );
}
