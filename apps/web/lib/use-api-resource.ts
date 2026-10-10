'use client';

import {useCallback, useEffect, useState} from 'react';
import type {SetStateAction} from 'react';
import {api, isAbortError} from './api';

/** Abort stale reads and preserve an already loaded view during a same-route retry. */
export function useApiResource<T>(path: string) {
  const [result, setResult] = useState<{path: string; data: T | null}>({path, data: null});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api<T>(path, {signal: controller.signal}).then(data => {
      if (!controller.signal.aborted) setResult({path, data});
    }).catch(failure => {
      if (!controller.signal.aborted && !isAbortError(failure)) setError(failure.message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, revision]);

  const reload = useCallback(() => setRevision(value => value + 1), []);
  const setData = useCallback((update: SetStateAction<T | null>) => {
    setResult(previous => {
      const current = previous.path === path ? previous.data : null;
      return {path, data: typeof update === 'function' ? (update as (value: T | null) => T | null)(current) : update};
    });
  }, [path]);

  return {data: result.path === path ? result.data : null, error, loading, reload, setData};
}
