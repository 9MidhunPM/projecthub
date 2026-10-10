import './dom-setup';
import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
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
