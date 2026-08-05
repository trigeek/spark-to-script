// SPDX-License-Identifier: AGPL-3.0-only

import type { RuntimeRun, RuntimeStatus } from "../api/runtime-api";

const steps = [
  { label: "材料就绪", detail: "基础来源" },
  { label: "核心问题", detail: "为什么值得讲" },
  { label: "切入方向", detail: "我们要回答什么" },
  { label: "内容结构", detail: "故事如何展开" },
  { label: "初稿", detail: "形成完整内容" },
  { label: "终稿审阅", detail: "一起打磨发布" },
];

export function ProgressStrip({ status, kind }: { status: RuntimeStatus | null; kind: RuntimeRun["kind"] | null }) {
  const activeIndex = stepIndex(kind);
  return (
    <div className="progress-strip" aria-label="创作进度">
      <div className="progress-strip__track" />
      {steps.map((step, index) => {
        const complete = activeIndex !== null && (index < activeIndex || (index === activeIndex && status === "completed"));
        const active = activeIndex === index && !complete;
        const className = complete ? "is-complete" : active ? "is-active" : "";
        return (
          <button type="button" key={step.label} className={className} disabled>
            <span className="progress-step__index">{index + 1}</span>
            <span className="progress-step__copy"><strong>{step.label}</strong><span>{active ? progressState(status) : complete ? "已完成" : "等待中"}</span><small>{step.detail}</small></span>
          </button>
        );
      })}
    </div>
  );
}

function stepIndex(kind: RuntimeRun["kind"] | null): number | null {
  if (kind === "research") return 0;
  if (kind === "directions") return 2;
  if (kind === "structure") return 3;
  if (kind === "draft") return 4;
  if (kind === "revision") return 5;
  return null;
}

function progressState(status: RuntimeStatus | null): string {
  if (status === "failed") return "运行失败";
  if (status === "cancelled") return "已取消";
  if (status === "awaiting_user") return "待审阅";
  return "进行中";
}
