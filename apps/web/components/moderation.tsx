'use client';

import {useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import {Check, MessageSquare, EyeOff, ArrowUpRight, ShieldCheck} from 'lucide-react';
import {api, ApiError, isAbortError, Listing, Project, ProjectStatus} from '@/lib/api';
import {useApiResource} from '@/lib/use-api-resource';
import {useCollectionQuery} from '@/lib/use-collection-query';
import {Pagination} from './pagination';
import {Guard, Loading, ErrorMessage, useApp} from './shell';
import {Status} from './workspace';

type ReviewStatus = Extract<ProjectStatus, 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED' | 'HIDDEN'>;
type Decision = Exclude<ReviewStatus, 'PENDING'>;
const queues: {value: ReviewStatus; label: string; empty: string}[] = [
  {value: 'PENDING', label: 'Awaiting review', empty: 'No projects are awaiting review.'},
  {value: 'APPROVED', label: 'Published', empty: 'No published projects in this queue.'},
  {value: 'CHANGES_REQUESTED', label: 'Changes requested', empty: 'No projects are waiting for changes.'},
  {value: 'HIDDEN', label: 'Hidden', empty: 'No hidden projects in this queue.'},
];

const reviewQueryOptions = {statuses: queues.map(queue => queue.value), defaultStatus: 'PENDING'};

export function Moderation() { return <Guard roles={['FACULTY', 'ADMIN']}><ReviewQueue/></Guard>; }

function ReviewQueue() {
  const {query, ready, change} = useCollectionQuery('/moderation', reviewQueryOptions);
  const status = query.status as ReviewStatus;
  const {data, error, loading, reload, setData} = useApiResource<Listing>(ready ? `/moderation/projects?status=${status}&page=${query.page}&limit=12` : null);
  const projects = data?.items ?? null;
  useEffect(() => {
    if (data && !loading && !error && query.page > Math.max(1, data.pages)) change({page: Math.max(1, data.pages)}, 'replace');
  }, [data, loading, error, query.page, change]);
  const [busy, setBusy] = useState<{id: string; decision: Decision} | null>(null);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [itemErrors, setItemErrors] = useState<Record<string, {message: string; conflict: boolean}>>({});
  const request = useRef<AbortController | null>(null);
  const {notify, user} = useApp();

  useEffect(() => () => { request.current?.abort(); }, []);

  async function review(project: Project, decision: Decision) {
    if (request.current || project.ownerId === user?.id) return;
    const text = feedback[project.id]?.trim();
    if (decision === 'CHANGES_REQUESTED' && !text) {
      setItemErrors(previous => ({...previous, [project.id]: {message: 'Add a clear note before requesting changes.', conflict: false}}));
      document.getElementById(`feedback-${project.id}`)?.focus();
      return;
    }
    if (decision === 'APPROVED' && !window.confirm(`Approve “${project.title}”? Its description, team names, links, and screenshots will be publicly visible in Explore.`)) return;
    if (decision === 'HIDDEN' && !window.confirm(`Hide “${project.title}”? It will not be listed in Explore. The student will still be able to see it in their workspace.`)) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy({id: project.id, decision});
    setItemErrors(previous => ({...previous, [project.id]: {message: '', conflict: false}}));
    try {
      await api(`/moderation/projects/${project.id}`, {method: 'PATCH', body: JSON.stringify({status: decision, feedback: text || '', expectedVersion: project.version}), signal: controller.signal});
      if (controller.signal.aborted) return;
      setData(previous => previous ? {...previous, items: previous.items.filter(item => item.id !== project.id)} : previous);
      reload();
      setFeedback(previous => { const next = {...previous}; delete next[project.id]; return next; });
      notify(decision === 'APPROVED' ? 'Project approved and published.' : decision === 'HIDDEN' ? 'Project hidden from Explore.' : 'Changes requested.');
    } catch (failure) {
      if (!controller.signal.aborted && !isAbortError(failure)) {
        setItemErrors(previous => ({...previous, [project.id]: {message: (failure as Error).message, conflict: failure instanceof ApiError && failure.status === 409}}));
      }
    } finally {
      if (!controller.signal.aborted) { request.current = null; setBusy(null); }
    }
  }

  return <div className="page-container">
    <div className="page-title"><div><h1>Give good work a green light.</h1><p>Review student projects and help their ideas shine.</p></div><ShieldCheck size={32} aria-hidden="true"/></div>
    <nav className="tab-bar review-tabs" aria-label="Review queues">{queues.map(queue => <button key={queue.value} className={status === queue.value ? 'active' : ''} aria-pressed={status === queue.value} disabled={Boolean(busy)} onClick={() => change({status: queue.value, page: 1})}>{queue.label}</button>)}</nav>
    <ErrorMessage message={error}/>
    {error && <button className="button" disabled={Boolean(busy)} onClick={reload}>Try again</button>}
    {(!projects && loading) || (data && query.page > Math.max(1, data.pages)) ? <Loading message="Loading review queue…"/> : projects?.length ? <>
      <p className="collection-count" role="status">{data?.total} {data?.total === 1 ? 'project' : 'projects'} in this queue</p>
      <div className="review-list" aria-busy={loading}>{projects.map(project => {
        const ownsProject = project.ownerId === user?.id;
        const itemError = itemErrors[project.id];
        return <article className="review-card" key={project.id} aria-labelledby={`review-title-${project.id}`}>
          <div className="review-card-heading"><div><Status value={project.status}/><h2 id={`review-title-${project.id}`}><Link href={`/projects/${project.id}`}>{project.title}</Link></h2><p>{project.owner.name} · {project.department} · Semester {project.semester}</p></div><Link className="button" href={`/projects/${project.id}`}>View project<ArrowUpRight size={16} aria-hidden="true"/></Link></div>
          <p className="review-description">{project.description}</p>
          <div className="tags">{project.techStack.map((technology, index) => <span key={`${technology}-${index}`}>{technology}</span>)}</div>
          {project.feedback && <div className="review-note">Previous feedback: {project.feedback}</div>}
          {ownsProject ? <div className="review-note">Another faculty member or administrator must review your own project.</div> : <>
            <label htmlFor={`feedback-${project.id}`}>Feedback for the student</label><textarea id={`feedback-${project.id}`} maxLength={2000} rows={2} disabled={Boolean(busy)} aria-describedby={`feedback-hint-${project.id}`} aria-invalid={Boolean(itemError?.message)} value={feedback[project.id] || ''} onChange={event => setFeedback(previous => ({...previous, [project.id]: event.target.value}))} placeholder="Be specific about what is working or what needs to change."/>
            <p id={`feedback-hint-${project.id}`} className="review-feedback-hint">Required when requesting changes. Up to 2,000 characters.</p>
            <ErrorMessage message={itemError?.message || ''}/>
            {itemError?.conflict && <button className="button" disabled={Boolean(busy)} onClick={() => { setItemErrors(previous => ({...previous, [project.id]: {message: '', conflict: false}})); reload(); }}>Refresh this queue</button>}
            <div className="review-actions">{project.status !== 'HIDDEN' && <button disabled={Boolean(busy)} className="button danger" onClick={() => void review(project, 'HIDDEN')}><EyeOff size={16} aria-hidden="true"/>{busy?.id === project.id && busy.decision === 'HIDDEN' ? 'Hiding…' : 'Hide project'}</button>}<div><button disabled={Boolean(busy)} className="button" onClick={() => void review(project, 'CHANGES_REQUESTED')}><MessageSquare size={16} aria-hidden="true"/>{busy?.id === project.id && busy.decision === 'CHANGES_REQUESTED' ? 'Requesting…' : 'Request changes'}</button><button disabled={Boolean(busy) || project.status !== 'PENDING'} className="button primary" onClick={() => void review(project, 'APPROVED')}><Check size={17} aria-hidden="true"/>{busy?.id === project.id && busy.decision === 'APPROVED' ? 'Approving…' : 'Approve project'}</button></div></div>
          </>}
        </article>;
      })}</div>
      {data && <Pagination data={data} busy={loading || Boolean(busy) || Boolean(error)} label="Review" onPage={page => change({page})}/>}
    </> : loading ? <Loading message="Refreshing review queue…"/> : !error && <div className="empty"><ShieldCheck size={40} aria-hidden="true"/><h2>{queues.find(queue => queue.value === status)?.empty}</h2><p>{status === 'PENDING' ? 'New student submissions will appear here.' : 'Choose another queue to continue reviewing.'}</p></div>}
  </div>;
}
