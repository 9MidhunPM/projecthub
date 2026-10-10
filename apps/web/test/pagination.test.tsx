import './dom-setup';
import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {act, cleanup, fireEvent, waitFor} from '@testing-library/react';
import {Admin} from '../components/account';
import {AuditHistory} from '../components/audit-history';
import {Moderation} from '../components/moderation';
import {Bookmarks, Workspace} from '../components/workspace';
import {deferred, listing, project, renderApp, student, workspaceSummary} from './component-helpers';

const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; window.history.replaceState({}, '', '/'); });

const workflows = [
  {label: 'Workspace', path: '/workspace', element: <Workspace/>, endpoint: '/my/projects', limit: 12, item: project, summary: {summary: workspaceSummary}},
  {label: 'Bookmarks', path: '/bookmarks', element: <Bookmarks/>, endpoint: '/my/bookmarks', limit: 12, item: {...project, bookmarked: true}},
  {label: 'Review', path: '/moderation', element: <Moderation/>, endpoint: '/moderation/projects', limit: 12, item: {...project, status: 'PENDING'}},
  {label: 'People', path: '/admin', element: <Admin/>, endpoint: '/admin/users', limit: 25, item: student},
  {label: 'Audit', path: '/admin', element: <AuditHistory revision={0}/>, endpoint: '/admin/audit', limit: 25, item: {id: 'audit-1', actorId: 'admin-1', targetId: student.id, action: 'CHANGE_ROLE', details: '{"role":"FACULTY"}', createdAt: project.createdAt}},
];

for (const workflow of workflows) test(`${workflow.label} pagination keeps deliberate focus through a deferred page load`, async () => {
  const response = deferred<Response>();
  globalThis.fetch = async url => {
    if (String(url).endsWith('/auth/me')) return Response.json({...student, id: 'admin-1', role: 'ADMIN'});
    if (!String(url).includes(workflow.endpoint)) return Response.json(listing([], 0, 1, 25));
    const page = Number(new URL(String(url), 'http://localhost:3000').searchParams.get('page'));
    if (page === 2) return response.promise;
    return Response.json({...listing([workflow.item], workflow.limit + 1, page, workflow.limit), ...workflow.summary});
  };
  const view = renderApp(workflow.element, workflow.path);
  await waitFor(() => assert.ok(view.getByRole('button', {name: `Next ${workflow.label.toLowerCase()} page`})));
  const nav = view.getByRole('navigation', {name: `${workflow.label} pages`});
  const next = view.getByRole('button', {name: `Next ${workflow.label.toLowerCase()} page`});
  next.focus();
  fireEvent.click(next);
  assert.ok(view.queryByRole('navigation', {name: `${workflow.label} pages`}) === nav, 'pager remains mounted while loading');
  assert.ok(nav.contains(document.activeElement), 'focus stays inside the pager while loading');
  await act(async () => response.resolve(Response.json({...listing([workflow.item], workflow.limit + 1, 2, workflow.limit), ...workflow.summary})));
  await waitFor(() => assert.ok(view.getByText('Page 2 of 2')));
  assert.ok(document.activeElement === view.getByText('Page 2 of 2'), 'loaded page status retains focus');
  assert.equal((view.getByRole('button', {name: `Previous ${workflow.label.toLowerCase()} page`}) as HTMLButtonElement).disabled, false);
});

test('failed page navigation retains pager focus and permits returning to the previous page', async () => {
  const response = deferred<Response>();
  globalThis.fetch = async url => {
    if (String(url).endsWith('/auth/me')) return Response.json(student);
    const page = Number(new URL(String(url), 'http://localhost:3000').searchParams.get('page'));
    return page === 2 ? response.promise : Response.json({...listing([project], 13, 1), summary: workspaceSummary});
  };
  const view = renderApp(<Workspace/>, '/workspace');
  await waitFor(() => assert.ok(view.getByRole('button', {name: 'Next workspace page'})));
  const next = view.getByRole('button', {name: 'Next workspace page'});
  next.focus();
  fireEvent.click(next);
  await act(async () => response.resolve(Response.json({message: 'Page temporarily unavailable'}, {status: 503})));
  await waitFor(() => assert.ok(view.getByRole('alert')));
  assert.ok(document.activeElement === view.getByText('Page 2 unavailable'));
  const previous = view.getByRole('button', {name: 'Previous workspace page'}) as HTMLButtonElement;
  assert.equal(previous.disabled, false);
  fireEvent.click(previous);
  await waitFor(() => assert.ok(view.getByText('Page 1 of 2')));
});
