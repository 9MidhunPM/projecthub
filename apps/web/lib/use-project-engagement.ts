'use client';

import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {api, isAbortError} from './api';
import type {Engagement, Project} from './api';

export type EngagementKind = 'like' | 'bookmark';
type Options = {
  project: Pick<Project, 'id' | 'liked' | 'bookmarked'> | null;
  userId: string | undefined;
  sessionLoading: boolean;
  onSuccess: (engagement: Engagement, kind: EngagementKind) => void;
  onError: (error: Error) => void;
};
type Request = {controller: AbortController; projectId: string; userId: string};

/** Own an engagement response by its project and viewer, never by its old render. */
export function useProjectEngagement(options: Options) {
  const latest = useRef(options);
  const request = useRef<Request | null>(null);
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    latest.current = options;
    const active = request.current;
    if (active && (options.sessionLoading || active.projectId !== options.project?.id || active.userId !== options.userId)) {
      active.controller.abort();
      request.current = null;
      setBusy(false);
    }
  });
  useEffect(() => () => {
    request.current?.controller.abort();
    request.current = null;
  }, []);

  const toggle = useCallback(async (kind: EngagementKind) => {
    const {project, userId, sessionLoading} = latest.current;
    if (!project || !userId || sessionLoading || request.current) return;
    const active = {controller: new AbortController(), projectId: project.id, userId};
    request.current = active;
    setBusy(true);
    const ownsResponse = () => request.current === active && !active.controller.signal.aborted
      && latest.current.project?.id === active.projectId && latest.current.userId === active.userId;
    try {
      const selected = kind === 'like' ? project.liked : project.bookmarked;
      const engagement = await api<Engagement>(`/projects/${project.id}/${kind}`, {
        method: selected ? 'DELETE' : 'PUT', signal: active.controller.signal,
      });
      if (!ownsResponse()) return;
      latest.current = {...latest.current, project: {...latest.current.project!, ...engagement}};
      latest.current.onSuccess(engagement, kind);
    } catch (failure) {
      if (ownsResponse() && !isAbortError(failure)) latest.current.onError(failure as Error);
    } finally {
      if (request.current === active) { request.current = null; setBusy(false); }
    }
  }, []);

  return {busy, toggle};
}
