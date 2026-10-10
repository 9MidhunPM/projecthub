import './dom-setup';
import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {act, cleanup, fireEvent, waitFor} from '@testing-library/react';
import {Moderation} from '../components/moderation';
import {deferred, listing, project, renderApp, student} from './component-helpers';

const originalFetch = globalThis.fetch;
const originalConfirm = window.confirm;
const faculty = {...student, id: 'faculty-1', role: 'FACULTY'};
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; window.confirm = originalConfirm; window.history.replaceState({}, '', '/'); });

function queueFetch(mutate: (options: RequestInit | undefined) => Promise<Response>) {
  let removed = false;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/auth/me')) return Response.json(faculty);
    if (options?.method === 'PATCH') { const result = await mutate(options); if (result.ok) removed = true; return result; }
    return Response.json(listing(removed ? [] : [{...project, status: 'PENDING'}]));
  };
}

test('requesting changes requires feedback, focuses the field, and preserves it after conflict', async () => {
  let reviews = 0;
  const versions: number[] = [];
  queueFetch(async options => { reviews += 1; versions.push(JSON.parse(String(options?.body)).expectedVersion); return Response.json({message: 'The project changed. Refresh and try again.'}, {status: 409}); });
  const view = renderApp(<Moderation/>, '/moderation');
  await waitFor(() => assert.ok(view.getByRole('button', {name: 'Request changes'})));
  fireEvent.click(view.getByRole('button', {name: 'Request changes'}));
  assert.equal(reviews, 0);
  const field = view.getByLabelText('Feedback for the student') as HTMLTextAreaElement;
  assert.equal(document.activeElement, field);
  fireEvent.change(field, {target: {value: 'Please add a screenshot.'}});
  fireEvent.click(view.getByRole('button', {name: 'Request changes'}));
  await waitFor(() => assert.ok(view.getByRole('button', {name: 'Refresh this queue'})));
  assert.equal(field.value, 'Please add a screenshot.');
  assert.deepEqual(versions, [project.version]);
  fireEvent.click(view.getByRole('button', {name: 'Request changes'}));
  await waitFor(() => assert.deepEqual(versions, [project.version, project.version]));
});

test('publishing can be cancelled and repeated approval clicks issue one request', async () => {
  let reviews = 0;
  const request = deferred<Response>();
  queueFetch(async () => { reviews += 1; return request.promise; });
  const view = renderApp(<Moderation/>, '/moderation');
  await waitFor(() => assert.ok(view.getByRole('button', {name: 'Approve project'})));
  window.confirm = () => false;
  fireEvent.click(view.getByRole('button', {name: 'Approve project'}));
  assert.equal(reviews, 0);
  window.confirm = () => true;
  const approve = view.getByRole('button', {name: 'Approve project'});
  fireEvent.click(approve);
  fireEvent.click(approve);
  assert.equal(reviews, 1);
  assert.ok(view.getByRole('button', {name: 'Published'}).hasAttribute('disabled'));
  await act(async () => request.resolve(Response.json({...project, status: 'APPROVED'})));
  await waitFor(() => assert.ok(view.getByText('No projects are awaiting review.')));
});


test('reviewing the final row reloads the same page before moving to the remaining last page', async () => {
  window.history.replaceState({}, '', '/moderation?page=2');
  let removed = false;
  const pages: number[] = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/auth/me')) return Response.json(faculty);
    if (options?.method === 'PATCH') { removed = true; return Response.json({...project, status: 'APPROVED'}); }
    const page = Number(new URL(String(url), 'http://localhost:3000').searchParams.get('page'));
    pages.push(page);
    return Response.json(listing(removed && page === 2 ? [] : [{...project, status: 'PENDING', title: removed ? 'Next waiting project' : project.title}], removed ? 12 : 13, page));
  };
  window.confirm = () => true;
  const view = renderApp(<Moderation/>, '/moderation');
  await waitFor(() => assert.ok(view.getByText('Page 2 of 2')));
  fireEvent.click(view.getByRole('button', {name: 'Approve project'}));
  await waitFor(() => assert.ok(view.getByRole('heading', {name: 'Next waiting project'})));
  assert.deepEqual(pages, [2, 2, 1]);
  assert.equal(window.location.search, '');
});

test('feedback survives paging and status changes reset the page without approving stale snapshots', async () => {
  const requested: string[] = [];
  globalThis.fetch = async url => {
    if (String(url).endsWith('/auth/me')) return Response.json(faculty);
    requested.push(String(url));
    const search = new URL(String(url), 'http://localhost:3000').searchParams;
    const page = Number(search.get('page'));
    return Response.json(listing([{...project, id: `project-${page}`, title: `Review page ${page}`, status: search.get('status')}], 13, page));
  };
  const view = renderApp(<Moderation/>, '/moderation');
  await waitFor(() => assert.ok(view.getByLabelText('Feedback for the student')));
  fireEvent.change(view.getByLabelText('Feedback for the student'), {target: {value: 'Keep this unsent review note.'}});
  fireEvent.click(view.getByRole('button', {name: 'Next review page'}));
  await waitFor(() => assert.ok(view.getByRole('heading', {name: 'Review page 2'})));
  await act(async () => { window.history.back(); });
  await waitFor(() => assert.equal((view.getByLabelText('Feedback for the student') as HTMLTextAreaElement).value, 'Keep this unsent review note.'));
  fireEvent.click(view.getByRole('button', {name: 'Next review page'}));
  await waitFor(() => assert.ok(view.getByText('Page 2 of 2')));
  fireEvent.click(view.getByRole('button', {name: 'Published'}));
  await waitFor(() => assert.ok(requested.at(-1)?.includes('status=APPROVED&page=1')));
});
