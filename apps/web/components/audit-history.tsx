'use client';

import {useEffect, useRef, useState} from 'react';
import type {AuditEntry, Page} from '@/lib/api';
import {auditActionLabel, auditDetails} from '@/lib/audit';
import {useApiResource} from '@/lib/use-api-resource';
import {ErrorMessage, Loading} from './shell';
import {Pagination} from './pagination';

export function AuditHistory({revision}: {revision: number}) {
  const [page, setPage] = useState(1);
  const {data, error, loading, reload} = useApiResource<Page<AuditEntry>>(`/admin/audit?page=${page}&limit=25`);
  const previousRevision = useRef(revision);

  useEffect(() => {
    if (revision !== previousRevision.current) { previousRevision.current = revision; reload(); }
  }, [revision, reload]);
  useEffect(() => {
    if (data && !loading && !error && page > Math.max(1, data.pages)) setPage(Math.max(1, data.pages));
  }, [data, loading, error, page]);

  return <section className="audit-panel" aria-labelledby="audit-title">
    <div className="section-title"><div><h2 id="audit-title">Audit history</h2><p>Recorded role and project-review changes, newest first.</p></div><button className="button" disabled={loading} onClick={reload}>{loading ? 'Refreshing…' : 'Refresh history'}</button></div>
    <ErrorMessage message={error}/>
    {error && <button className="button" onClick={reload}>Retry audit history</button>}
    {(!data && loading) || (data && page > Math.max(1, data.pages)) ? <Loading message="Loading audit history…"/> : data?.items.length ? <>
      <p className="collection-count" role="status">{data.total} recorded {data.total === 1 ? 'change' : 'changes'}</p>
      <ol className="audit-list" aria-busy={loading}>{data.items.map(entry => {
        const date = new Date(entry.createdAt);
        const validDate = !Number.isNaN(date.getTime());
        return <li key={entry.id} className="audit-entry">
          <div className="audit-heading"><h3>{auditActionLabel(entry.action)}</h3><time dateTime={validDate ? entry.createdAt : undefined}>{validDate ? date.toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'}) : 'Date unavailable'}</time></div>
          <dl className="audit-identifiers"><div><dt>Actor ID</dt><dd>{entry.actorId}</dd></div><div><dt>Target ID</dt><dd>{entry.targetId}</dd></div></dl>
          <div className="audit-details">{auditDetails(entry).map((detail, index) => <p key={index}>{detail}</p>)}</div>
        </li>;
      })}</ol>
    </> : !error && !loading && <div className="empty"><h3>No recorded changes yet.</h3><p>Role and project-review actions will appear here.</p></div>}
    <Pagination data={data} page={page} loading={loading} label="Audit" onPage={setPage}/>
  </section>;
}
