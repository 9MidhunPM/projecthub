import {ChevronLeft, ChevronRight} from 'lucide-react';
import type {Page} from '@/lib/api';

type Props = {data: Page<unknown>; busy?: boolean; label: string; onPage: (page: number) => void};

export function Pagination({data, busy = false, label, onPage}: Props) {
  if (!data.total || !data.items.length) return null;
  const first = (data.page - 1) * data.limit + 1;
  const last = Math.min(data.total, first + data.items.length - 1);
  return <nav className="collection-pagination" aria-label={`${label} pages`}>
    <span className="collection-range" role="status">Showing {first}–{last} of {data.total}</span>
    <div className="pagination">
      <button type="button" className="icon-button" aria-label={`Previous ${label.toLowerCase()} page`} disabled={busy || data.page <= 1} onClick={() => onPage(data.page - 1)}><ChevronLeft size={18} aria-hidden="true"/></button>
      <span>Page {data.page} of {Math.max(1, data.pages)}</span>
      <button type="button" className="icon-button" aria-label={`Next ${label.toLowerCase()} page`} disabled={busy || data.page >= data.pages} onClick={() => onPage(data.page + 1)}><ChevronRight size={18} aria-hidden="true"/></button>
    </div>
  </nav>;
}
