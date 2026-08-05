// SPDX-License-Identifier: AGPL-3.0-only

import type { RuntimeStatus } from "../api/runtime-api";

const statusLabels: Record<RuntimeStatus, string> = {
  queued: "等待运行",
  running: "真实运行中",
  awaiting_user: "提案待审阅",
  completed: "已完成",
  failed: "运行失败，可恢复",
  cancelled: "已取消，可重试",
};

export function statusLabel(status: RuntimeStatus | null): string {
  return status ? statusLabels[status] : "尚未运行";
}

export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
