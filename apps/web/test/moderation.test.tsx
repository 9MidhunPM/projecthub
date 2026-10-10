import './dom-setup';
import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {act, cleanup, fireEvent, waitFor} from '@testing-library/react';
import {Moderation} from '../components/moderation';
import {deferred, project, renderApp, student} from './component-helpers';

const originalFetch = globalThis.fetch;
const originalConfirm = window.confirm;
const faculty = {...student, id: 'faculty-1', role: 'FACULTY'};
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; window.confirm = originalConfirm; });

function queueFetch(mutate: (options: RequestInit | undefined) => Promise<Response>) {
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/auth/me')) return Response.json(faculty);
    if (options?.method === 'PATCH') return mutate(options);
    return Response.json([{...project, status: 'PENDING'}]);
  };
}

test('requesting changes requires feedback, focuses the field, and preserves it after conflict', async () => {
  let reviews = 0;
  const versions: number[] = [];
  queueFetch(async options => { reviews += 1; versions.push(JSON.parse(String(options?.body)).expectedVersion); return Response.json({message: 'The project changed. Refresh and try again.'}, {status: 409}); });
  const view = renderApp(<Moderation/>);
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
  const view = renderApp(<Moderation/>);
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
