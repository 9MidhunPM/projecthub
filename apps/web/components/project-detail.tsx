'use client';

import {useEffect, useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ArrowLeft, ArrowUpRight, Github, Heart, Bookmark, Users, Eye, Pencil, ChevronLeft, ChevronRight, ImageOff} from 'lucide-react';
import {api, ApiError, Project, initials, isAbortError} from '@/lib/api';
import {authHref} from '@/lib/auth-navigation';
import {useProjectEngagement} from '@/lib/use-project-engagement';
import {useApp, Loading, ErrorMessage} from './shell';
import {ProjectCover} from './project-card';
import {Status} from './workspace';

export function ProjectDetail({id}: {id: string}) { return <Detail key={id} id={id}/>; }

function Detail({id}: {id: string}) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(0);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const {user, loading: sessionLoading, notify} = useApp();
  const router = useRouter();

  useEffect(() => {
    if (sessionLoading) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setNeedsLogin(false);
    api<Project>(`/projects/${id}`, {signal: controller.signal}).then(value => {
      if (controller.signal.aborted) return;
      setProject(value);
      setActive(index => Math.min(index, Math.max(0, value.screenshots.length - 1)));
      if (value.status === 'APPROVED') {
        void api<{views: number}>(`/projects/${id}/view`, {method: 'POST', signal: controller.signal}).then(result => {
          if (!controller.signal.aborted) setProject(previous => previous ? {...previous, views: result.views} : previous);
        }).catch(() => {});
      }
    }).catch(failure => {
      if (!controller.signal.aborted && !isAbortError(failure)) {
        setError(failure.message);
        setNeedsLogin(failure instanceof ApiError && failure.status === 401);
      }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, sessionLoading, user?.id, retry]);

  const {busy, toggle: toggleEngagement} = useProjectEngagement({
    project, userId: user?.id, sessionLoading,
    onSuccess(engagement, kind) {
      setProject(previous => previous ? {...previous, ...engagement} : previous);
      if (kind === 'bookmark') notify(engagement.bookmarked ? 'Project saved to Bookmarks.' : 'Project removed from Bookmarks.');
    },
    onError: failure => notify(failure.message),
  });

  function toggle(kind: 'like' | 'bookmark') {
    if (!project || busy || sessionLoading) return;
    if (!user) { router.push(authHref(false, `/projects/${id}`)); return; }
    void toggleEngagement(kind);
  }

  if (loading) return <Loading message="Loading project…"/>;
  if (error || !project) return <div className="page-container"><h1>We couldn’t load this project.</h1><div className="load-recovery"><ErrorMessage message={error}/><div className="recovery-actions"><button className="button primary" onClick={() => setRetry(value => value + 1)}>Try again</button>{needsLogin && <Link className="button" href={authHref(false, `/projects/${id}`)}>Sign in</Link>}<Link href="/" className="button">Back to Explore</Link></div></div></div>;

  const p = project;
  const activeImage = p.screenshots[active];
  const changeScreenshot = (step: number) => setActive(previous => (previous + step + p.screenshots.length) % p.screenshots.length);

  return <div className="page-container detail-page">
    <Link href="/" className="back-link"><ArrowLeft size={16} aria-hidden="true"/>Back to Explore</Link>
    <div className="detail-heading">
      <div><div className="detail-meta">{p.department} <span>·</span> Semester {p.semester} <span>·</span> {p.type}</div><h1>{p.title}</h1><span className="author"><span className="avatar" aria-hidden="true">{initials(p.owner?.name || 'Student')}</span><span>Built by <strong>{p.owner?.name || 'Student'}</strong></span></span></div>
      <div className="detail-actions">
        {user?.id === p.ownerId && <Link className="button" href={`/projects/${id}/edit`}><Pencil size={17} aria-hidden="true"/>Edit project</Link>}
        <button disabled={busy || sessionLoading || p.status !== 'APPROVED'} className={`button ${p.liked ? 'selected' : ''}`} onClick={() => void toggle('like')} aria-pressed={p.liked} aria-label={`${p.liked ? 'Unlike' : 'Like'} ${p.title}, ${p.likes} likes`}><Heart size={18} fill={p.liked ? 'currentColor' : 'none'} aria-hidden="true"/>{p.likes}</button>
        <button disabled={busy || sessionLoading || p.status !== 'APPROVED'} className={`button ${p.bookmarked ? 'selected' : ''}`} onClick={() => void toggle('bookmark')} aria-pressed={p.bookmarked} aria-label={`${p.bookmarked ? 'Unsave' : 'Save'} ${p.title}`}><Bookmark size={18} fill={p.bookmarked ? 'currentColor' : 'none'} aria-hidden="true"/>{p.bookmarked ? 'Saved' : 'Save'}</button>
      </div>
    </div>
    {p.status !== 'APPROVED' && <div className="review-note"><Status value={p.status}/><span>{p.feedback || 'This project is not publicly listed yet.'}</span></div>}
    <div className="detail-layout">
      <div className="detail-main">
        <div className="project-screenshots" role="region" aria-label="Project screenshots" aria-roledescription={p.screenshots.length > 1 ? 'carousel' : undefined} tabIndex={p.screenshots.length > 1 ? 0 : undefined} onKeyDown={event => {
          if (p.screenshots.length < 2) return;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); changeScreenshot(event.key === 'ArrowLeft' ? -1 : 1); }
        }}>
          <div className="detail-cover">
            {activeImage ? failedImage === activeImage ? <div className="cover-empty"><ImageOff size={36} aria-hidden="true"/><span>Screenshot unavailable</span><small>Try another image or reload the project.</small></div> : <img src={activeImage} alt={`${p.title} screenshot ${active + 1}`} decoding="async" onError={() => setFailedImage(activeImage)}/> : <ProjectCover project={p}/>}
          </div>
          {p.screenshots.length > 1 && <>
            <div className="screenshot-nav"><button className="icon-button" aria-label="Previous screenshot" onClick={() => changeScreenshot(-1)}><ChevronLeft aria-hidden="true"/></button><div className="screenshot-strip">{p.screenshots.map((source, index) => <button aria-label={`Show screenshot ${index + 1}`} aria-pressed={active === index} className={active === index ? 'active' : ''} onClick={() => setActive(index)} key={`${source}-${index}`}><img src={source} alt="" loading="lazy"/></button>)}</div><button className="icon-button" aria-label="Next screenshot" onClick={() => changeScreenshot(1)}><ChevronRight aria-hidden="true"/></button></div>
            <p className="screenshot-caption" role="status">Screenshot {active + 1} of {p.screenshots.length}. Use the arrow keys to browse.</p>
          </>}
        </div>
        <section className="project-about"><h2>About the project</h2><p>{p.description}</p></section>
      </div>
      <aside className="detail-sidebar">
        <h3>Explore the work</h3>
        {p.demoUrl && <a className="button primary full" href={p.demoUrl} target="_blank" rel="noopener noreferrer">Live demo<span className="sr-only"> (opens in a new tab)</span><ArrowUpRight size={17} aria-hidden="true"/></a>}
        {p.githubUrl && <a className="button full" href={p.githubUrl} target="_blank" rel="noopener noreferrer"><Github size={18} aria-hidden="true"/>View repository<span className="sr-only"> (opens in a new tab)</span><ArrowUpRight size={16} aria-hidden="true"/></a>}
        {!p.githubUrl && !p.demoUrl && <p className="muted">No external links added yet.</p>}
        <div className="sidebar-section"><h3>Built with</h3><div className="tags">{p.techStack.map((technology, index) => <span key={`${technology}-${index}`}>{technology}</span>)}</div></div>
        <div className="sidebar-section"><h3><Users size={17} aria-hidden="true"/>The team</h3>{(p.teamMembers.length ? p.teamMembers : [p.owner.name]).map((name, index) => <div className="team-member" key={`${name}-${index}`}><span className="avatar small" aria-hidden="true">{initials(name)}</span>{name}</div>)}</div>
        <div className="sidebar-section muted"><p><Eye size={16} aria-hidden="true"/>{p.views} project {p.views === 1 ? 'view' : 'views'}</p><p>Added {new Date(p.createdAt).toLocaleDateString(undefined, {month: 'long', day: 'numeric', year: 'numeric'})}</p></div>
      </aside>
    </div>
  </div>;
}
