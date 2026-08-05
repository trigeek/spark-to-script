// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RuntimeApiClient,
  RuntimeCreativeProjectSnapshot,
  RuntimeRunEvent,
  RuntimeRunSnapshot,
  RuntimeWorkspace,
} from "../api/runtime-api";
import { isSettledRunEventType } from "../api/runtime-api";

export function useCreativeRuntime(client: RuntimeApiClient, initialProjectId: string | null) {
  const [projects, setProjects] = useState<RuntimeCreativeProjectSnapshot[]>([]);
  const [activeProject, setActiveProject] = useState<RuntimeCreativeProjectSnapshot | null>(null);
  const [events, setEvents] = useState<RuntimeRunEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const refreshProjects = useCallback(async () => {
    const snapshots = await client.listProjects();
    setProjects(snapshots);
    return snapshots;
  }, [client]);

  const updateActiveRun = useCallback((runSnapshot: RuntimeRunSnapshot) => {
    setEvents(runSnapshot.events);
    setActiveProject((current) => current?.project.id === runSnapshot.run.projectId
      ? { ...current, latestRun: runSnapshot }
      : current);
    setProjects((current) => current.map((snapshot) => snapshot.project.id === runSnapshot.run.projectId
      ? { ...snapshot, latestRun: runSnapshot }
      : snapshot));
  }, []);

  const subscribe = useCallback((runSnapshot: RuntimeRunSnapshot) => {
    unsubscribeRef.current?.();
    const runId = runSnapshot.run.id;
    unsubscribeRef.current = client.subscribeToRunEvents(runId, runSnapshot.lastEventId, (event) => {
      setEvents((current) => current.some((item) => item.id === event.id)
        ? current
        : [...current, event].sort((left, right) => left.id - right.id));
      if (isSettledRunEventType(event.type) || event.type === "artifact.proposed") {
        void client.getRun(runId).then(updateActiveRun).then(() => refreshProjects()).catch((caught: unknown) => {
          setError(errorMessage(caught));
        });
      }
    }, () => {
      void client.getRun(runId).then(updateActiveRun).catch((caught: unknown) => setError(errorMessage(caught)));
    });
  }, [client, refreshProjects, updateActiveRun]);

  const openProject = useCallback(async (projectId: string) => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setError(null);
    setEvents([]);
    const snapshot = await client.getProject(projectId);
    setActiveProject(snapshot);
    setEvents(snapshot.latestRun?.events ?? []);
    if (snapshot.latestRun) subscribe(snapshot.latestRun);
    return snapshot;
  }, [client, subscribe]);

  useEffect(() => {
    let cancelled = false;
    void refreshProjects()
      .then(async () => {
        if (cancelled || !initialProjectId) return;
        await openProject(initialProjectId);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      unsubscribeRef.current?.();
    };
  }, [initialProjectId, openProject, refreshProjects]);

  const startProject = useCallback(async (initialPrompt: string) => {
    setStarting(true);
    setError(null);
    setEvents([]);
    try {
      const project = await client.createProject(initialPrompt);
      const baseSnapshot: RuntimeCreativeProjectSnapshot = { project, latestRun: null };
      setActiveProject(baseSnapshot);
      setProjects((current) => [baseSnapshot, ...current.filter((item) => item.project.id !== project.id)]);

      try {
        const configuration = await client.getRuntimeConfiguration();
        if (!configuration.modelGatewayConfigured) {
          setError(configuration.setupError.message);
          return baseSnapshot;
        }
        const run = await client.createRun(project.id);
        const snapshot: RuntimeCreativeProjectSnapshot = { project, latestRun: run };
        setActiveProject(snapshot);
        setEvents(run.events);
        setProjects((current) => current.map((item) => item.project.id === project.id ? snapshot : item));
        subscribe(run);
        return snapshot;
      } catch (caught) {
        setError(errorMessage(caught));
        return baseSnapshot;
      }
    } catch (caught) {
      setError(errorMessage(caught));
      throw caught;
    } finally {
      setStarting(false);
    }
  }, [client, subscribe]);

  const cancelRun = useCallback(async () => {
    const runId = activeProject?.latestRun?.run.id;
    if (!runId) return;
    setError(null);
    try {
      updateActiveRun(await client.cancelRun(runId));
      await refreshProjects();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [activeProject, client, refreshProjects, updateActiveRun]);

  const retryRun = useCallback(async () => {
    const runId = activeProject?.latestRun?.run.id;
    if (!runId) return;
    setError(null);
    setEvents([]);
    try {
      const retry = await client.retryRun(runId);
      updateActiveRun(retry);
      subscribe(retry);
      await refreshProjects();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [activeProject, client, refreshProjects, subscribe, updateActiveRun]);

  const changeWorkspace = useCallback(async (workspace: RuntimeWorkspace) => {
    if (!activeProject) return;
    try {
      const project = await client.updateProjectWorkspace(activeProject.project.id, workspace);
      setActiveProject((current) => current ? { ...current, project } : current);
      setProjects((current) => current.map((snapshot) => snapshot.project.id === project.id
        ? { ...snapshot, project }
        : snapshot));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [activeProject, client]);

  return {
    projects,
    activeProject,
    events,
    loading,
    starting,
    error,
    startProject,
    openProject,
    cancelRun,
    retryRun,
    changeWorkspace,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "运行时发生未知错误";
}
