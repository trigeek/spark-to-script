// SPDX-License-Identifier: AGPL-3.0-only

import { AlertTriangle, ArrowRight, Ban, LockKeyhole, MessageSquareText, RefreshCw, Sparkles, Square } from "lucide-react";
import type { RuntimeCreativeProjectSnapshot, RuntimeRunEvent, RuntimeStatus } from "../api/runtime-api";
import { formatDate, statusLabel } from "../runtime/presentation";
import { MaterialRail } from "./MaterialRail";
import { ProgressStrip } from "./ProgressStrip";

export function CoCreateSpace({ snapshot, events, onCancel, onRetry }: { snapshot: RuntimeCreativeProjectSnapshot; events: RuntimeRunEvent[]; onCancel: () => void; onRetry: () => void }) {
  const run = snapshot.latestRun?.run ?? null;
  const artifact = snapshot.latestRun?.artifact ?? null;
  const displayStatus = run?.status === "queued" && events.some((event) => event.type === "run.started" || event.type === "model.started" || event.type === "model.delta" || event.type === "proposal.validating") ? "running" : run?.status ?? null;
  const active = displayStatus === "queued" || displayStatus === "running";
  const retryable = run?.status === "failed" || run?.status === "cancelled";
  return (
    <main className="cocreate-space">
      <MaterialRail />
      <section className="cocreate-main">
        <div className="cocreate-main__scroll">
          <div className="checkpoint-view direction-view" aria-live="polite">
            <div className="checkpoint-eyebrow"><Sparkles size={17} />Agent 提议的下一步</div>
            <div className="checkpoint-heading-row">
              <div><h1>{artifact ? "这次创作真正要回答什么？" : statusLabel(displayStatus)}</h1><p>{artifact ? "这是 Agent 生成并持久化的方向提案。审阅并明确采用前，它不会改动正式内容。" : runtimeSummary(events, displayStatus)}</p></div>
              <div className="proposal-safety"><LockKeyhole size={15} />采用前不会改动正式内容</div>
            </div>
            {run ? <details className="runtime-run-details"><summary>运行详情</summary><div><span>Run <code>{shortId(run.id)}</code></span><span>{run.adapterKind} / {run.modelId}</span><span>{events.length} 条持久化事件</span><span>{formatDate(run.createdAt)}</span></div></details> : null}
            {run?.status === "failed" ? <div className="runtime-failure" role="alert"><AlertTriangle size={20} /><div><strong>运行失败，没有生成提案</strong><p>{run.errorSummary ?? "后端保留了失败状态，可以创建新的 Run 重试。"}</p><code>{run.errorCode ?? "runtime_error"}</code></div></div> : null}
            {run?.status === "cancelled" ? <div className="runtime-failure is-cancelled"><Ban size={20} /><div><strong>运行已取消</strong><p>已有事件仍保留在数据库中；重试会创建新的 AgentRun。</p></div></div> : null}
            {artifact ? (
              <div className="direction-compare" role="radiogroup" aria-label="创作方向">
                <div role="radio" aria-checked="true" className="direction-row is-selected runtime-direction-row">
                  <span className="direction-radio"><span /></span>
                  <span className="direction-main"><span className="direction-title">{artifact.payload.label}<span className="recommendation">待审阅</span></span><span className="direction-thesis">{artifact.payload.summary}</span><span className="direction-sources">提案记录：Artifact {shortId(artifact.id)}</span></span>
                  <span className="direction-tradeoff"><strong>下一步</strong><span>{artifact.payload.nextDecision}</span></span>
                </div>
              </div>
            ) : null}
            <div className="direction-actions">
              {artifact ? <button type="button" className="primary-button primary-button--large" disabled title="提案应用尚未接入">用这个方向继续 <ArrowRight size={18} /></button> : null}
              {artifact ? <button type="button" className="secondary-button" disabled>让我改一下</button> : null}
              {artifact ? <button type="button" className="secondary-button" disabled>再推演一轮 <RefreshCw size={15} /></button> : null}
              {active ? <button type="button" className="secondary-button runtime-danger" onClick={onCancel}><Square size={14} />取消运行</button> : null}
              {retryable ? <button type="button" className="primary-button primary-button--large" onClick={onRetry}>创建新 Run 重试 <RefreshCw size={16} /></button> : null}
            </div>
            {artifact ? (
              <div className="creator-prompt" aria-disabled="true">
                <MessageSquareText size={16} />
                <span>也可以直接告诉 Agent：对话输入尚未接入</span>
                <button type="button" aria-label="发送想法" disabled><ArrowRight size={16} /></button>
              </div>
            ) : null}
          </div>
        </div>
        <ProgressStrip status={displayStatus} kind={run?.kind ?? null} />
      </section>
    </main>
  );
}

function runtimeSummary(events: RuntimeRunEvent[], status: RuntimeStatus | null): string {
  const latest = events.at(-1);
  if (status === "failed") return "运行失败已经持久化；界面不会补造成功结果。";
  if (status === "cancelled") return "运行已经取消，已提交的状态仍可在刷新后恢复。";
  if (status === null) return "配置模型连接后，Agent 才会开始真实运行。";
  if (!latest) return "正在等待后端写入第一条运行事件。";
  if (latest.type === "proposal.validating") return "后端正在校验提案结构；只有校验通过的 Artifact 才会显示。";
  if (latest.type === "model.delta" && typeof latest.payload.text === "string") return latest.payload.text;
  if (status === "running") return "后端正在执行 Agent 运行；页面只归纳已持久化事件，不展示模拟进度。";
  return "运行已经写入本地数据库，正在等待后端继续处理。";
}

function shortId(id: string): string {
  return id.slice(0, 8);
}
