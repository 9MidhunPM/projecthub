import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { isAllowedImageSignature, normalizeUpload } from '../src/images';

test('PNG, JPEG and WebP uploads remain supported and normalize to WebP', async () => {
  for (const format of ['png', 'jpeg', 'webp'] as const) {
    const input = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#123456' } }).toFormat(format).toBuffer();
    assert.equal(isAllowedImageSignature(input), true);
    const output = await normalizeUpload(input);
    assert.equal((await sharp(output).metadata()).format, 'webp');
  }
});
test('SVG and unsupported signatures are rejected before native parsing', async () => {
  for (const input of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'), Buffer.from('GIF89a'), Buffer.alloc(0)]) {
    assert.equal(isAllowedImageSignature(input), false);
    await assert.rejects(normalizeUpload(input), /Unsupported image signature/);
  }
});
test('native SVG loader stays blocked even when invoked directly', async () => {
  await assert.rejects(sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')).metadata(), /blocked|unsupported/i);
});
test('truncated inputs with valid signatures are rejected', async () => {
  await assert.rejects(normalizeUpload(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
});
