import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {api, ApiError, isAbortError} from '../lib/api';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function respond(body: BodyInit | null, init: ResponseInit = {}) {
  globalThis.fetch = async () => new Response(body, init);
}

test('API requests preserve Headers instances and include cookies', async () => {
  let captured: RequestInit | undefined;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/projects');
    captured = options;
    return Response.json({id: 'project-1'});
  };
  assert.deepEqual(await api('/projects', {method: 'POST', headers: new Headers({'X-Test': 'yes'}), body: '{}'}), {id: 'project-1'});
  const headers = new Headers(captured?.headers);
  assert.equal(headers.get('X-Test'), 'yes');
  assert.equal(headers.get('Content-Type'), 'application/json');
  assert.equal(headers.get('Accept'), 'application/json');
  assert.equal(captured?.credentials, 'include');
});

test('multipart uploads leave content type to the browser', async () => {
  globalThis.fetch = async (_url, options) => {
    assert.equal(new Headers(options?.headers).has('Content-Type'), false);
    return Response.json({url: '/uploads/example.webp'});
  };
  await api('/uploads', {method: 'POST', body: new FormData()});
});

test('HTTP errors retain status and readable validation messages', async () => {
  respond(JSON.stringify({message: ['Title is required', 'Choose a department']}), {status: 400});
  await assert.rejects(api('/projects'), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 400);
    assert.equal(error.message, 'Title is required. Choose a department');
    return true;
  });
});

test('HTML proxy failures are reported without leaking server markup', async () => {
  respond('<html>upstream unavailable</html>', {status: 502});
  await assert.rejects(api('/projects'), /ProjectHub is temporarily unavailable/);
});

test('invalid error messages use a readable fallback', async () => {
  respond(JSON.stringify({message: {internal: 'details'}}), {status: 403});
  await assert.rejects(api('/projects'), /permission/);
});

test('malformed success bodies fail instead of pretending to be an empty result', async () => {
  respond('<html>login gateway</html>', {status: 200});
  await assert.rejects(api('/projects'), (error: unknown) => error instanceof ApiError && error.code === 'invalid_response');
});

test('204 responses remain valid for bodyless actions', async () => {
  respond(null, {status: 204});
  assert.equal(await api('/auth/logout', {method: 'POST'}), undefined);
});

test('network errors give an actionable connection message', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(api('/projects'), (error: unknown) => error instanceof ApiError && error.code === 'network' && error.message.includes('Check your connection'));
});

test('request cancellation is not converted into a user-facing network error', async () => {
  const abort = new DOMException('Cancelled', 'AbortError');
  globalThis.fetch = async () => { throw abort; };
  await assert.rejects(api('/projects'), (error: unknown) => error === abort && isAbortError(error));
});

test('rate limit responses expose retry delay', async () => {
  respond('{}', {status: 429, headers: {'Retry-After': '30'}});
  await assert.rejects(api('/projects'), (error: unknown) => error instanceof ApiError && error.retryAfter === 30);
});
