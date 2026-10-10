import './dom-setup';
import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {cleanup, fireEvent, waitFor} from '@testing-library/react';
import {Bookmarks, Workspace} from '../components/workspace';
import {project, renderApp, student} from './component-helpers';

const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });

test('workspace recovers a failed load and filters real projects by status', async () => {
  let attempts = 0;
  globalThis.fetch = async url => {
    if (String(url).endsWith('/auth/me')) return Response.json(student);
    attempts += 1;
    return attempts === 1 ? new Response('{}', {status: 503}) : Response.json([project, {...project, id: 'draft-1', title: 'Unpublished idea', status: 'DRAFT'}]);
  };
  const view = renderApp(<Workspace/>);
  await waitFor(() => assert.ok(view.getByRole('alert')));
  fireEvent.click(view.getByRole('button', {name: 'Try again'}));
  await waitFor(() => assert.ok(view.getByRole('table', {name: 'Your projects'})));
  fireEvent.change(view.getByLabelText('Project status'), {target: {value: 'DRAFT'}});
  assert.ok(view.getByRole('link', {name: 'Unpublished idea'}));
  assert.equal(view.queryByRole('link', {name: project.title}), null);
  fireEvent.change(view.getByLabelText('Project status'), {target: {value: 'HIDDEN'}});
  assert.ok(view.getByText('No projects with this status.'));
  fireEvent.click(view.getByRole('button', {name: 'Show all projects'}));
  assert.ok(view.getByRole('link', {name: project.title}));
});

test('removing the last bookmark immediately shows the collection empty state', async () => {
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/auth/me')) return Response.json(student);
    if (options?.method === 'DELETE') return Response.json({likes: 0, liked: false, bookmarked: false});
    return Response.json([{...project, bookmarked: true}]);
  };
  const view = renderApp(<Bookmarks/>);
  await waitFor(() => assert.ok(view.getByRole('button', {name: `Unsave ${project.title}`})));
  fireEvent.click(view.getByRole('button', {name: `Unsave ${project.title}`}));
  await waitFor(() => assert.ok(view.getByText('Your collection is waiting.')));
  assert.equal(view.queryByRole('article', {name: project.title}), null);
});
