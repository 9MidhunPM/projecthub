import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseCollectionQuery, serializeCollectionQuery} from '../lib/collection-query';

test('collection URLs bound page/filter values before API requests', () => {
  const options = {statuses: ['DRAFT', 'PENDING']};
  assert.deepEqual(parseCollectionQuery('?page=2&status=DRAFT', options), {page: 2, status: 'DRAFT', q: '', role: ''});
  for (const page of ['0', '-1', '1.5', '10001', '1e2', '01']) assert.equal(parseCollectionQuery(`?page=${page}`).page, 1);
  assert.equal(parseCollectionQuery('?status=INVALID', options).status, '');
});

test('default moderation status and people search round-trip without leaking unsupported filters', () => {
  const review = {statuses: ['PENDING', 'APPROVED'], defaultStatus: 'PENDING'};
  assert.equal(parseCollectionQuery('', review).status, 'PENDING');
  assert.equal(serializeCollectionQuery(parseCollectionQuery('', review), review), '');
  const people = {people: true};
  const parsed = parseCollectionQuery('?q=%20oldest%40example.test%20&role=FACULTY&page=8&status=DRAFT', people);
  assert.equal(serializeCollectionQuery(parsed, people), 'page=8&q=oldest%40example.test&role=FACULTY');
  assert.equal(parseCollectionQuery(`?q=${'x'.repeat(300)}`, people).q.length, 254);
});
