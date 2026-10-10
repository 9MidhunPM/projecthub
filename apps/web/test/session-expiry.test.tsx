import './dom-setup';
import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {cleanup, fireEvent, waitFor} from '@testing-library/react';
import {ProjectEditor} from '../components/project-editor';
import {Profile} from '../components/account';
import {Moderation} from '../components/moderation';
import {listing, project, renderApp, student} from './component-helpers';

const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; window.history.replaceState({}, '', '/'); });

test('expired-session project save retains title, description, screenshots and focused error', async () => {
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/auth/me')) return Response.json(student);
    if (options?.method === 'PATCH') return Response.json({message: 'Unauthorized'}, {status: 401});
    return Response.json({...project, screenshots: ['/one.webp']});
  };
  const view = renderApp(<ProjectEditor id={project.id}/>, `/projects/${project.id}/edit`);
  await waitFor(() => assert.ok(view.getByLabelText('Project title')));
  fireEvent.change(view.getByLabelText('Project title'), {target: {value: 'My unsaved title'}});
  fireEvent.change(view.getByLabelText('Description'), {target: {value: 'My lengthy unsaved project description.'}});
  fireEvent.submit(view.getByLabelText('Project title').closest('form')!);
  await waitFor(() => assert.ok(view.getByRole('alert')));
  assert.equal((view.getByLabelText('Project title') as HTMLInputElement).value, 'My unsaved title');
  assert.equal((view.getByLabelText('Description') as HTMLTextAreaElement).value, 'My lengthy unsaved project description.');
  assert.equal(view.getByRole('img', {name: 'Project screenshot 1'}).getAttribute('src'), '/one.webp');
  assert.ok(document.activeElement === view.getByRole('alert').parentElement);
  assert.equal(view.navigation.length, 0);
});

test('expired-session profile save retains name and bio with a focused error', async () => {
  globalThis.fetch = async (_url, options) => options?.method === 'PATCH' ? Response.json({message: 'Unauthorized'}, {status: 401}) : Response.json(student);
  const view = renderApp(<Profile/>, '/profile');
  await waitFor(() => assert.ok(view.getByLabelText('Full name')));
  fireEvent.change(view.getByLabelText('Full name'), {target: {value: 'Unsaved Student'}});
  fireEvent.change(view.getByLabelText(/Bio/), {target: {value: 'My unsaved biography'}});
  fireEvent.submit(view.getByLabelText('Full name').closest('form')!);
  await waitFor(() => assert.ok(view.getByRole('alert')));
  assert.equal((view.getByLabelText('Full name') as HTMLInputElement).value, 'Unsaved Student');
  assert.equal((view.getByLabelText(/Bio/) as HTMLTextAreaElement).value, 'My unsaved biography');
  assert.ok(document.activeElement === view.getByRole('alert').parentElement);
});

test('expired-session moderation retains unsent feedback and announces the error', async () => {
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/auth/me')) return Response.json({...student, id: 'faculty-1', role: 'FACULTY'});
    if (options?.method === 'PATCH') return Response.json({message: 'Unauthorized'}, {status: 401});
    return Response.json(listing([{...project, status: 'PENDING'}]));
  };
  const view = renderApp(<Moderation/>, '/moderation');
  await waitFor(() => assert.ok(view.getByLabelText('Feedback for the student')));
  fireEvent.change(view.getByLabelText('Feedback for the student'), {target: {value: 'Keep this review feedback.'}});
  fireEvent.click(view.getByRole('button', {name: 'Request changes'}));
  await waitFor(() => assert.ok(view.getByRole('alert')));
  assert.equal((view.getByLabelText('Feedback for the student') as HTMLTextAreaElement).value, 'Keep this review feedback.');
});
