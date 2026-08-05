// SPDX-License-Identifier: AGPL-3.0-only

import { ArrowRight, FilePlus2, Radio, Sparkles } from "lucide-react";
import { useState } from "react";
import type { RuntimeCreativeProjectSnapshot } from "../api/runtime-api";
import { RecentProjects } from "./RecentProjects";

export function StartScreen({ starting, onStart, recentProjects, onOpenProject, onMoreProjects }: { starting: boolean; onStart: (prompt: string) => void; recentProjects: RuntimeCreativeProjectSnapshot[]; onOpenProject: (id: string) => void; onMoreProjects: () => void }) {
  const [prompt, setPrompt] = useState("");
  return (
    <main className={starting ? "start-screen is-searching" : "start-screen"}>
      <div className="start-screen__content">
        <div className="start-mark"><Sparkles size={22} /></div>
        {starting ? (
          <div className="searching-state" aria-live="polite">
            <span>正在准备这次创作</span>
            <h1>正在创建可恢复项目</h1>
            <div className="search-steps">
              <p className="is-active"><Radio size={17} />等待本地运行时响应</p>
            </div>
          </div>
        ) : (
          <>
            <span>开始一个新项目</span>
            <h1>这次你想讲什么？</h1>
            <p>写下一句还不完整的想法就够了。Agent 只会提出可审阅的建议，不会静默改动正式内容。</p>
            <div className="seed-topic-input">
              <textarea aria-label="初步想法" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：当 AI 编程工具越来越强，我们借来的效率最终要用什么偿还？" autoFocus />
              <div>
                <button type="button" className="quiet-button" disabled title="材料连接将在后续版本开放"><FilePlus2 size={16} />添加一份起始材料</button>
                <button type="button" className="primary-button primary-button--large" disabled={!prompt.trim()} onClick={() => onStart(prompt.trim())}>开始共创 <ArrowRight size={18} /></button>
              </div>
            </div>
            <small>提案必须经过你的审阅和确认后才会应用</small>
          </>
        )}
      </div>
      {!starting ? <RecentProjects projects={recentProjects} onOpen={onOpenProject} onMore={onMoreProjects} /> : null}
    </main>
  );
}
