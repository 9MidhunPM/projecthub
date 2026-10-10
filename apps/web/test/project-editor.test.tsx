import './dom-setup';
import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {act, cleanup, fireEvent, waitFor} from '@testing-library/react';
import {ProjectEditor} from '../components/project-editor';
import {deferred, project, renderApp, student} from './component-helpers';

const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });

async function readyEditor() {
  const view = renderApp(<ProjectEditor/>, '/projects/new');
  await waitFor(() => assert.ok(view.getByLabelText('Project title')));
  fireEvent.change(view.getByLabelText('Project title'), {target: {value: project.title}});
  fireEvent.change(view.getByLabelText('Description'), {target: {value: project.description}});
  fireEvent.change(view.getByLabelText('Technologies'), {target: {value: 'React'}});
  return view;
}

function submit(view: ReturnType<typeof renderApp>, name = 'Save draft') {
  const button = view.getByRole('button', {name}) as HTMLButtonElement;
  fireEvent(button.closest('form')!, new window.SubmitEvent('submit', {bubbles: true, cancelable: true, submitter: button}));
}

test('load failures never expose an empty editor that could overwrite an existing project', async () => {
  globalThis.fetch = async url => String(url).endsWith('/auth/me') ? Response.json(student) : new Response('{}', {status: 500});
  const view = renderApp(<ProjectEditor id="project-1"/>);
  await waitFor(() => assert.ok(view.getByRole('heading', {name: 'We couldn’t load this project.'})));
  assert.equal(view.queryByLabelText('Project title'), null);
  assert.ok(view.getByRole('button', {name: 'Try again'}));
});

test('a failed submit preserves the confirmed draft ID and retry updates it', async () => {
  let creates = 0;
  let updates = 0;
  let submissions = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/auth/me')) return Response.json(student);
    if (String(url).endsWith('/submit')) {
      submissions += 1;
      return submissions === 1 ? Response.json({message: 'Try again shortly'}, {status: 503}) : Response.json({...project, status: 'PENDING'});
    }
    if (options?.method === 'POST') creates += 1;
    if (options?.method === 'PATCH') updates += 1;
    return Response.json({...project, status: 'DRAFT'});
  };
  const view = await readyEditor();
  submit(view, 'Submit for review');
  await waitFor(() => assert.match(view.getByRole('alert').textContent ?? '', /draft was saved/));
  submit(view, 'Submit for review');
  await waitFor(() => assert.deepEqual(view.navigation, [{method: 'push', href: '/workspace'}]));
  assert.equal(creates, 1);
  assert.equal(updates, 1);
  assert.equal(submissions, 2);
});

test('pending save is deduplicated, blocks editor exit, and ignores late completion after unmount', async () => {
  const response = deferred<Response>();
  let saves = 0;
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/auth/me')) return Response.json(student);
    saves += 1;
    signal = options?.signal;
    return response.promise;
  };
  const view = await readyEditor();
  submit(view);
  const form = view.getByLabelText('Project title').closest('form')!;
  fireEvent.submit(form);
  assert.equal(saves, 1);
  assert.ok(view.getByRole('button', {name: 'Cancel'}).hasAttribute('disabled'));
  const back = view.container.querySelector('.back-link')!;
  fireEvent.click(back);
  assert.deepEqual(view.navigation, []);
  view.unmount();
  assert.equal(signal?.aborted, true);
  await act(async () => response.resolve(Response.json({...project, status: 'DRAFT'})));
  assert.deepEqual(view.navigation, []);
});
