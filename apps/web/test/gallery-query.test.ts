import assert from 'node:assert/strict';
import {test} from 'node:test';
import {defaultGalleryQuery, galleryHref, hasGalleryFilters, parseGalleryQuery, serializeGalleryQuery} from '../lib/gallery-query';

test('empty gallery URLs resolve to the default view', () => {
  assert.deepEqual(parseGalleryQuery(''), defaultGalleryQuery);
  assert.equal(galleryHref(defaultGalleryQuery), '/');
  assert.equal(hasGalleryFilters(defaultGalleryQuery), false);
});

test('filters, sorting, and page survive a URL round trip', () => {
  const query = {q: 'campus & ideas', department: 'Computer Science', semester: '6', type: 'Web Application', tech: 'C++', sort: 'popular' as const, page: 4};
  assert.deepEqual(parseGalleryQuery(serializeGalleryQuery(query)), query);
  assert.equal(hasGalleryFilters(query), true);
});

test('invalid numeric URL values are normalized before reaching the API', () => {
  for (const page of ['0', '-1', '1.5', 'Infinity', '1e2', '10001', '01']) {
    assert.equal(parseGalleryQuery(`page=${page}`).page, 1);
  }
  for (const semester of ['0', '13', '-2', '1.5']) {
    assert.equal(parseGalleryQuery(`semester=${semester}`).semester, '');
  }
});

test('unknown sort values and unrelated URL parameters do not reach the API', () => {
  assert.equal(serializeGalleryQuery(parseGalleryQuery('?sort=random&tracking=abc')), '');
});

test('search terms are trimmed and bounded', () => {
  assert.equal(parseGalleryQuery('?q=%20%20ideas%20%20').q, 'ideas');
  assert.equal(parseGalleryQuery(`?q=${'a'.repeat(250)}`).q.length, 200);
  assert.equal(hasGalleryFilters({...defaultGalleryQuery, q: '  '}), false);
});

test('sorting and page selection alone do not imply filtered empty results', () => {
  assert.equal(hasGalleryFilters({...defaultGalleryQuery, sort: 'popular', page: 2}), false);
});
