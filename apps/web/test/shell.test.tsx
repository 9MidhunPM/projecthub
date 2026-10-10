import './dom-setup';
import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {act, cleanup, fireEvent, waitFor} from '@testing-library/react';
import {Guard, useApp} from '../components/shell';
import {deferred, renderApp, student} from './component-helpers';

const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; window.history.replaceState({}, '', '/'); });

test('mobile navigation is labelled, closable with Escape, and retains share/sign-out actions', async () => {
  globalThis.fetch = async () => Response.json(student);
  const view = renderApp(<p>Main content</p>, '/workspace');
  await waitFor(() => assert.ok(view.getByRole('link', {name: `Your profile, ${student.name}`})));
  assert.equal(view.getByRole('link', {name: 'My workspace'}).getAttribute('aria-current'), 'page');
  assert.equal(view.getByText('Skip to main content').getAttribute('href'), '#main-content');
  const toggle = view.getByRole('button', {name: 'Open navigation'});
  fireEvent.click(toggle);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(toggle.getAttribute('aria-controls'), 'main-navigation');
  assert.ok(view.getAllByRole('link', {name: 'Share a project'}).length >= 1);
  fireEvent.keyDown(document, {key: 'Escape'});
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, toggle);
});

test('session transport failures show retry rather than asking a signed-in user to sign in again', async () => {
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    if (requests === 1) throw new TypeError('offline');
    return Response.json(student);
  };
  const view = renderApp(<Guard><p>Private workspace</p></Guard>);
  await waitFor(() => assert.ok(view.getByRole('heading', {name: 'We couldn’t check your session.'})));
  assert.equal(view.queryByText('Sign in to continue'), null);
  fireEvent.click(view.getByRole('button', {name: 'Try again'}));
  await waitFor(() => assert.ok(view.getByText('Private workspace')));
  assert.equal(requests, 2);
});

test('repeated sign-out clicks send one request while pending', async () => {
  const pending = deferred<Response>();
  let signouts = 0;
  globalThis.fetch = async url => {
    if (String(url).endsWith('/auth/logout')) { signouts += 1; return pending.promise; }
    return Response.json(student);
  };
  const view = renderApp(<p>Account</p>);
  await waitFor(() => assert.ok(view.getByRole('link', {name: `Your profile, ${student.name}`})));
  const button = view.getAllByRole('button', {name: 'Sign out'})[0];
  fireEvent.click(button);
  fireEvent.click(button);
  assert.equal(signouts, 1);
  pending.resolve(new Response(null, {status: 204}));
  await waitFor(() => assert.ok(view.getByRole('link', {name: 'Sign in'})));
  assert.deepEqual(view.navigation, [{method: 'push', href: '/'}]);
});


function SessionControls() {
  const {user, loading, refresh} = useApp();
  return <><button onClick={() => void refresh()}>Refresh session</button><p data-testid="session-state">{loading ? 'pending' : user ? user.email : 'signed out'}</p></>;
}

test('an older anonymous lookup cannot replace a newer authenticated session', async () => {
  const originalLookup = deferred<Response>();
  let lookups = 0;
  globalThis.fetch = async () => {
    lookups += 1;
    return lookups === 1 ? originalLookup.promise : Response.json(student);
  };
  const view = renderApp(<SessionControls/>);
  await waitFor(() => assert.equal(lookups, 1));
  fireEvent.click(view.getByRole('button', {name: 'Refresh session'}));
  await waitFor(() => assert.equal(view.getByTestId('session-state').textContent, student.email));
  await act(async () => originalLookup.resolve(new Response('{}', {status: 401})));
  assert.equal(view.getByTestId('session-state').textContent, student.email);
});

test('a pending refresh cannot sign the user back in after logout', async () => {
  const pendingLookup = deferred<Response>();
  let lookups = 0;
  globalThis.fetch = async url => {
    if (String(url).endsWith('/auth/logout')) return new Response(null, {status: 204});
    lookups += 1;
    return lookups === 1 ? Response.json(student) : pendingLookup.promise;
  };
  const view = renderApp(<SessionControls/>);
  await waitFor(() => assert.equal(view.getByTestId('session-state').textContent, student.email));
  fireEvent.click(view.getByRole('button', {name: 'Refresh session'}));
  await waitFor(() => assert.equal(lookups, 2));
  fireEvent.click(view.getAllByRole('button', {name: 'Sign out'})[0]);
  await waitFor(() => assert.deepEqual(view.navigation, [{method: 'push', href: '/'}]));
  await act(async () => pendingLookup.resolve(Response.json(student)));
  assert.equal(view.getByTestId('session-state').textContent, 'signed out');
  assert.ok(view.getByRole('link', {name: 'Sign in'}));
});

test('an older refresh must not clear the pending state of a newer lookup', async () => {
  const older = deferred<Response>();
  const newer = deferred<Response>();
  let lookups = 0;
  globalThis.fetch = async () => { lookups += 1; return lookups === 1 ? older.promise : newer.promise; };
  const view = renderApp(<SessionControls/>);
  fireEvent.click(view.getByRole('button', {name: 'Refresh session'}));
  await waitFor(() => assert.equal(lookups, 2));
  await act(async () => older.resolve(Response.json(student)));
  assert.equal(view.getByTestId('session-state').textContent, 'pending');
  await act(async () => newer.resolve(new Response('{}', {status: 401})));
  assert.equal(view.getByTestId('session-state').textContent, 'signed out');
});
