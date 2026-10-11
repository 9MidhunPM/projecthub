import './dom-setup';
import assert from 'node:assert/strict';
import {useState} from 'react';
import {afterEach, test} from 'node:test';
import {act, cleanup, fireEvent, waitFor} from '@testing-library/react';
import {ProjectCard} from '../components/project-card';
import type {Project} from '../lib/api';
import {deferred, project, renderApp, student} from './component-helpers';

const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });

function mockPendingEngagement() {
  const response = deferred<Response>();
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/auth/me')) return Response.json(student);
    signal = options?.signal;
    return response.promise;
  };
  return {response, getSignal: () => signal};
}

test('engagement responses preserve refreshed metadata and notify with the latest same-ID project', async () => {
  const {response} = mockPendingEngagement();
  const updates: Project[] = [];
  function Harness() {
    const [value, setValue] = useState(project);
    return <><button onClick={() => setValue({...project, title: 'Updated server title', description: 'Updated server description'})}>Refresh metadata</button><ProjectCard project={value} onUpdate={updated => updates.push(updated)}/></>;
  }
  const view = renderApp(<Harness/>);
  await waitFor(() => assert.ok(!view.getByRole('button', {name: `Like ${project.title}, 0 likes`}).hasAttribute('disabled')));
  fireEvent.click(view.getByRole('button', {name: `Like ${project.title}, 0 likes`}));
  fireEvent.click(view.getByRole('button', {name: 'Refresh metadata'}));
  await act(async () => response.resolve(Response.json({liked: true, likes: 1, bookmarked: false})));
  assert.ok(view.getByRole('article', {name: 'Updated server title'}));
  assert.ok(view.getByRole('button', {name: 'Unlike Updated server title, 1 likes'}));
  assert.equal(updates[0]?.title, 'Updated server title');
  assert.equal(updates[0]?.description, 'Updated server description');
});

test('unmount aborts card transport and suppresses late callbacks', async () => {
  const {response, getSignal} = mockPendingEngagement();
  const updates: Project[] = [];
  const view = renderApp(<ProjectCard project={project} onUpdate={updated => updates.push(updated)}/>);
  await waitFor(() => assert.ok(!view.getByRole('button', {name: `Save ${project.title}`}).hasAttribute('disabled')));
  fireEvent.click(view.getByRole('button', {name: `Save ${project.title}`}));
  view.unmount();
  assert.equal(getSignal()?.aborted, true);
  await act(async () => response.resolve(Response.json({liked: false, likes: 0, bookmarked: true})));
  assert.deepEqual(updates, []);
});

test('a response for a replaced project cannot alter its replacement', async () => {
  const {response, getSignal} = mockPendingEngagement();
  const updates: Project[] = [];
  function Harness() {
    const [value, setValue] = useState(project);
    return <><button onClick={() => setValue({...project, id: 'project-2', title: 'Another project'})}>Replace project</button><ProjectCard project={value} onUpdate={updated => updates.push(updated)}/></>;
  }
  const view = renderApp(<Harness/>);
  await waitFor(() => assert.ok(!view.getByRole('button', {name: `Like ${project.title}, 0 likes`}).hasAttribute('disabled')));
  fireEvent.click(view.getByRole('button', {name: `Like ${project.title}, 0 likes`}));
  fireEvent.click(view.getByRole('button', {name: 'Replace project'}));
  assert.equal(getSignal()?.aborted, true);
  await act(async () => response.resolve(Response.json({liked: true, likes: 1, bookmarked: false})));
  assert.ok(view.getByRole('article', {name: 'Another project'}));
  assert.ok(view.getByRole('button', {name: 'Like Another project, 0 likes'}));
  assert.deepEqual(updates, []);
});
