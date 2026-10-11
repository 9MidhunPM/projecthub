import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MAX_SCREENSHOT_BYTES, moveScreenshot, validateScreenshots} from '../lib/screenshots';
const image = {name: 'project.png', size: 100, type: 'image/png'};

test('all files are checked before the caller can start uploading', () => {
  assert.match(validateScreenshots([image, {...image, name: 'notes.txt', type: 'text/plain'}], 0)!, /notes.txt/);
  assert.equal(validateScreenshots([image], 7), null);
  assert.match(validateScreenshots([image, image], 7)!, /1 more screenshot/);
});

test('empty and oversized images have actionable messages', () => {
  assert.match(validateScreenshots([{...image, size: 0}], 0)!, /empty/);
  assert.match(validateScreenshots([{...image, size: MAX_SCREENSHOT_BYTES + 1}], 0)!, /larger than 5 MB/);
  assert.equal(validateScreenshots([{...image, size: MAX_SCREENSHOT_BYTES}], 0), null);
});

test('reordering a screenshot changes the cover without mutating the source', () => {
  const before = ['one', 'two', 'three'];
  assert.deepEqual(moveScreenshot(before, 2, 0), ['three', 'one', 'two']);
  assert.deepEqual(before, ['one', 'two', 'three']);
  assert.deepEqual(moveScreenshot(before, -1, 1), before);
  assert.deepEqual(moveScreenshot(before, 0, 3), before);
});
