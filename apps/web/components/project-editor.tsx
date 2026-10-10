'use client';

import {useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ArrowLeft, Upload, X, Save, Send, Trash2} from 'lucide-react';
import {api, Project, departments, projectTypes, isAbortError} from '@/lib/api';
import {projectPayload, ProjectForm, projectToForm, validateProjectForm} from '@/lib/project-form';
import {Guard, useApp, ErrorMessage, Loading} from './shell';

type SaveAction = 'draft' | 'submit' | 'delete';

export function ProjectEditor({id}: {id?: string}) { return <Guard><Editor key={id ?? 'new'} id={id}/></Guard>; }

function Editor({id}: {id?: string}) {
  const {user, notify} = useApp();
  const router = useRouter();
  const [form, setForm] = useState<ProjectForm>({title: '', description: '', department: user?.department || departments[0], semester: String(user?.semester || 1), type: projectTypes[0], techStack: '', teamMembers: user?.name || '', githubUrl: '', demoUrl: ''});
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [loading, setLoading] = useState(Boolean(id));
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<SaveAction | null>(null);
  const [uploading, setUploading] = useState(false);
  const [original, setOriginal] = useState<Project | null>(null);
  const [retry, setRetry] = useState(0);
  const [savedDraft, setSavedDraft] = useState(false);
  const pending = useRef(false);
  const savedId = useRef(id);
  const errorSummary = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    api<Project>(`/projects/${id}`, {signal: controller.signal}).then(project => {
      if (controller.signal.aborted) return;
      setOriginal(project);
      setForm(projectToForm(project));
      setScreenshots(project.screenshots);
    }).catch(failure => {
      if (!controller.signal.aborted && !isAbortError(failure)) setLoadError(failure.message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, retry]);

  useEffect(() => { if (error) errorSummary.current?.focus(); }, [error]);
  const update = (key: keyof ProjectForm, value: string) => setForm(previous => ({...previous, [key]: value}));

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || uploading) return;
    const validation = validateProjectForm(form);
    if (validation) { setError(validation); return; }
    const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'submit' ? 'submit' : 'draft';
    pending.current = true;
    setBusy(action);
    setError('');
    setSavedDraft(false);
    try {
      const currentId = savedId.current;
      const saved = await api<Project>(currentId ? `/projects/${currentId}` : '/projects', {
        method: currentId ? 'PATCH' : 'POST', body: JSON.stringify(projectPayload(form, screenshots)),
      });
      // Keep the created ID before submission. Retrying a failed second step
      // must update this draft instead of creating another project.
      savedId.current = saved.id;
      setOriginal(saved);
      if (action === 'submit') {
        try {
          await api(`/projects/${saved.id}/submit`, {method: 'POST'});
        } catch (failure) {
          setSavedDraft(true);
          setError(`Your draft was saved, but it could not be submitted: ${(failure as Error).message}`);
          return;
        }
      }
      notify(action === 'submit' ? 'Project submitted for review.' : 'Draft saved.');
      router.push('/workspace');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  async function upload(files: FileList | null) {
    if (!files || uploading || pending.current) return;
    setUploading(true);
    setError('');
    try {
      if (screenshots.length + files.length > 8) throw new Error('You can add up to 8 screenshots.');
      for (const file of Array.from(files)) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Please choose PNG, JPEG or WebP images.');
        if (file.size > 5 * 1024 * 1024) throw new Error('Each screenshot must be 5 MB or smaller.');
        const body = new FormData();
        body.append('file', file);
        const result = await api<{url: string}>('/uploads', {method: 'POST', body});
        setScreenshots(previous => [...previous, result.url]);
      }
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function remove() {
    const currentId = savedId.current;
    if (!currentId || pending.current || uploading || !window.confirm('Delete this project? This cannot be undone.')) return;
    pending.current = true;
    setBusy('delete');
    setError('');
    try {
      await api(`/projects/${currentId}`, {method: 'DELETE'});
      notify('Project deleted.');
      router.push('/workspace');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  if (loading) return <Loading message="Loading your project…"/>;
  if (loadError) return <div className="page-container"><Link className="back-link" href="/workspace"><ArrowLeft size={16}/>My workspace</Link><h1>We couldn’t load this project.</h1><div className="load-recovery"><ErrorMessage message={loadError}/><button className="button primary" onClick={() => setRetry(value => value + 1)}>Try again</button></div></div>;
  if (original && original.ownerId !== user?.id) return <div className="empty"><h1>You can only edit your own projects.</h1><p>Return to your workspace to choose one of your projects.</p><Link className="button" href="/workspace">My workspace</Link></div>;

  return <div className="page-container editor-page">
    <Link className="back-link" href="/workspace"><ArrowLeft size={16} aria-hidden="true"/>My workspace</Link>
    <div className="page-title"><div><h1>{savedId.current ? 'Refine your project.' : 'Bring your idea to life.'}</h1><p>{savedId.current ? 'Keep your project story clear, current, and complete.' : 'Tell the story behind what you built.'}</p></div></div>
    <form onSubmit={save} aria-busy={Boolean(busy)}>
      <fieldset className="editor-fields" disabled={Boolean(busy)}>
        <div className="editor-grid">
          <section className="form-panel">
            <h2>Project details</h2>
            <div ref={errorSummary} tabIndex={-1} className="form-error-summary"><ErrorMessage message={error}/>{savedDraft && <Link className="text-link" href="/workspace">Find your saved draft in My workspace</Link>}</div>
            {original && ['APPROVED', 'PENDING'].includes(original.status) && <div className="review-note">Saving edits returns this project to draft and removes it from Explore until it is approved again.</div>}
            <label>Project title<input name="title" required minLength={3} maxLength={120} value={form.title} onChange={event => update('title', event.target.value)} placeholder="Give your project a clear, memorable name"/></label>
            <label>Description<textarea name="description" required minLength={20} maxLength={20000} rows={7} value={form.description} onChange={event => update('description', event.target.value)} aria-describedby="description-hint" placeholder="What problem does it solve? What did you build, and what did you learn?"/><small id="description-hint">20–20,000 characters. Make it understandable to someone seeing it for the first time. {form.description.length.toLocaleString()} used.</small></label>
            <div className="form-grid">
              <label>Department<select value={form.department} onChange={event => update('department', event.target.value)}>{!departments.includes(form.department) && <option>{form.department}</option>}{departments.map(department => <option key={department}>{department}</option>)}</select></label>
              <label>Semester<select value={form.semester} onChange={event => update('semester', event.target.value)}>{Array.from({length: 12}, (_, index) => <option key={index} value={index + 1}>Semester {index + 1}</option>)}</select></label>
            </div>
            <label>Project type<select value={form.type} onChange={event => update('type', event.target.value)}>{!projectTypes.includes(form.type) && <option>{form.type}</option>}{projectTypes.map(type => <option key={type}>{type}</option>)}</select></label>
            <label>Technologies<input value={form.techStack} required maxLength={840} onChange={event => update('techStack', event.target.value)} aria-describedby="technologies-hint" placeholder="React, Node.js, PostgreSQL"/><small id="technologies-hint">Separate technologies with commas. Up to 20 items, 40 characters each.</small></label>
            <label>Team members<input value={form.teamMembers} maxLength={1640} onChange={event => update('teamMembers', event.target.value)} aria-describedby="team-hint" placeholder="Your name, Teammate name"/><small id="team-hint">Separate names with commas. Up to 20 people, 80 characters each. Listed names will be public after approval.</small></label>
            <div className="form-grid">
              <label>GitHub repository <span className="optional">(optional)</span><input type="url" maxLength={2000} value={form.githubUrl} onChange={event => update('githubUrl', event.target.value)} placeholder="https://github.com/…"/></label>
              <label>Live demo <span className="optional">(optional)</span><input type="url" maxLength={2000} value={form.demoUrl} onChange={event => update('demoUrl', event.target.value)} placeholder="https://…"/></label>
            </div>
          </section>
          <aside className="editor-side">
            <section className="form-panel"><h2>Show your work</h2><p>A good screenshot helps people understand your idea at a glance.</p>
              <label className="upload-area"><Upload size={26} aria-hidden="true"/><strong>{uploading ? 'Uploading…' : 'Choose screenshots'}</strong><span>PNG, JPEG or WebP · up to 5 MB each</span><input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={event => { void upload(event.target.files); event.target.value = ''; }} disabled={uploading || Boolean(busy)}/></label>
              <div className="upload-previews">{screenshots.map((src, index) => <div key={`${src}-${index}`}><img src={src} alt={`Screenshot ${index + 1}`}/><button type="button" className="icon-button" disabled={uploading || Boolean(busy)} aria-label={`Remove screenshot ${index + 1}`} onClick={() => setScreenshots(previous => previous.filter((_, item) => item !== index))}><X size={16} aria-hidden="true"/></button></div>)}</div>
            </section>
            <section className="editor-help"><h3>Make it yours.</h3><p>Use your own screenshots and credit everyone who helped. Your project will be reviewed by faculty before it appears in Explore.</p><p>Save draft keeps your work private. Submit for review sends it to faculty.</p></section>
            {savedId.current && <button type="button" className="button danger" disabled={Boolean(busy) || uploading} onClick={remove}><Trash2 size={16} aria-hidden="true"/>{busy === 'delete' ? 'Deleting…' : 'Delete project'}</button>}
          </aside>
        </div>
      </fieldset>
      <div className="editor-footer"><Link href="/workspace" className="button">Cancel</Link><div>
        <button type="submit" name="action" value="draft" className="button" disabled={Boolean(busy) || uploading}><Save size={16} aria-hidden="true"/>{busy === 'draft' ? 'Saving draft…' : 'Save draft'}</button>
        <button type="submit" name="action" value="submit" className="button primary" disabled={Boolean(busy) || uploading}><Send size={16} aria-hidden="true"/>{busy === 'submit' ? 'Submitting…' : 'Submit for review'}</button>
      </div></div>
      <span role="status" className="sr-only">{busy === 'draft' ? 'Saving your draft' : busy === 'submit' ? 'Saving and submitting your project' : uploading ? 'Uploading screenshots' : ''}</span>
    </form>
  </div>;
}
