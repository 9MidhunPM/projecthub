import assert from 'node:assert/strict';
import {test} from 'node:test';
import {authHref, safeReturnPath} from '../lib/auth-navigation';

test('local destinations and their query strings survive login/signup switches', () => {
  const destination = '/projects/project-123/edit?view=details#screenshots';
  assert.equal(safeReturnPath(destination), destination);
  assert.equal(new URLSearchParams(authHref(true, destination).split('?')[1]).get('next'), destination);
  assert.ok(authHref(false, destination).startsWith('/login?next='));
});

test('external URLs and slash normalization cannot become auth destinations', () => {
  for (const value of ['https://example.com', '//example.com', '/\\example.com', '/%5cexample.com', '/%2fexample.com', '/\n/example.com', 'javascript:alert(1)', ' /workspace']) {
    assert.equal(safeReturnPath(value), '/workspace', value);
  }
});

test('missing or self-referential auth destinations fall back to workspace', () => {
  for (const value of [null, undefined, '', '/login', '/signup?next=/login']) {
    assert.equal(safeReturnPath(value), '/workspace');
  }
});
