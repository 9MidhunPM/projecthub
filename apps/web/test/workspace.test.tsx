import './dom-setup';
import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {act, cleanup, fireEvent, waitFor} from '@testing-library/react';
import {Bookmarks, Workspace} from '../components/workspace';
import {listing, project, renderApp, student, workspaceSummary} from './component-helpers';

const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; window.history.replaceState({}, '', '/'); });

function params(url: RequestInfo | URL) { return new URL(String(url), 'http://localhost:3000').searchParams; }

test('workspace retries failed loads, uses global summaries, and filters on the server', async () => {
  const requests: string[] = [];
  globalThis.fetch = async url => {
    if (String(url).endsWith('/auth/me')) return Response.json(student);
    requests.push(String(url));
    if (requests.length === 1) return new Response('{}', {status: 503});
    const status = params(url).get('status');
    return Response.json({...listing(status === 'HIDDEN' ? [] : [project], status === 'HIDDEN' ? 0 : status ? 1 : 13), summary: workspaceSummary});
  };
  const view = renderApp(<Workspace/>, '/workspace');
  await waitFor(() => assert.ok(view.getByRole('alert')));
  fireEvent.click(view.getByRole('button', {name: 'Try again'}));
  await waitFor(() => assert.ok(view.getByRole('table', {name: 'Your projects'})));
  assert.deepEqual([...view.container.querySelectorAll('.stats-row strong')].map(item => item.textContent), ['13', '9', '4']);
  fireEvent.change(view.getByLabelText('Project status'), {target: {value: 'HIDDEN'}});
  await waitFor(() => assert.ok(view.getByText('No projects with this status.')));
  assert.ok(requests.at(-1)?.includes('status=HIDDEN'));
  fireEvent.click(view.getByRole('button', {name: 'Show all projects'}));
  await waitFor(() => assert.ok(view.getByRole('link', {name: project.title})));
  assert.equal(new URLSearchParams(window.location.search).get('status'), null);
});

test('workspace page and filter URLs restore with Back, and changing status resets page one', async () => {
  window.history.replaceState({}, '', '/workspace?page=2&status=APPROVED');
  const requests: string[] = [];
  globalThis.fetch = async url => {
    if (String(url).endsWith('/auth/me')) return Response.json(student);
    requests.push(String(url));
    const page = Number(params(url).get('page'));
    return Response.json({...listing([{...project, title: `Project page ${page}`}], 13, page), summary: workspaceSummary});
  };
  const view = renderApp(<Workspace/>, '/workspace');
  await waitFor(() => assert.ok(view.getByText('Page 2 of 2')));
  fireEvent.click(view.getByRole('button', {name: 'Previous workspace page'}));
  await waitFor(() => assert.ok(view.getByText('Page 1 of 2')));
  await act(async () => { window.history.back(); });
  await waitFor(() => assert.ok(view.getByText('Page 2 of 2')));
  fireEvent.change(view.getByLabelText('Project status'), {target: {value: 'PENDING'}});
  await waitFor(() => assert.ok(requests.at(-1)?.includes('page=1') && requests.at(-1)?.includes('status=PENDING')));
});

test('removing the last item on a bookmark page reloads it before stepping back', async () => {
  window.history.replaceState({}, '', '/bookmarks?page=2');
  let removed = false;
  const pages: number[] = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/auth/me')) return Response.json(student);
    if (options?.method === 'DELETE') { removed = true; return Response.json({likes: 0, liked: false, bookmarked: false}); }
    const page = Number(params(url).get('page'));
    pages.push(page);
    return Response.json(listing(removed && page === 2 ? [] : [{...project, bookmarked: true, title: removed ? 'Earlier saved project' : project.title}], removed ? 12 : 13, page));
  };
  const view = renderApp(<Bookmarks/>, '/bookmarks');
  await waitFor(() => assert.ok(view.getByRole('button', {name: `Unsave ${project.title}`})));
  fireEvent.click(view.getByRole('button', {name: `Unsave ${project.title}`}));
  await waitFor(() => assert.ok(view.getByRole('article', {name: 'Earlier saved project'})));
  assert.deepEqual(pages, [2, 2, 1]);
  assert.equal(window.location.search, '');
});

test('failed bookmark refill stays recoverable and never invents an empty collection', async () => {
  let removed = false;
  let failed = false;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/auth/me')) return Response.json(student);
    if (options?.method === 'DELETE') { removed = true; return Response.json({likes: 0, liked: false, bookmarked: false}); }
    if (removed && !failed) { failed = true; return new Response('{}', {status: 503}); }
    return Response.json(listing(removed ? [] : [{...project, bookmarked: true}]));
  };
  const view = renderApp(<Bookmarks/>, '/bookmarks');
  await waitFor(() => assert.ok(view.getByRole('button', {name: `Unsave ${project.title}`})));
  fireEvent.click(view.getByRole('button', {name: `Unsave ${project.title}`}));
  await waitFor(() => assert.ok(view.getByRole('alert')));
  assert.equal(view.queryByText('Your collection is waiting.'), null);
  fireEvent.click(view.getByRole('button', {name: 'Try again'}));
  await waitFor(() => assert.ok(view.getByText('Your collection is waiting.')));
});
