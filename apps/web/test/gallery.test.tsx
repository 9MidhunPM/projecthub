import './dom-setup';
import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {act, cleanup, fireEvent, waitFor} from '@testing-library/react';
import Explore from '../app/page';
import {deferred, project, renderApp} from './component-helpers';

const originalFetch = globalThis.fetch;
const empty = {items: [], total: 0, page: 1, limit: 6, pages: 0};
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; window.history.replaceState({}, '', '/'); });

function galleryFetch(handler: (url: string) => Promise<Response>) {
  globalThis.fetch = async url => String(url).includes('/auth/me') ? new Response('{}', {status: 401}) : handler(String(url));
}

test('empty gallery offers the first project action without irrelevant filter resets', async () => {
  galleryFetch(async () => Response.json(empty));
  const view = renderApp(<Explore/>);
  await waitFor(() => assert.ok(view.getByRole('link', {name: 'Share the first project'})));
  assert.equal(view.queryByRole('button', {name: 'Clear filters'}), null);
});

test('URL filters restore controls and browser back restores the previous selection', async () => {
  window.history.replaceState({}, '', '/?q=campus&sort=popular');
  galleryFetch(async () => Response.json(empty));
  const view = renderApp(<Explore/>);
  await waitFor(() => assert.ok(view.getByText('No matching projects')));
  assert.equal((view.getByRole('searchbox', {name: 'Search projects'}) as HTMLInputElement).value, 'campus');
  assert.equal((view.getByRole('combobox', {name: 'Sort projects'}) as HTMLSelectElement).value, 'popular');
  fireEvent.change(view.getByLabelText('Department'), {target: {value: 'Design'}});
  await waitFor(() => assert.equal(new URLSearchParams(window.location.search).get('department'), 'Design'));
  await act(async () => { window.history.back(); });
  await waitFor(() => assert.equal((view.getByLabelText('Department') as HTMLSelectElement).value, ''));
  assert.equal(new URLSearchParams(window.location.search).get('q'), 'campus');
  assert.equal(view.getAllByRole('button', {name: 'Clear filters'}).length, 1);
});

test('failed filtered searches retain a clear action and recover on retry', async () => {
  window.history.replaceState({}, '', '/?q=campus');
  let calls = 0;
  galleryFetch(async () => { calls += 1; return calls === 1 ? new Response('unavailable', {status: 502}) : Response.json(empty); });
  const view = renderApp(<Explore/>);
  await waitFor(() => assert.ok(view.getByRole('alert')));
  assert.ok(view.getByRole('button', {name: 'Clear filters'}));
  assert.equal(view.queryByText('0 projects'), null);
  fireEvent.click(view.getByRole('button', {name: 'Try again'}));
  await waitFor(() => assert.ok(view.getByText('No matching projects')));
  assert.equal(calls, 2);
});

test('late search responses cannot replace newer results', async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  let calls = 0;
  galleryFetch(async () => { calls += 1; return calls === 1 ? first.promise : second.promise; });
  const view = renderApp(<Explore/>);
  await waitFor(() => assert.equal(calls, 1));
  fireEvent.change(view.getByRole('searchbox', {name: 'Search projects'}), {target: {value: 'new'}});
  await waitFor(() => assert.equal(calls, 2));
  await act(async () => second.resolve(Response.json({items: [{...project, title: 'New result'}], total: 1, page: 1, limit: 6, pages: 1})));
  await waitFor(() => assert.ok(view.getByRole('article', {name: 'New result'})));
  await act(async () => first.resolve(Response.json({items: [{...project, title: 'Old result'}], total: 1, page: 1, limit: 6, pages: 1})));
  assert.equal(view.queryByRole('article', {name: 'Old result'}), null);
});
