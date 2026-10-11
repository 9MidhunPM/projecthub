'use client';

import {useCallback, useEffect, useState} from 'react';
import type {SetStateAction} from 'react';
import {api, isAbortError} from './api';

type Resource<T> = {path: string | null; data: T | null; error: string; loading: boolean};

/** Abort stale reads; retain data only when refreshing the same resource. */
export function useApiResource<T>(path: string | null) {
  const [state, setState] = useState<Resource<T>>({path, data: null, error: '', loading: true});
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    setState(previous => ({path, data: previous.path === path ? previous.data : null, error: '', loading: true}));
    api<T>(path, {signal: controller.signal}).then(data => {
      if (!controller.signal.aborted) setState({path, data, error: '', loading: false});
    }).catch(failure => {
      if (!controller.signal.aborted && !isAbortError(failure)) setState(previous => ({path, data: previous.path === path ? previous.data : null, error: failure.message, loading: false}));
    });
    return () => controller.abort();
  }, [path, revision]);

  const reload = useCallback(() => {
    setState(previous => ({...previous, loading: true, error: ''}));
    setRevision(value => value + 1);
  }, []);
  const setData = useCallback((update: SetStateAction<T | null>) => {
    setState(previous => {
      if (previous.path !== path) return previous;
      return {...previous, data: typeof update === 'function' ? (update as (value: T | null) => T | null)(previous.data) : update};
    });
  }, [path]);

  const current = state.path === path;
  return {data: current ? state.data : null, error: current ? state.error : '', loading: !current || state.loading, reload, setData};
}
