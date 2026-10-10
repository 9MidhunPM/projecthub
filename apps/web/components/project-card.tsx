'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Heart, Bookmark, ArrowUpRight, Layers} from 'lucide-react';
import {api, Engagement, initials, isAbortError, Project} from '@/lib/api';
import {authHref} from '@/lib/auth-navigation';
import {useApp} from './shell';

export function ProjectCover({project}: {project: Project}) {
  const source = project.screenshots?.[0];
  const [failed, setFailed] = useState<string | null>(null);
  if (source && failed !== source) return <img className="project-image" src={source} alt={`${project.title} screenshot`} loading="lazy" decoding="async" onError={() => setFailed(source)}/>;
  return <div className="cover-empty"><Layers size={36} aria-hidden="true"/><span>{project.title}</span><small>{source ? 'Screenshot unavailable' : 'Explore the project'}</small></div>;
}

export function ProjectCard({project, onUpdate}: {project: Project; onUpdate?: (project: Project) => void}) {
  const [current, setCurrent] = useState(project);
  const [busy, setBusy] = useState(false);
  const request = useRef<{controller: AbortController; projectId: string; userId: string} | null>(null);
  const latest = useRef(project);
  const updateCallback = useRef(onUpdate);
  const {user, loading, notify} = useApp();
  const router = useRouter();

  // Synchronize metadata before any pending response can publish an update.
  useLayoutEffect(() => {
    latest.current = project;
    setCurrent(project);
  }, [project]);
  useLayoutEffect(() => {
    updateCallback.current = onUpdate;
    const active = request.current;
    if (active && (active.projectId !== project.id || active.userId !== user?.id)) {
      active.controller.abort();
      request.current = null;
      setBusy(false);
    }
  }, [project.id, user?.id, onUpdate]);
  useEffect(() => () => {
    request.current?.controller.abort();
    request.current = null;
  }, []);

  async function toggle(kind: 'like' | 'bookmark') {
    if (request.current || loading) return;
    if (!user) {
      router.push(authHref(false, `${window.location.pathname}${window.location.search}`));
      return;
    }
    const active = {controller: new AbortController(), projectId: latest.current.id, userId: user.id};
    request.current = active;
    setBusy(true);
    try {
      const selected = kind === 'like' ? latest.current.liked : latest.current.bookmarked;
      const engagement = await api<Engagement>(`/projects/${active.projectId}/${kind}`, {method: selected ? 'DELETE' : 'PUT', signal: active.controller.signal});
      if (active.controller.signal.aborted || request.current !== active || latest.current.id !== active.projectId) return;
      const updated = {...latest.current, ...engagement};
      latest.current = updated;
      setCurrent(updated);
      updateCallback.current?.(updated);
      if (kind === 'bookmark') notify(updated.bookmarked ? 'Project saved to Bookmarks.' : 'Project removed from Bookmarks.');
    } catch (failure) {
      if (request.current === active && !active.controller.signal.aborted && !isAbortError(failure)) notify((failure as Error).message);
    } finally {
      if (request.current === active) { request.current = null; setBusy(false); }
    }
  }

  return <article className="project-card" aria-label={current.title}>
    <Link className="cover-link" href={`/projects/${current.id}`} aria-label={`View ${current.title}`}><ProjectCover project={current}/><span className="cover-arrow"><ArrowUpRight size={19} aria-hidden="true"/></span></Link>
    <div className="card-body">
      <div className="card-department">{current.department} <span>· Semester {current.semester}</span></div>
      <Link href={`/projects/${current.id}`} className="project-title">{current.title}</Link>
      <p className="project-description">{current.description}</p>
      <div className="tags" aria-label="Technologies">{current.techStack.slice(0, 3).map((technology, index) => <span key={`${technology}-${index}`}>{technology}</span>)}{current.techStack.length > 3 && <span title={current.techStack.slice(3).join(', ')} aria-label={`${current.techStack.length - 3} more technologies`}>+{current.techStack.length - 3}</span>}</div>
      <div className="card-bottom">
        <span className="author" title={current.owner?.name || 'Student'}><span className="avatar small" aria-hidden="true">{initials(current.owner?.name || 'Student')}</span><span>{current.owner?.name || 'Student'}</span></span>
        <button disabled={busy || loading} className={`icon-button ${current.bookmarked ? 'selected' : ''}`} aria-label={current.bookmarked ? `Unsave ${current.title}` : `Save ${current.title}`} aria-pressed={current.bookmarked} onClick={() => void toggle('bookmark')}><Bookmark size={17} fill={current.bookmarked ? 'currentColor' : 'none'} aria-hidden="true"/></button>
        <button disabled={busy || loading} className={`icon-button like ${current.liked ? 'selected' : ''}`} aria-label={current.liked ? `Unlike ${current.title}, ${current.likes} likes` : `Like ${current.title}, ${current.likes} likes`} aria-pressed={current.liked} onClick={() => void toggle('like')}><Heart size={17} fill={current.liked ? 'currentColor' : 'none'} aria-hidden="true"/><span>{current.likes}</span></button>
      </div>
    </div>
  </article>;
}
