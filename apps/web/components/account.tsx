'use client';

import {useEffect, useRef, useState} from 'react';
import {api, Page, User, departments, initials, isAbortError} from '@/lib/api';
import {useApiResource} from '@/lib/use-api-resource';
import {useCollectionQuery} from '@/lib/use-collection-query';
import {Pagination} from './pagination';
import {Guard, useApp, ErrorMessage, Loading} from './shell';

export function Profile() { return <Guard><ProfileForm/></Guard>; }

function ProfileForm() {
  const {user, refresh, notify} = useApp();
  const [form, setForm] = useState({name: user!.name, department: user!.department, semester: String(user!.semester), bio: user!.bio ?? ''});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const errorSummary = useRef<HTMLDivElement>(null);

  useEffect(() => () => { request.current?.abort(); }, []);
  useEffect(() => { if (error) errorSummary.current?.focus(); }, [error]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    if (form.name.trim().length < 2) { setError('Enter your full name using at least 2 characters.'); return; }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      const updated = await api<User>('/profile', {method: 'PATCH', body: JSON.stringify({...form, name: form.name.trim(), bio: form.bio.trim(), semester: Number(form.semester)}), signal: controller.signal});
      if (controller.signal.aborted) return;
      setForm({name: updated.name, department: updated.department, semester: String(updated.semester), bio: updated.bio ?? ''});
      await refresh();
      if (!controller.signal.aborted) notify('Profile updated.');
    } catch (failure) {
      if (!controller.signal.aborted && !isAbortError(failure)) setError((failure as Error).message);
    } finally {
      if (!controller.signal.aborted) { request.current = null; setBusy(false); }
    }
  }

  return <div className="page-container profile-page">
    <div className="page-title"><div><h1>A little about you.</h1><p>Put a person behind the projects.</p></div></div>
    <section className="form-panel">
      <div className="profile-heading"><span className="avatar large" aria-hidden="true">{initials(user!.name)}</span><div><h2>{user!.name}</h2><p>{user!.email}</p><span className="status">{user!.role.toLowerCase()}</span></div></div>
      <form onSubmit={save} aria-busy={busy}>
        <div ref={errorSummary} tabIndex={-1} className="form-error-summary"><ErrorMessage message={error}/></div>
        <fieldset className="form-fields" disabled={busy}>
          <label>Full name<input name="name" autoComplete="name" required minLength={2} maxLength={80} value={form.name} onChange={event => setForm(previous => ({...previous, name: event.target.value}))}/></label>
          <div className="form-grid">
            <label>Department<select name="department" value={form.department} onChange={event => setForm(previous => ({...previous, department: event.target.value}))}>{!departments.includes(form.department) && <option>{form.department}</option>}{departments.map(department => <option key={department}>{department}</option>)}</select></label>
            <label>Semester<select name="semester" value={form.semester} onChange={event => setForm(previous => ({...previous, semester: event.target.value}))}>{Array.from({length: 12}, (_, index) => <option value={index + 1} key={index}>Semester {index + 1}</option>)}</select></label>
          </div>
          <label>Bio <span className="optional">(optional)</span><textarea name="bio" rows={4} maxLength={1000} value={form.bio} onChange={event => setForm(previous => ({...previous, bio: event.target.value}))} aria-describedby="bio-hint" placeholder="What are you curious about?"/></label>
          <p id="bio-hint" className="field-hint">{form.bio.length}/1,000 characters. Profile details can be included with your published projects.</p>
          <button className="button primary" type="submit" disabled={busy}>{busy ? 'Saving profile…' : 'Save profile'}</button>
        </fieldset>
      </form>
    </section>
  </div>;
}

const peopleQueryOptions = {people: true};

export function Admin() { return <Guard roles={['ADMIN']}><AdminContent/></Guard>; }

function AdminContent() {
  const {user, notify} = useApp();
  const {query, ready, change: changeQuery} = useCollectionQuery('/admin', peopleQueryOptions);
  const {data: users, error: loadError, loading, reload, setData} = useApiResource<Page<User>>(ready ? `/admin/users?${new URLSearchParams({page: String(query.page), limit: '25', ...(query.q ? {q: query.q} : {}), ...(query.role ? {role: query.role} : {})})}` : null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [search, setSearch] = useState('');
  const request = useRef<AbortController | null>(null);
  const visible = users?.items ?? [];

  useEffect(() => { setSearch(query.q); }, [query.q]);
  useEffect(() => {
    if (!ready || search.trim() === query.q) return;
    const timer = window.setTimeout(() => changeQuery({q: search, page: 1}, 'replace'), 250);
    return () => window.clearTimeout(timer);
  }, [search, query.q, ready, changeQuery]);
  useEffect(() => {
    if (users && !loading && !loadError && query.page > Math.max(1, users.pages)) changeQuery({page: Math.max(1, users.pages)}, 'replace');
  }, [users, loading, loadError, query.page, changeQuery]);

  useEffect(() => () => { request.current?.abort(); }, []);

  async function change(target: User, nextRole: User['role']) {
    if (request.current || nextRole === target.role || target.id === user?.id) return;
    if (!window.confirm(`Change ${target.name} (${target.email}) from ${target.role.toLowerCase()} to ${nextRole.toLowerCase()}? This changes their access to ProjectHub.`)) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(target.id);
    setError('');
    try {
      const updated = await api<User>(`/admin/users/${target.id}/role`, {method: 'PATCH', body: JSON.stringify({role: nextRole}), signal: controller.signal});
      if (controller.signal.aborted) return;
      setData(previous => previous ? {...previous, items: previous.items.flatMap(account => account.id !== target.id ? [account] : !query.role || updated.role === query.role ? [updated] : [])} : previous);
      reload();
      notify(`${target.name}'s role is now ${nextRole.toLowerCase()}.`);
    } catch (failure) {
      if (!controller.signal.aborted && !isAbortError(failure)) setError((failure as Error).message);
    } finally {
      if (!controller.signal.aborted) { request.current = null; setBusy(''); }
    }
  }

  return <div className="page-container">
    <div className="page-title"><div><h1>People & permissions</h1><p>Manage who can share, review, and administer your community.</p></div></div>
    <ErrorMessage message={loadError || error}/>
    {loadError && <div className="results-recovery"><button className="button" onClick={reload}>Try again</button></div>}
    <div className="people-filters">
      <label className="people-search">Find a person<input type="search" placeholder="Search by name or email" aria-label="Search users" maxLength={254} disabled={Boolean(busy)} value={search} onChange={event => setSearch(event.target.value)}/></label>
      <label>Role<select value={query.role} disabled={Boolean(busy)} onChange={event => changeQuery({role: event.target.value, q: search, page: 1})}><option value="">All roles</option><option value="STUDENT">Student</option><option value="FACULTY">Faculty</option><option value="ADMIN">Admin</option></select></label>
    </div>
    {(!users && loading) || (users && query.page > Math.max(1, users.pages)) ? <Loading message="Loading people…"/> : users && <>
      <p className="collection-count" role="status">{users.total} {query.q || query.role ? 'matching ' : ''}{users.total === 1 ? 'person' : 'people'}{busy ? ' · Updating role…' : ''}</p>
      {visible.length ? <div className="users-list" aria-label="People" role="list" aria-busy={Boolean(busy) || loading}>{visible.map(account => <div className="user-row" role="listitem" key={account.id}>
        <span className="avatar" aria-hidden="true">{initials(account.name)}</span><div className="user-info"><strong>{account.name}{account.id === user?.id ? ' (you)' : ''}</strong><span>{account.email}</span></div><span className="user-department">{account.department}</span>
        <label className="sr-only" htmlFor={`role-${account.id}`}>Role for {account.name}</label><select id={`role-${account.id}`} value={account.role} disabled={Boolean(busy) || loading || account.id === user?.id} onChange={event => void change(account, event.target.value as User['role'])}><option value="STUDENT">Student</option><option value="FACULTY">Faculty</option><option value="ADMIN">Admin</option></select>
      </div>)}</div> : <div className="empty"><h2>{query.q || query.role ? 'No people match these filters.' : 'No accounts to show.'}</h2>{(query.q || query.role) && <button className="button" onClick={() => { setSearch(''); changeQuery({q: '', role: '', page: 1}); }}>Clear people filters</button>}</div>}
      <Pagination data={users} busy={loading || Boolean(busy) || Boolean(loadError) || search.trim() !== query.q} label="People" onPage={page => changeQuery({page})}/>
    </>}
    <p className="muted small-note">Faculty can review project submissions. Administrators can also manage user roles. Your own role cannot be changed here.</p>
  </div>;
}
