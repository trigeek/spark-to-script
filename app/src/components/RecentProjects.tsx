// SPDX-License-Identifier: AGPL-3.0-only

import { ArrowRight, Clock3, FolderOpen } from "lucide-react";
import type { RuntimeCreativeProjectSnapshot } from "../api/runtime-api";
import { formatDate } from "../runtime/presentation";
import { projectView, workspaceLabel } from "../runtime/view-model";

export function RecentProjects({ projects, onOpen, onMore }: { projects: RuntimeCreativeProjectSnapshot[]; onOpen: (id: string) => void; onMore: () => void }) {
  if (projects.length === 0) return null;
  return (
    <section className="recent-projects" aria-labelledby="recent-projects-title">
      <div className="recent-projects__heading"><div><FolderOpen size={16} /><h2 id="recent-projects-title">最近项目</h2></div><span>继续上次停下的地方</span></div>
      <div className="recent-projects__rail">
        {projects.slice(0, 3).map((snapshot) => {
          const project = projectView(snapshot);
          return (
            <button key={project.id} type="button" className="recent-project" onClick={() => onOpen(project.id)}>
              <strong>{project.title}</strong>
              <span>{workspaceLabel(project.lastWorkspace)} · {project.checkpointLabel}</span>
              <small><Clock3 size={12} />{project.draftLabel} · {formatDate(project.updatedAt)}</small>
              <ArrowRight className="recent-project__arrow" size={16} />
            </button>
          );
        })}
        <button type="button" className="recent-projects__more" onClick={onMore}><span>更多</span><ArrowRight size={16} /></button>
      </div>
    </section>
  );
}
