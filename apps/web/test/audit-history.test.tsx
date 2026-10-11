import './dom-setup';
import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {act, cleanup, fireEvent, waitFor, within} from '@testing-library/react';
import {Admin} from '../components/account';
import {deferred, listing, renderApp, student} from './component-helpers';

const originalFetch = globalThis.fetch;
const administrator = {...student, id: 'admin-1', role: 'ADMIN'};
const entry = {id: 'audit-1', actorId: 'actor-identifier', targetId: 'target-identifier', action: 'CHANGE_ROLE', details: '{"role":"FACULTY"}', createdAt: '2026-10-10T12:00:00.000Z'};
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; window.history.replaceState({}, '', '/'); });

function auditFetch(handler: (url: string) => Promise<Response>) {
  globalThis.fetch = async url => String(url).endsWith('/auth/me') ? Response.json(administrator) : String(url).includes('/admin/audit?') ? handler(String(url)) : Response.json(listing([], 0, 1, 25));
}

test('audit loading, failure recovery and empty state are independent of the people list', async () => {
  const first = deferred<Response>();
  let calls = 0;
  auditFetch(async () => { calls += 1; return calls === 1 ? first.promise : Response.json(listing([], 0, 1, 25)); });
  const view = renderApp(<Admin/>, '/admin');
  await waitFor(() => assert.ok(view.getByText('Loading audit history…')));
  await waitFor(() => assert.ok(view.getByText('No accounts to show.')));
  await act(async () => first.resolve(new Response('{}', {status: 503})));
  await waitFor(() => assert.ok(view.getByRole('button', {name: 'Retry audit history'})));
  fireEvent.click(view.getByRole('button', {name: 'Retry audit history'}));
  await waitFor(() => assert.ok(view.getByText('No recorded changes yet.')));
});

test('audit pages traverse older changes without changing account search filters', async () => {
  window.history.replaceState({}, '', '/admin?q=student&role=STUDENT');
  const pages: number[] = [];
  auditFetch(async url => {
    const page = Number(new URL(url, 'http://localhost:3000').searchParams.get('page'));
    pages.push(page);
    return Response.json(listing([{...entry, id: `audit-${page}`, actorId: page === 2 ? 'older-actor' : entry.actorId}], 26, page, 25));
  });
  const view = renderApp(<Admin/>, '/admin');
  await waitFor(() => assert.ok(view.getByText('26 recorded changes')));
  const panel = within(view.getByRole('region', {name: 'Audit history'}));
  assert.ok(panel.getByText('Actor ID'));
  assert.ok(panel.getByText('Target ID'));
  assert.ok(panel.getByText('New role: Faculty'));
  fireEvent.click(panel.getByRole('button', {name: 'Next audit page'}));
  await waitFor(() => assert.ok(panel.getByText('older-actor')));
  assert.deepEqual(pages, [1, 2]);
  assert.equal(new URLSearchParams(window.location.search).get('q'), 'student');
  assert.equal(new URLSearchParams(window.location.search).get('role'), 'STUDENT');
});

test('non-admin users never request audit history', async () => {
  let auditReads = 0;
  globalThis.fetch = async url => {
    if (String(url).includes('/admin/audit')) auditReads += 1;
    return Response.json(student);
  };
  const view = renderApp(<Admin/>, '/admin');
  await waitFor(() => assert.ok(view.getByRole('heading', {name: 'This space needs a different role.'})));
  assert.equal(auditReads, 0);
  assert.equal(view.queryByRole('region', {name: 'Audit history'}), null);
});

test('audit feedback and unknown actions are escaped text, never markup', async () => {
  auditFetch(async () => Response.json(listing([{...entry, action: 'MODERATE_PROJECT', details: JSON.stringify({feedback: '<img src=x onerror=alert(1)>', unexpected: 'not displayed'})}], 1, 1, 25)));
  const view = renderApp(<Admin/>, '/admin');
  await waitFor(() => assert.ok(view.getByText('Feedback: <img src=x onerror=alert(1)>')));
  const panel = view.getByRole('region', {name: 'Audit history'});
  assert.equal(panel.querySelector('img'), null);
  assert.equal(panel.textContent?.includes('not displayed'), false);
});
