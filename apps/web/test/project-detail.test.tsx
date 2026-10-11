import './dom-setup';
import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {cleanup, fireEvent, waitFor} from '@testing-library/react';
import {ProjectDetail} from '../components/project-detail';
import {project, renderApp, student} from './component-helpers';

const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });

test('project screenshot navigation supports keyboard and broken-image recovery', async () => {
  globalThis.fetch = async url => {
    if (String(url).endsWith('/auth/me')) return Response.json(student);
    if (String(url).endsWith('/view')) return Response.json({views: 2});
    return Response.json({...project, screenshots: ['/one.webp', '/two.webp']});
  };
  const view = renderApp(<ProjectDetail id={project.id}/>);
  await waitFor(() => assert.ok(view.getByRole('heading', {name: project.title})));
  const region = view.getByRole('region', {name: 'Project screenshots'});
  fireEvent.keyDown(region, {key: 'ArrowRight'});
  assert.ok(view.getByText('Screenshot 2 of 2. Use the arrow keys to browse.'));
  const image = view.getByRole('img', {name: `${project.title} screenshot 2`});
  fireEvent.error(image);
  assert.ok(view.getByText('Screenshot unavailable'));
  fireEvent.click(view.getByRole('button', {name: 'Previous screenshot'}));
  assert.ok(view.getByRole('img', {name: `${project.title} screenshot 1`}));
  await waitFor(() => assert.ok(view.getByText('2 project views')));
});

test('project loading failures can be retried without leaving the route', async () => {
  let attempts = 0;
  globalThis.fetch = async url => {
    if (String(url).endsWith('/auth/me')) return Response.json(student);
    if (String(url).endsWith('/view')) return Response.json({views: 2});
    attempts += 1;
    return attempts === 1 ? new Response('{}', {status: 503}) : Response.json(project);
  };
  const view = renderApp(<ProjectDetail id={project.id}/>);
  await waitFor(() => assert.ok(view.getByRole('alert')));
  fireEvent.click(view.getByRole('button', {name: 'Try again'}));
  await waitFor(() => assert.ok(view.getByRole('heading', {name: project.title})));
  assert.equal(attempts, 2);
});
