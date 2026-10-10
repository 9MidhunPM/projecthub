import './dom-setup';
import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {useState} from 'react';
import {useApp} from '../components/shell';
import {act, cleanup, fireEvent, waitFor} from '@testing-library/react';
import {AuthForm} from '../components/auth-form';
import {deferred, renderApp, student} from './component-helpers';

const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; window.history.replaceState({}, '', '/'); });

test('signup preserves the destination and asks for deliberate academic choices', async () => {
  window.history.replaceState({}, '', '/signup?next=%2Fprojects%2Fnew');
  globalThis.fetch = async () => new Response('{}', {status: 401});
  const view = renderApp(<AuthForm signup/>, '/signup');
  await waitFor(() => assert.ok(view.getByRole('heading', {level: 1, name: 'Make room for your ideas.'})));
  const switches = view.getAllByRole('link', {name: 'Sign in'});
  assert.ok(switches.some(link => link.getAttribute('href') === '/login?next=%2Fprojects%2Fnew'));
  assert.equal((view.getByLabelText('Department') as HTMLSelectElement).value, '');
  assert.equal((view.getByLabelText('Semester') as HTMLSelectElement).value, '');
  const password = view.getByLabelText('Password') as HTMLInputElement;
  assert.equal(password.getAttribute('aria-describedby'), 'password-requirements');
  fireEvent.click(view.getByRole('button', {name: 'Show password'}));
  assert.equal(password.type, 'text');
  fireEvent.click(view.getByRole('button', {name: 'Hide password'}));
  assert.equal(password.type, 'password');
});

test('auth submits once while pending and keeps entered values on failure', async () => {
  const request = deferred<Response>();
  let logins = 0;
  globalThis.fetch = async url => {
    if (String(url).endsWith('/auth/login')) { logins += 1; return request.promise; }
    return new Response('{}', {status: 401});
  };
  const view = renderApp(<AuthForm/>, '/login');
  const email = view.getByLabelText('Email address') as HTMLInputElement;
  const password = view.getByLabelText('Password') as HTMLInputElement;
  fireEvent.change(email, {target: {value: 'student@example.test'}});
  fireEvent.change(password, {target: {value: 'a-long-test-password'}});
  const form = email.closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  assert.equal(logins, 1);
  assert.ok(view.getByRole('button', {name: 'Signing in…'}).hasAttribute('disabled'));
  await act(async () => request.resolve(Response.json({message: 'Email or password is incorrect.'}, {status: 401})));
  await waitFor(() => assert.ok(view.getByRole('alert')));
  assert.equal(email.value, 'student@example.test');
  assert.equal(password.value, 'a-long-test-password');
  assert.equal(document.activeElement, view.getByRole('alert').parentElement);
  assert.deepEqual(view.navigation, []);
});

test('successful login replaces history with its safe return destination', async () => {
  window.history.replaceState({}, '', '/login?next=%2Fprojects%2Fnew');
  globalThis.fetch = async () => Response.json(student);
  const view = renderApp(<AuthForm/>, '/login');
  fireEvent.change(view.getByLabelText('Email address'), {target: {value: 'student@example.test'}});
  fireEvent.change(view.getByLabelText('Password'), {target: {value: 'a-long-test-password'}});
  fireEvent.submit(view.getByLabelText('Email address').closest('form')!);
  await waitFor(() => assert.deepEqual(view.navigation, [{method: 'replace', href: '/projects/new'}]));
});


function InterruptibleAuth({signup = false}: {signup?: boolean}) {
  const [visible, setVisible] = useState(true);
  const {user, loading} = useApp();
  return <><button onClick={() => setVisible(false)}>Leave authentication</button><p data-testid="auth-session">{loading ? 'pending' : user ? user.email : 'signed out'}</p>{visible && <AuthForm signup={signup}/>}</>;
}

function enterCredentials(view: ReturnType<typeof renderApp>) {
  fireEvent.change(view.getByLabelText('Email address'), {target: {value: student.email}});
  fireEvent.change(view.getByLabelText('Password'), {target: {value: 'a-long-test-password'}});
  if (view.queryByLabelText('Full name')) {
    fireEvent.change(view.getByLabelText('Full name'), {target: {value: student.name}});
    fireEvent.change(view.getByLabelText('Department'), {target: {value: student.department}});
    fireEvent.change(view.getByLabelText('Semester'), {target: {value: student.semester}});
  }
  fireEvent.submit(view.getByLabelText('Email address').closest('form')!);
}

for (const signup of [false, true]) for (const outcome of ['success', 'failure'] as const) test(`${signup ? 'signup' : 'login'} suppresses late ${outcome} after leaving its form`, async () => {
  const response = deferred<Response>();
  let signal: AbortSignal | null | undefined;
  let reads = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/auth/me')) { reads += 1; return Response.json({message: 'Unauthorized'}, {status: 401}); }
    signal = options?.signal;
    return response.promise;
  };
  const view = renderApp(<InterruptibleAuth signup={signup}/>, signup ? '/signup' : '/login');
  await waitFor(() => assert.equal(view.getByTestId('auth-session').textContent, 'signed out'));
  enterCredentials(view);
  fireEvent.click(view.getByRole('button', {name: 'Leave authentication'}));
  window.history.pushState({}, '', '/projects/project-1');
  await act(async () => response.resolve(outcome === 'success' ? Response.json(student) : Response.json({message: 'Old login failed'}, {status: 503})));
  assert.equal(signal?.aborted, true);
  assert.deepEqual(view.navigation, []);
  assert.equal(reads, 1, 'interrupted success must not start a session lookup');
  assert.ok(view.queryByText('Old login failed') === null);
});

test('leaving during post-login session refresh cancels that lookup without leaving global loading stuck', async () => {
  const session = deferred<Response>();
  let reads = 0;
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/auth/me')) {
      reads += 1;
      if (reads === 1) return Response.json({message: 'Unauthorized'}, {status: 401});
      signal = options?.signal;
      return session.promise;
    }
    return Response.json(student);
  };
  const view = renderApp(<InterruptibleAuth/>, '/login');
  await waitFor(() => assert.equal(view.getByTestId('auth-session').textContent, 'signed out'));
  enterCredentials(view);
  await waitFor(() => assert.equal(reads, 2));
  fireEvent.click(view.getByRole('button', {name: 'Leave authentication'}));
  assert.equal(signal?.aborted, true);
  await waitFor(() => assert.equal(view.getByTestId('auth-session').textContent, 'signed out'));
  await act(async () => session.resolve(Response.json(student)));
  assert.equal(view.getByTestId('auth-session').textContent, 'signed out');
  assert.deepEqual(view.navigation, []);
});

test('a route change before the old auth form unmounts also suppresses navigation', async () => {
  const response = deferred<Response>();
  globalThis.fetch = async url => String(url).endsWith('/auth/me') ? Response.json({message: 'Unauthorized'}, {status: 401}) : response.promise;
  const view = renderApp(<AuthForm/>, '/login');
  enterCredentials(view);
  window.history.pushState({}, '', '/projects/project-1');
  await act(async () => response.resolve(Response.json(student)));
  assert.deepEqual(view.navigation, []);
  assert.equal(window.location.pathname, '/projects/project-1');
});

test('a current login failure preserves credentials for an explicit successful retry', async () => {
  let logins = 0;
  let authenticated = false;
  globalThis.fetch = async url => {
    if (String(url).endsWith('/auth/me')) return authenticated ? Response.json(student) : Response.json({message: 'Unauthorized'}, {status: 401});
    logins += 1;
    if (logins === 1) return Response.json({message: 'Temporary sign-in failure'}, {status: 503});
    authenticated = true;
    return Response.json(student);
  };
  const view = renderApp(<AuthForm/>, '/login');
  enterCredentials(view);
  await waitFor(() => assert.ok(view.getByRole('alert')));
  assert.equal((view.getByLabelText('Email address') as HTMLInputElement).value, student.email);
  assert.equal((view.getByLabelText('Password') as HTMLInputElement).value, 'a-long-test-password');
  fireEvent.submit(view.getByLabelText('Email address').closest('form')!);
  await waitFor(() => assert.deepEqual(view.navigation, [{method: 'replace', href: '/workspace'}]));
  assert.equal(logins, 2);
});
