import './dom-setup';
import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {act, cleanup, fireEvent, waitFor} from '@testing-library/react';
import {Admin, Profile} from '../components/account';
import {deferred, renderApp, student} from './component-helpers';

const originalFetch = globalThis.fetch;
const originalConfirm = window.confirm;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; window.confirm = originalConfirm; });

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
    if (options?.method === 'PATCH') { changes += 1; return Response.json({...student, role: 'FACULTY'}); }
    return Response.json([administrator, student]);
  };
  const view = renderApp(<Admin/>);
  await waitFor(() => assert.ok(view.getByRole('list', {name: 'People'})));
  fireEvent.change(view.getByRole('searchbox', {name: 'Search users'}), {target: {value: 'nobody'}});
  assert.ok(view.getByText('No people match these filters.'));
  fireEvent.click(view.getByRole('button', {name: 'Clear people filters'}));
  const selects = view.getAllByLabelText(`Role for ${student.name}`) as HTMLSelectElement[];
  const own = selects.find(select => select.disabled)!;
  const target = selects.find(select => !select.disabled)!;
  assert.equal(own.value, 'ADMIN');
  window.confirm = () => false;
  fireEvent.change(target, {target: {value: 'FACULTY'}});
  assert.equal(changes, 0);
  assert.equal(target.value, 'STUDENT');
});
