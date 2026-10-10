'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {CollectionQuery, CollectionQueryOptions, parseCollectionQuery, serializeCollectionQuery} from './collection-query';

/** URL state is written only by navigation events, never by a pending API read. */
export function useCollectionQuery(path: string, options: CollectionQueryOptions) {
  const [query, setQuery] = useState(() => parseCollectionQuery('', options));
  const [ready, setReady] = useState(false);
  const latest = useRef(query);

  useEffect(() => {
    const restore = () => {
      if (window.location.pathname !== path) { setReady(false); return; }
      const restored = parseCollectionQuery(window.location.search, options);
      latest.current = restored;
      setQuery(restored);
      setReady(true);
      const search = serializeCollectionQuery(restored, options);
      window.history.replaceState(window.history.state, '', `${path}${search ? `?${search}` : ''}`);
    };
    restore();
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [path, options]);

  const change = useCallback((values: Partial<CollectionQuery>, mode: 'push' | 'replace' = 'push') => {
    if (window.location.pathname !== path) return;
    const next = parseCollectionQuery(serializeCollectionQuery({...latest.current, ...values}, options), options);
    const search = serializeCollectionQuery(next, options);
    const href = `${path}${search ? `?${search}` : ''}`;
    if (`${window.location.pathname}${window.location.search}` !== href) {
      window.history[mode === 'replace' ? 'replaceState' : 'pushState'](window.history.state, '', href);
    }
    latest.current = next;
    setQuery(next);
  }, [path, options]);

  return {query, ready, change};
}
