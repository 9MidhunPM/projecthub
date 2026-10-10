'use client';

import {useLayoutEffect, useRef} from 'react';
import {ChevronLeft, ChevronRight} from 'lucide-react';
import type {Page} from '@/lib/api';

type Props = {
  data: Page<unknown> | null;
  page: number;
  loading?: boolean;
  busy?: boolean;
  label: string;
  onPage: (page: number) => void;
};

export function Pagination({data, page, loading = false, busy = false, label, onPage}: Props) {
  const hasShownPages = useRef(false);
  const status = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => { if (data && data.total > 0) hasShownPages.current = true; }, [data]);

  // Once shown, keep the pager and its focus target mounted during reads and recovery.
  if (!data?.total && !hasShownPages.current) return null;
  const first = (page - 1) * (data?.limit ?? 0) + 1;
  const last = data ? Math.min(data.total, first + data.items.length - 1) : 0;
  const pending = busy || loading;
  function navigate(next: number, button: HTMLButtonElement) {
    // A stable status announces the destination without dropping keyboard focus
    // when the current button becomes disabled at the first or last page.
    if (document.activeElement === button) status.current?.focus();
    onPage(next);
  }

  return <nav className="collection-pagination" aria-label={`${label} pages`} aria-busy={pending}>
    {data && !loading && data.items.length > 0 && <span className="collection-range">Showing {first}–{last} of {data.total}</span>}
    <div className="pagination">
      <button type="button" className="icon-button" aria-label={`Previous ${label.toLowerCase()} page`} disabled={pending || page <= 1} onClick={event => navigate(page - 1, event.currentTarget)}><ChevronLeft size={18} aria-hidden="true"/></button>
      <span ref={status} tabIndex={-1} role="status">{loading ? `Loading page ${page}…` : !data ? `Page ${page} unavailable` : data.total ? `Page ${page} of ${Math.max(1, data.pages)}` : 'No more results'}</span>
      <button type="button" className="icon-button" aria-label={`Next ${label.toLowerCase()} page`} disabled={pending || !data || page >= data.pages} onClick={event => navigate(page + 1, event.currentTarget)}><ChevronRight size={18} aria-hidden="true"/></button>
    </div>
  </nav>;
}
