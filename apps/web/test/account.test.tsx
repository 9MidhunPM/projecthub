import './dom-setup';
import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {act, cleanup, fireEvent, waitFor} from '@testing-library/react';
import {Admin, Profile} from '../components/account';
import {deferred, listing, renderApp, student} from './component-helpers';

const originalFetch = globalThis.fetch;
const originalConfirm = window.confirm;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; window.confirm = originalConfirm; window.history.replaceState({}, '', '/'); });

test('profile failures retain edits and repeated clicks do not send parallel saves', async () => {
  const response = deferred<Response>();
  let saves = 0;
  globalThis.fetch = async (url, options) => {
    if (options?.method === 'PATCH') { saves += 1; return response.promise; }
    return Response.json(student);
  };
  const view = renderApp(<Profile/>);
  await waitFor(() => assert.ok(view.getByLabelText('Full name')));
  const name = view.getByLabelText('Full name') as HTMLInputElement;
  fireEvent.change(name, {target: {value: 'Updated Student'}});
  fireEvent.submit(name.closest('form')!);
  fireEvent.submit(name.closest('form')!);
  assert.equal(saves, 1);
  await act(async () => response.resolve(new Response('{}', {status: 503})));
  await waitFor(() => assert.ok(view.getByRole('alert')));
  assert.equal(name.value, 'Updated Student');
});

test('admin filters have an empty state and cancelled role changes keep the original role', async () => {
  const administrator = {...student, id: 'admin-1', role: 'ADMIN'};
  let changes = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/auth/me')) return Response.json(administrator);
    if (String(url).includes('/admin/audit?')) return Response.json(listing([], 0, 1, 25));
    if (options?.method === 'PATCH') { changes += 1; return Response.json({...student, role: 'FACULTY'}); }
    const query = new URL(String(url), 'http://localhost:3000').searchParams.get('q');
    return Response.json(listing(query ? [] : [administrator, student], query ? 0 : 2, 1, 25));
  };
  const view = renderApp(<Admin/>, '/admin');
  await waitFor(() => assert.ok(view.getByRole('list', {name: 'People'})));
  fireEvent.change(view.getByRole('searchbox', {name: 'Search users'}), {target: {value: 'nobody'}});
  await waitFor(() => assert.ok(view.getByText('No people match these filters.')));
  fireEvent.click(view.getByRole('button', {name: 'Clear people filters'}));
  await waitFor(() => assert.ok(view.getByRole('list', {name: 'People'})));
  const selects = view.getAllByLabelText(`Role for ${student.name}`) as HTMLSelectElement[];
  const own = selects.find(select => select.disabled)!;
  const target = selects.find(select => !select.disabled)!;
  assert.equal(own.value, 'ADMIN');
  window.confirm = () => false;
  fireEvent.change(target, {target: {value: 'FACULTY'}});
  assert.equal(changes, 0);
  assert.equal(target.value, 'STUDENT');
});


test('admin search queries the server and reaches accounts outside the first page', async () => {
  const administrator = {...student, id: 'admin-1', role: 'ADMIN'};
  const requests: string[] = [];
  globalThis.fetch = async url => {
    if (String(url).endsWith('/auth/me')) return Response.json(administrator);
    if (String(url).includes('/admin/audit?')) return Response.json(listing([], 0, 1, 25));
    requests.push(String(url));
    const query = new URL(String(url), 'http://localhost:3000').searchParams.get('q');
    return Response.json(query ? listing([{...student, id: 'oldest', name: 'Oldest account', email: 'oldest@example.test'}], 1, 1, 25) : listing([administrator], 550, 1, 25));
  };
  const view = renderApp(<Admin/>, '/admin');
  await waitFor(() => assert.ok(view.getByText('550 people')));
  fireEvent.change(view.getByRole('searchbox', {name: 'Search users'}), {target: {value: 'old'}});
  fireEvent.change(view.getByRole('searchbox', {name: 'Search users'}), {target: {value: 'oldest@example.test'}});
  await waitFor(() => assert.ok(view.getByText('Oldest account')));
  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[1], 'http://localhost:3000').searchParams.get('q'), 'oldest@example.test');
  assert.ok(view.getByText('1 matching person'));
  assert.equal(view.queryByText(/500 most recent/), null);
});

test('role changes refill the filtered page and recover when its final page disappears', async () => {
  window.history.replaceState({}, '', '/admin?page=2&role=STUDENT');
  const administrator = {...student, id: 'admin-1', role: 'ADMIN'};
  const pages: number[] = [];
  let changed = false;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/auth/me')) return Response.json(administrator);
    if (String(url).includes('/admin/audit?')) return Response.json(listing([], 0, 1, 25));
    if (options?.method === 'PATCH') { changed = true; return Response.json({...student, role: 'FACULTY'}); }
    const page = Number(new URL(String(url), 'http://localhost:3000').searchParams.get('page'));
    pages.push(page);
    return Response.json(listing(changed && page === 2 ? [] : [{...student, name: changed ? 'Earlier student' : student.name}], changed ? 25 : 26, page, 25));
  };
  const view = renderApp(<Admin/>, '/admin');
  await waitFor(() => assert.ok(view.getByText('Page 2 of 2')));
  window.confirm = () => true;
  fireEvent.change(view.getByLabelText(`Role for ${student.name}`), {target: {value: 'FACULTY'}});
  await waitFor(() => assert.ok(view.getByText('Earlier student')));
  assert.deepEqual(pages, [2, 2, 1]);
  assert.equal(new URLSearchParams(window.location.search).get('role'), 'STUDENT');
});
