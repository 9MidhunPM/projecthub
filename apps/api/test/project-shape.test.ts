import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeProjects, projectInclude, ProjectWithCounts } from '../dist/project-shape';

function project(id: string): ProjectWithCounts {
  return { id, title: id, _count: { likes: 4, bookmarks: 3 }, owner: { id: 'owner', name: 'Owner', department: 'CS', semester: 2, bio: '' } } as ProjectWithCounts;
}

test('collection viewer flags use exactly two scoped queries regardless of page size', async () => {
  const calls: unknown[] = [];
  const db = {
    like: { findMany: async (query: unknown) => { calls.push(query); return [{ projectId: 'a' }]; } },
    bookmark: { findMany: async (query: unknown) => { calls.push(query); return [{ projectId: 'b' }]; } },
  } as any;
  const result = await shapeProjects(db, [project('a'), project('b'), project('c')], 'viewer');
  assert.equal(calls.length, 2);
  for (const query of calls) assert.deepEqual(query, {
    where: { userId: 'viewer', projectId: { in: ['a', 'b', 'c'] } }, select: { projectId: true },
  });
  assert.deepEqual(result.map(value => [value.id, value.liked, value.bookmarked]), [
    ['a', true, false], ['b', false, true], ['c', false, false],
  ]);
  assert.equal(result[0].likes, 4);
  assert.equal(result[0].bookmarks, 3);
  assert.equal('_count' in result[0], false);
});

test('anonymous and empty collections never query private viewer relations', async () => {
  const db = {
    like: { findMany: () => assert.fail('unexpected like query') },
    bookmark: { findMany: () => assert.fail('unexpected bookmark query') },
  } as any;
  assert.deepEqual(await shapeProjects(db, [], 'viewer'), []);
  const [result] = await shapeProjects(db, [project('a')]);
  assert.equal(result.liked, false);
  assert.equal(result.bookmarked, false);
});

test('shared project include only selects public owner profile fields', () => {
  assert.deepEqual(Object.keys(projectInclude.owner.select).sort(), ['bio', 'department', 'id', 'name', 'semester']);
});
