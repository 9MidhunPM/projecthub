import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { parseAuditCollectionQuery, parseProjectCollectionQuery, parseUserCollectionQuery } from '../src/collection-query';
import { pageResult } from '../src/query-params';

test('private project collections are bounded and keep explicit status defaults', () => {
  assert.deepEqual(parseProjectCollectionQuery({}, 'workspace'), { page: 1, limit: 24, skip: 0, status: undefined });
  assert.equal(parseProjectCollectionQuery({}, 'moderation').status, 'PENDING');
  assert.equal(parseProjectCollectionQuery({}, 'bookmarks').status, 'APPROVED');
  assert.deepEqual(parseProjectCollectionQuery({ page: '2', limit: '48', status: 'HIDDEN' }, 'workspace'), { page: 2, limit: 48, skip: 48, status: 'HIDDEN' });
  assert.equal(parseProjectCollectionQuery({ status: '' }, 'workspace').status, undefined);
});

test('every private project collection rejects malformed pagination and unsupported filter shapes', () => {
  for (const collection of ['workspace', 'bookmarks', 'moderation'] as const) {
    for (const query of [{ page: '0' }, { page: '1e2' }, { page: '10001' }, { limit: '49' }, { limit: '1.5' }, { page: ['1', '2'] }, { 'page[gt]': '1' }, { ownerId: 'other' }, { q: 'ignored filter' }]) {
      assert.throws(() => parseProjectCollectionQuery(query, collection), BadRequestException);
    }
  }
  for (const query of [{ status: 'UNKNOWN' }, { status: ['DRAFT', 'PENDING'] }, { 'status[]': 'DRAFT' }]) {
    assert.throws(() => parseProjectCollectionQuery(query, 'workspace'), BadRequestException);
  }
  assert.throws(() => parseProjectCollectionQuery({ status: 'HIDDEN' }, 'bookmarks'), BadRequestException);
});

test('page envelopes retain requested empty pages and report real totals', () => {
  assert.deepEqual(pageResult([], 25, { page: 3, limit: 24 }), { items: [], total: 25, page: 3, limit: 24, pages: 2 });
  assert.equal(pageResult([], 0, { page: 1, limit: 24 }).pages, 0);
});

test('administrator collections apply bounded defaults and compose literal name/email search with roles', () => {
  assert.deepEqual(parseUserCollectionQuery({}), { page: 1, limit: 50, skip: 0, where: {} });
  assert.deepEqual(parseAuditCollectionQuery({ page: '2', limit: '100' }), { page: 2, limit: 100, skip: 100 });
  const users = parseUserCollectionQuery({ q: '  Ada_100%  ', role: 'FACULTY', page: '2', limit: '25' });
  assert.deepEqual(users, { page: 2, limit: 25, skip: 25, where: { role: 'FACULTY', OR: [
    { name: { contains: 'Ada\\_100\\%', mode: 'insensitive' } }, { email: { contains: 'Ada\\_100\\%', mode: 'insensitive' } },
  ] } });
  assert.deepEqual(parseUserCollectionQuery({ q: ' ', role: '' }).where, {});
});

test('administrator collection filters reject unexpected keys, duplicate values and unsupported ranges', () => {
  for (const parse of [parseUserCollectionQuery, parseAuditCollectionQuery]) {
    for (const query of [{ limit: '101' }, { page: '0' }, { page: ['1', '2'] }, { 'page[]': '1' }, { unknown: '' }]) {
      assert.throws(() => parse(query), BadRequestException);
    }
  }
  for (const query of [{ q: 'x'.repeat(255) }, { q: ['a', 'b'] }, { role: 'OWNER' }, { role: ['ADMIN'] }, { 'q[name]': 'Ada' }]) {
    assert.throws(() => parseUserCollectionQuery(query), BadRequestException);
  }
  assert.throws(() => parseAuditCollectionQuery({ q: 'ignored' }), BadRequestException);
});
