import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { parseProjectQuery } from '../src/project-query';

test('project queries default to a bounded stable approved-only page', () => {
  assert.deepEqual(parseProjectQuery({}), {
    page: 1, limit: 12, where: { status: 'APPROVED' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
});

test('query parameters reject duplicate, structured and oversized inputs', () => {
  for (const key of ['q[term]', 'q[]', 'page[gt]', 'unknown']) {
    assert.throws(() => parseProjectQuery({ [key]: 'value' }), BadRequestException);
  }
  for (const field of ['q', 'department', 'type', 'tech', 'sort', 'page', 'limit', 'semester']) {
    for (const value of [['one', 'two'], { nested: 'value' }, null, 1]) {
      assert.throws(() => parseProjectQuery({ [field]: value }), BadRequestException);
    }
  }
  for (const [field, maximum] of [['q', 200], ['department', 80], ['type', 60], ['tech', 40]] as const) {
    assert.throws(() => parseProjectQuery({ [field]: 'x'.repeat(maximum + 1) }), BadRequestException);
    parseProjectQuery({ [field]: 'x'.repeat(maximum) });
  }
});

test('pagination rejects malformed and out-of-range numbers rather than silently clamping', () => {
  for (const field of ['page', 'limit', 'semester']) {
    for (const value of ['', '0', '-1', '1.5', '1e1', '0x10', 'NaN', 'Infinity', ' 1 ', '01', '99999999999999999999']) {
      assert.throws(() => parseProjectQuery({ [field]: value }), BadRequestException);
    }
  }
  assert.throws(() => parseProjectQuery({ page: '10001' }), BadRequestException);
  assert.throws(() => parseProjectQuery({ limit: '49' }), BadRequestException);
  assert.throws(() => parseProjectQuery({ semester: '13' }), BadRequestException);
  const query = parseProjectQuery({ page: '10000', limit: '48', semester: '12' });
  assert.equal(query.page, 10000);
  assert.equal(query.limit, 48);
  assert.equal(query.where.semester, 12);
});

test('all filters compose and popular ordering breaks ties consistently', () => {
  const query = parseProjectQuery({ q: ' robotics ', department: ' Engineering ', semester: '2', type: ' Research ', tech: ' Python ', sort: 'popular' });
  assert.deepEqual(query.where, {
    status: 'APPROVED', OR: [
      { title: { contains: 'robotics', mode: 'insensitive' } },
      { description: { contains: 'robotics', mode: 'insensitive' } },
    ], department: 'Engineering', semester: 2, type: 'Research', techStack: { has: 'Python' },
  });
  assert.deepEqual(query.orderBy, [{ likes: { _count: 'desc' } }, { createdAt: 'desc' }, { id: 'desc' }]);
  assert.throws(() => parseProjectQuery({ sort: 'oldest' }), BadRequestException);
  assert.deepEqual(parseProjectQuery({ q: ' ', department: '', type: '', tech: '' }).where, { status: 'APPROVED' });
});
