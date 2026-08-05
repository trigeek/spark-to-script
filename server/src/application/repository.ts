// SPDX-License-Identifier: AGPL-3.0-only

import type {
  AgentRun,
  CreativeProject,
  CreativeProjectSnapshot,
  RunArtifact,
  RunEvent,
  RunEventOf,
  RunEventPayloads,
  RunEventType,
  RunSnapshot,
} from "../domain/entities.js";

export type ArtifactTransition = {
  run: AgentRun;
  artifact: RunArtifact;
  events: RunEvent[];
};

export interface ProjectRepository {
  close(): void;
  createProject(project: CreativeProject): CreativeProject;
  listProjectSnapshots(): CreativeProjectSnapshot[];
  getProjectSnapshot(projectId: string): CreativeProjectSnapshot | null;
  updateProjectWorkspace(
    projectId: string,
    lastWorkspace: CreativeProject["lastWorkspace"],
    updatedAt: string,
  ): CreativeProject;

  createRun(run: AgentRun): { run: AgentRun; event: RunEventOf<"run.queued"> };
  getRun(runId: string): AgentRun | null;
  getRunSnapshot(runId: string): RunSnapshot | null;
  listIncompleteRuns(): AgentRun[];
  markRunRunning(runId: string, startedAt: string): {
    run: AgentRun;
    event: RunEventOf<"run.started"> | null;
  } | null;
  appendEvent<T extends RunEventType>(
    runId: string,
    type: T,
    payload: RunEventPayloads[T],
    createdAt: string,
  ): RunEventOf<T>;
  hasEvent(runId: string, type: RunEventType): boolean;
  listEvents(runId: string, afterEventId?: number): RunEvent[];
  saveArtifactAndAwaitingUser(runId: string, artifact: RunArtifact, completedAt: string): ArtifactTransition;
  failRun(runId: string, code: string, summary: string, completedAt: string): {
    run: AgentRun;
    event: RunEventOf<"run.failed">;
  } | null;
  cancelRun(runId: string, completedAt: string): {
    run: AgentRun;
    event: RunEventOf<"run.cancelled">;
  } | null;
}
