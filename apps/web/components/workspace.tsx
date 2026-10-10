'use client';

import {useState} from 'react';
import Link from 'next/link';
import {Plus, Folder, Check, Clock, ArrowUpRight, Pencil, Image, Users, GitBranch, FileText, Bookmark} from 'lucide-react';
import type {Project, ProjectStatus} from '@/lib/api';
import {useApiResource} from '@/lib/use-api-resource';
import {Guard, Loading, ErrorMessage} from './shell';
import {ProjectCard, ProjectCover} from './project-card';

export const statusLabels: Record<ProjectStatus, string> = {DRAFT: 'Draft', PENDING: 'Awaiting review', APPROVED: 'Published', CHANGES_REQUESTED: 'Changes requested', HIDDEN: 'Hidden'};
export function Status({value}: {value: string}) { return <span className={`status status-${value.toLowerCase()}`}>{statusLabels[value as ProjectStatus] || value}</span>; }
export function Workspace() { return <Guard><WorkspaceContent/></Guard>; }

function WorkspaceContent() {
  const {data: projects, error, loading, reload} = useApiResource<Project[]>('/my/projects');
  const [status, setStatus] = useState('');
  const visible = projects?.filter(project => !status || project.status === status) ?? [];

  return <div className="page-container workspace-page">
    <div className="page-title"><div><h1>My workspace</h1><p>Your ideas, from first draft to published project.</p></div><Link href="/projects/new" className="button primary"><Plus size={18} aria-hidden="true"/>New project</Link></div>
    <ErrorMessage message={error}/>
    {error && <div className="results-recovery"><button className="button" onClick={reload}>Try again</button>{projects && <p className="muted">Your previous project list is shown below.</p>}</div>}
    {!projects && loading ? <Loading message="Loading your projects…"/> : projects && <>
      <div className="stats-row" aria-label="Project overview">
        <div><span className="stat-icon"><Folder aria-hidden="true"/></span><div><strong>{projects.length}</strong><span>Projects</span></div></div>
        <div><span className="stat-icon green"><Check aria-hidden="true"/></span><div><strong>{projects.filter(project => project.status === 'APPROVED').length}</strong><span>Published</span></div></div>
        <div><span className="stat-icon amber"><Clock aria-hidden="true"/></span><div><strong>{projects.filter(project => project.status === 'PENDING').length}</strong><span>Awaiting review</span></div></div>
      </div>
      <nav className="tab-bar" aria-label="Workspace navigation"><span className="active" aria-current="page">My projects</span><Link href="/profile">Profile</Link></nav>
      {projects.length > 0 && <div className="workspace-filter"><label>Project status<select value={status} onChange={event => setStatus(event.target.value)}><option value="">All projects</option>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><span role="status">{visible.length} of {projects.length} projects</span></div>}
      {visible.length ? <div className="project-table" role="table" aria-label="Your projects" aria-busy={loading}>
        <div className="table-head" role="row"><span role="columnheader">Project</span><span role="columnheader">Status</span><span role="columnheader">Updated</span><span role="columnheader">Actions</span></div>
        {visible.map(project => <div className="table-row" role="row" key={project.id}>
          <div className="table-project" role="cell"><Link href={`/projects/${project.id}`} className="table-thumbnail" aria-label={`View ${project.title}`}><ProjectCover project={project}/></Link><div><Link className="project-title" href={`/projects/${project.id}`}>{project.title}</Link><p>{project.description}</p><small>{project.techStack.slice(0, 3).join(' · ')}</small></div></div>
          <div role="cell"><Status value={project.status}/>{project.feedback && <p className="feedback-small">{project.feedback}</p>}</div>
          <span className="table-date" role="cell"><time dateTime={project.updatedAt}>{new Date(project.updatedAt).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'})}</time></span>
          <div className="row-actions" role="cell"><Link className="button compact" aria-label={`Edit ${project.title}`} href={`/projects/${project.id}/edit`}><Pencil size={15} aria-hidden="true"/>Edit</Link><Link className="icon-button" aria-label={`View ${project.title}`} href={`/projects/${project.id}`}><ArrowUpRight size={19} aria-hidden="true"/></Link></div>
        </div>)}
      </div> : projects.length ? <div className="empty"><Folder size={36} aria-hidden="true"/><h2>No projects with this status.</h2><p>Choose another status to find your work.</p><button className="button" onClick={() => setStatus('')}>Show all projects</button></div> : <div className="empty"><Folder size={40} aria-hidden="true"/><h2>Your first project starts here.</h2><p>Build a home for your work. Save a draft and share it when you’re ready.</p><Link className="button primary" href="/projects/new">Create your first project</Link></div>}
      <section className="before-share"><h2>Before you share</h2><p>Make sure your project is complete and easy to understand.</p><div className="checklist">{[[Image, 'Screenshots', 'Show your project in action.'], [Users, 'Team', 'Give your collaborators credit.'], [GitBranch, 'Repository', 'Link to the code behind your idea.'], [FileText, 'Description', 'Share the problem and what you learned.']].map(([Icon, title, text]) => { const I = Icon as typeof Image; return <div key={String(title)}><I size={21} aria-hidden="true"/><strong>{String(title)}</strong><span>{String(text)}</span></div>; })}</div></section>
    </>}
  </div>;
}

export function Bookmarks() { return <Guard><BookmarkContent/></Guard>; }

function BookmarkContent() {
  const {data, error, loading, reload, setData} = useApiResource<Project[]>('/my/bookmarks');

  function update(project: Project) {
    setData(previous => previous ? previous.flatMap(item => item.id !== project.id ? [item] : project.bookmarked ? [project] : []) : previous);
  }

  return <div className="page-container">
    <div className="page-title"><div><h1>Saved inspiration</h1><p>Good ideas are worth coming back to.</p></div><Bookmark size={28} aria-hidden="true"/></div>
    <ErrorMessage message={error}/>
    {error && <div className="results-recovery"><button className="button" onClick={reload}>Try again</button>{data && <p className="muted">Your previous collection is shown below.</p>}</div>}
    {!data && loading ? <Loading message="Loading saved projects…"/> : data?.length ? <>
      <p className="collection-count" role="status">{data.length} saved {data.length === 1 ? 'project' : 'projects'}</p>
      <div className="project-grid bookmarks-grid" aria-busy={loading}>{data.map(project => <ProjectCard project={project} onUpdate={update} key={project.id}/>)}</div>
    </> : !error && <div className="empty"><Bookmark size={40} aria-hidden="true"/><h2>Your collection is waiting.</h2><p>Save projects from Explore and find them here.</p><Link className="button primary" href="/">Explore projects</Link></div>}
  </div>;
}
