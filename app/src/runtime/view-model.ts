// SPDX-License-Identifier: AGPL-3.0-only

import type { RuntimeCreativeProjectSnapshot, RuntimeStatus } from "../api/runtime-api";

export type RuntimeCheckpoint =
  | "未开始"
  | "运行准备"
  | "方向提案"
  | "运行失败"
  | "运行取消"
  | "运行完成";

export type ProjectViewModel = {
  id: string;
  title: string;
  lastWorkspace: "cocreate" | "review";
  checkpointLabel: RuntimeCheckpoint;
  materialCount: 0;
  draftLabel: "尚无草稿";
  updatedAt: string;
};

export function projectView(snapshot: RuntimeCreativeProjectSnapshot): ProjectViewModel {
  return {
    id: snapshot.project.id,
    title: snapshot.project.title,
    lastWorkspace: snapshot.project.lastWorkspace,
    checkpointLabel: checkpointLabel(snapshot.latestRun?.run.status ?? null),
    materialCount: 0,
    draftLabel: "尚无草稿",
    updatedAt: snapshot.project.updatedAt,
  };
}

export function checkpointLabel(status: RuntimeStatus | null): RuntimeCheckpoint {
  if (status === "queued" || status === "running") return "运行准备";
  if (status === "awaiting_user") return "方向提案";
  if (status === "failed") return "运行失败";
  if (status === "cancelled") return "运行取消";
  if (status === "completed") return "运行完成";
  return "未开始";
}

export function workspaceLabel(workspace: ProjectViewModel["lastWorkspace"]): string {
  return workspace === "cocreate" ? "共创" : "终稿审阅";
}
