'use client';

import {useEffect} from 'react';
import Link from 'next/link';
import {Plus, Folder, Check, Clock, ArrowUpRight, Pencil, Image, Users, GitBranch, FileText, Bookmark} from 'lucide-react';
import type {Listing, Project, ProjectStatus, WorkspaceListing} from '@/lib/api';
import {useApiResource} from '@/lib/use-api-resource';
import {useCollectionQuery} from '@/lib/use-collection-query';
import {Pagination} from './pagination';
import {Guard, Loading, ErrorMessage} from './shell';
import {ProjectCard, ProjectCover} from './project-card';

export const statusLabels: Record<ProjectStatus, string> = {DRAFT: 'Draft', PENDING: 'Awaiting review', APPROVED: 'Published', CHANGES_REQUESTED: 'Changes requested', HIDDEN: 'Hidden'};
export function Status({value}: {value: string}) { return <span className={`status status-${value.toLowerCase()}`}>{statusLabels[value as ProjectStatus] || value}</span>; }
const workspaceQueryOptions = {statuses: Object.keys(statusLabels)};
const bookmarkQueryOptions = {};

export function Workspace() { return <Guard><WorkspaceContent/></Guard>; }

function WorkspaceContent() {
  const {query, ready, change} = useCollectionQuery('/workspace', workspaceQueryOptions);
  const {data, error, loading, reload} = useApiResource<WorkspaceListing>(ready ? `/my/projects?${new URLSearchParams({page: String(query.page), limit: '12', ...(query.status ? {status: query.status} : {})})}` : null);
  const projects = data?.items ?? null;
  const visible = projects ?? [];
  useEffect(() => {
    if (data && !loading && !error && query.page > Math.max(1, data.pages)) change({page: Math.max(1, data.pages)}, 'replace');
  }, [data, loading, error, query.page, change]);

  return <div className="page-container workspace-page">
    <div className="page-title"><div><h1>My workspace</h1><p>Your ideas, from first draft to published project.</p></div><Link href="/projects/new" className="button primary"><Plus size={18} aria-hidden="true"/>New project</Link></div>
    <div className="workspace-filter"><label>Project status<select value={query.status} onChange={event => change({status: event.target.value, page: 1})}><option value="">All projects</option>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}{data ? ` (${data.summary.byStatus[value as ProjectStatus]})` : ''}</option>)}</select></label>{data && <span role="status">{data.total} {query.status ? "matching " : ""}projects</span>}</div>
    <ErrorMessage message={error}/>
    {error && <div className="results-recovery"><button className="button" onClick={reload}>Try again</button>{projects && <p className="muted">Your previous project list is shown below.</p>}</div>}
    {(!projects && loading) || (data && query.page > Math.max(1, data.pages)) ? <Loading message="Loading your projects…"/> : data && projects && <>
      <div className="stats-row" aria-label="Project overview">
        <div><span className="stat-icon"><Folder aria-hidden="true"/></span><div><strong>{data.summary.total}</strong><span>Projects</span></div></div>
        <div><span className="stat-icon green"><Check aria-hidden="true"/></span><div><strong>{data.summary.published}</strong><span>Published</span></div></div>
        <div><span className="stat-icon amber"><Clock aria-hidden="true"/></span><div><strong>{data.summary.pending}</strong><span>Awaiting review</span></div></div>
      </div>
      <nav className="tab-bar" aria-label="Workspace navigation"><span className="active" aria-current="page">My projects</span><Link href="/profile">Profile</Link></nav>
      {visible.length ? <div className="project-table" role="table" aria-label="Your projects" aria-busy={loading}>
        <div className="table-head" role="row"><span role="columnheader">Project</span><span role="columnheader">Status</span><span role="columnheader">Updated</span><span role="columnheader">Actions</span></div>
        {visible.map(project => <div className="table-row" role="row" key={project.id}>
          <div className="table-project" role="cell"><Link href={`/projects/${project.id}`} className="table-thumbnail" aria-label={`View ${project.title}`}><ProjectCover project={project}/></Link><div><Link className="project-title" href={`/projects/${project.id}`}>{project.title}</Link><p>{project.description}</p><small>{project.techStack.slice(0, 3).join(' · ')}</small></div></div>
          <div role="cell"><Status value={project.status}/>{project.feedback && <p className="feedback-small">{project.feedback}</p>}</div>
          <span className="table-date" role="cell"><time dateTime={project.updatedAt}>{new Date(project.updatedAt).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'})}</time></span>
          <div className="row-actions" role="cell"><Link className="button compact" aria-label={`Edit ${project.title}`} href={`/projects/${project.id}/edit`}><Pencil size={15} aria-hidden="true"/>Edit</Link><Link className="icon-button" aria-label={`View ${project.title}`} href={`/projects/${project.id}`}><ArrowUpRight size={19} aria-hidden="true"/></Link></div>
        </div>)}
      </div> : data.summary.total > 0 ? <div className="empty"><Folder size={36} aria-hidden="true"/><h2>No projects with this status.</h2><p>Choose another status to find your work.</p><button className="button" onClick={() => change({status: '', page: 1})}>Show all projects</button></div> : <div className="empty"><Folder size={40} aria-hidden="true"/><h2>Your first project starts here.</h2><p>Build a home for your work. Save a draft and share it when you’re ready.</p><Link className="button primary" href="/projects/new">Create your first project</Link></div>}
    </>}
    <Pagination data={data} page={query.page} loading={loading} label="Workspace" onPage={page => change({page})}/>
    {data && projects && query.page <= Math.max(1, data.pages) && <>
      <section className="before-share"><h2>Before you share</h2><p>Make sure your project is complete and easy to understand.</p><div className="checklist">{[[Image, 'Screenshots', 'Show your project in action.'], [Users, 'Team', 'Give your collaborators credit.'], [GitBranch, 'Repository', 'Link to the code behind your idea.'], [FileText, 'Description', 'Share the problem and what you learned.']].map(([Icon, title, text]) => { const I = Icon as typeof Image; return <div key={String(title)}><I size={21} aria-hidden="true"/><strong>{String(title)}</strong><span>{String(text)}</span></div>; })}</div></section>
    </>}
  </div>;
}

export function Bookmarks() { return <Guard><BookmarkContent/></Guard>; }

function BookmarkContent() {
  const {query, ready, change} = useCollectionQuery('/bookmarks', bookmarkQueryOptions);
  const {data, error, loading, reload, setData} = useApiResource<Listing>(ready ? `/my/bookmarks?page=${query.page}&limit=12` : null);
  useEffect(() => {
    if (data && !loading && !error && query.page > Math.max(1, data.pages)) change({page: Math.max(1, data.pages)}, 'replace');
  }, [data, loading, error, query.page, change]);

  function update(project: Project) {
    if (!project.bookmarked) {
      setData(previous => previous ? {...previous, items: previous.items.filter(item => item.id !== project.id)} : previous);
      reload();
    } else {
      setData(previous => previous ? {...previous, items: previous.items.map(item => item.id === project.id ? project : item)} : previous);
    }
  }

  return <div className="page-container">
    <div className="page-title"><div><h1>Saved inspiration</h1><p>Good ideas are worth coming back to.</p></div><Bookmark size={28} aria-hidden="true"/></div>
    <ErrorMessage message={error}/>
    {error && <div className="results-recovery"><button className="button" onClick={reload}>Try again</button>{data && <p className="muted">Your previous collection is shown below.</p>}</div>}
    {(!data && loading) || (data && query.page > Math.max(1, data.pages)) ? <Loading message="Loading saved projects…"/> : data?.items.length ? <>
      <p className="collection-count" role="status">{data.total} saved {data.total === 1 ? 'project' : 'projects'}</p>
      <div className="project-grid bookmarks-grid" aria-busy={loading}>{data.items.map(project => <ProjectCard project={project} onUpdate={update} key={project.id}/>)}</div>
    </> : loading ? <Loading message="Refreshing saved projects…"/> : !error && <div className="empty"><Bookmark size={40} aria-hidden="true"/><h2>Your collection is waiting.</h2><p>Save projects from Explore and find them here.</p><Link className="button primary" href="/">Explore projects</Link></div>}
    <Pagination data={data} page={query.page} loading={loading} label="Bookmarks" onPage={page => change({page})}/>
  </div>;
}
