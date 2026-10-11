import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { isAllowedImageSignature, normalizeUpload } from '../src/images';

const supportedFormats = ['png', 'jpeg', 'webp'] as const;

function solidImage(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: '#123456' } });
}

// Four distinct quadrants make both rotations and mirrored EXIF orientations
// observable. All fixtures are generated locally, without personal image data.
const quadrantColors = [
  [240, 20, 20],
  [20, 240, 20],
  [20, 20, 240],
  [240, 240, 20],
] as const;

function quadrantImage() {
  const width = 80;
  const height = 40;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = quadrantColors[(y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1)];
      pixels.set(color, (y * width + x) * 3);
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } });
}

// Update only the IHDR dimensions and checksum of a tiny PNG. There is never
// a large pixel buffer: metadata() can read this header without decoding IDAT.
function withDeclaredPngDimensions(input: Buffer, width: number, height: number) {
  assert.equal(input.toString('ascii', 12, 16), 'IHDR');
  const result = Buffer.from(input);
  result.writeUInt32BE(width, 16);
  result.writeUInt32BE(height, 20);
  let crc = 0xffffffff;
  for (const byte of result.subarray(12, 29)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29);
  return result;
}

test('PNG, JPEG and WebP uploads remain supported and normalize to WebP', async (t) => {
  for (const format of supportedFormats) {
    await t.test(format, async () => {
      const input = await solidImage(16, 24).toFormat(format).toBuffer();
      assert.equal(isAllowedImageSignature(input), true);
      const output = await normalizeUpload(input);
      const metadata = await sharp(output).metadata();
      assert.equal(metadata.format, 'webp');
      assert.deepEqual([metadata.width, metadata.height], [16, 24]);
    });
  }
});

test('normalization strips EXIF, GPS, XMP and ICC metadata from every supported format', async (t) => {
  const privateMarker = 'synthetic-private-image-owner';
  const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/">\n` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
    `<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:creator="${privateMarker}" />\n` +
    `</rdf:RDF></x:xmpmeta>`;
  for (const format of supportedFormats) {
    await t.test(format, async () => {
      // These metadata APIs and the IFD3 GPS tag syntax are documented in the
      // installed sharp/dist/output.cjs. withMetadata also embeds an ICC profile.
      const input = await solidImage(80, 40)
        .withMetadata({ orientation: 6, density: 300 })
        .withExif({
          IFD0: { Artist: privateMarker },
          IFD3: {
            GPSLatitudeRef: 'N', GPSLatitude: '1/1 2/1 3/1',
            GPSLongitudeRef: 'E', GPSLongitude: '4/1 5/1 6/1',
          },
        })
        .withXmp(xmp)
        .toFormat(format)
        .toBuffer();
      const before = await sharp(input).metadata();
      assert.equal(before.orientation, 6, 'fixture must carry an orientation tag');
      assert.ok(before.exif?.includes(privateMarker), 'fixture must contain identifying EXIF');
      assert.ok(before.xmp?.includes(privateMarker), 'fixture must contain identifying XMP');
      assert.ok(before.icc?.length, 'fixture must contain a color profile');

      const output = await normalizeUpload(input);
      const after = await sharp(output).metadata();
      assert.equal(after.format, 'webp');
      assert.deepEqual([after.width, after.height], [40, 80]);
      for (const field of ['exif', 'xmp', 'icc', 'iptc', 'orientation'] as const) {
        assert.equal(after[field], undefined, `${field} must not survive normalization`);
      }
      assert.equal(output.includes(privateMarker), false);
    });
  }
});

test('all eight EXIF orientations are baked into pixels, including mirrored variants', async (t) => {
  // Expected source quadrants in output order: top-left, top-right,
  // bottom-left, bottom-right. This oracle does not use sharp.rotate().
  const expectedQuadrants = [
    [0, 1, 2, 3], [1, 0, 3, 2], [3, 2, 1, 0], [2, 3, 0, 1],
    [0, 2, 1, 3], [2, 0, 3, 1], [3, 1, 2, 0], [1, 3, 0, 2],
  ];
  for (const format of supportedFormats) {
    for (let orientation = 1; orientation <= 8; orientation++) {
      await t.test(`${format}, orientation ${orientation}`, async () => {
        const input = await quadrantImage().withMetadata({ orientation }).toFormat(format).toBuffer();
        assert.equal((await sharp(input).metadata()).orientation, orientation);
        const output = await normalizeUpload(input);
        assert.equal((await sharp(output).metadata()).orientation, undefined);
        const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
        const dimensions = orientation <= 4 ? [80, 40] : [40, 80];
        assert.deepEqual([info.width, info.height], dimensions);
        assert.equal(info.channels, 3);
        for (let quadrant = 0; quadrant < 4; quadrant++) {
          const x = Math.floor(info.width * (quadrant % 2 === 0 ? 0.25 : 0.75));
          const y = Math.floor(info.height * (quadrant < 2 ? 0.25 : 0.75));
          const offset = (y * info.width + x) * info.channels;
          const expected = quadrantColors[expectedQuadrants[orientation - 1][quadrant]];
          for (let channel = 0; channel < 3; channel++) {
            // Sample away from edges and allow the expected lossy WebP/JPEG
            // color variation without permitting the wrong quadrant to pass.
            assert.ok(Math.abs(data[offset + channel] - expected[channel]) <= 25,
              `wrong pixel orientation at quadrant ${quadrant}, channel ${channel}`);
          }
        }
      });
    }
  }
});

test('output fits the 1800 by 1200 box without cropping or upscaling', async (t) => {
  for (const [width, height, expectedWidth, expectedHeight] of [
    [2400, 800, 1800, 600],
    [800, 1600, 600, 1200],
    [2400, 1600, 1800, 1200],
    [1600, 1600, 1200, 1200],
    [1800, 1200, 1800, 1200],
    [40, 80, 40, 80],
    [1, 1, 1, 1],
  ]) {
    await t.test(`${width} by ${height}`, async () => {
      const output = await normalizeUpload(await solidImage(width, height).png().toBuffer());
      const metadata = await sharp(output).metadata();
      assert.deepEqual([metadata.width, metadata.height], [expectedWidth, expectedHeight]);
    });
  }
});

test('dimension limits apply after EXIF rotation', async () => {
  const input = await solidImage(2400, 800).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const metadata = await sharp(await normalizeUpload(input)).metadata();
  assert.deepEqual([metadata.width, metadata.height], [400, 1200]);
});

test('declared dimensions exceeding 40 million pixels are rejected from the header', async (t) => {
  const tinyPng = await solidImage(1, 1).png().toBuffer();
  for (const [width, height] of [[8000, 5001], [5001, 8000]]) {
    await t.test(`${width} by ${height}`, async () => {
      const input = withDeclaredPngDimensions(tinyPng, width, height);
      assert.ok(input.length < 1024, 'fixture must remain header-sized');
      assert.equal(isAllowedImageSignature(input), true);
      // Prove the header is readable independently of the application cap.
      // Do not decode this deliberately inconsistent synthetic PNG.
      const metadata = await sharp(input).metadata();
      assert.deepEqual([metadata.width, metadata.height], [width, height]);
      // The specific error distinguishes the early cap from a later failure
      // caused by the deliberately tiny IDAT data.
      await assert.rejects(normalizeUpload(input), /Input image exceeds pixel limit/);
    });
  }
});

test('SVG and unsupported signatures are rejected before native parsing', async () => {
  for (const input of [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'),
    Buffer.from('GIF89a'),
    Buffer.from('II*\0'),
    Buffer.from('RIFF\0\0\0\0WAVE'),
    Buffer.from('prefix\x89PNG\r\n\x1a\n', 'latin1'),
    Buffer.alloc(0),
  ]) {
    assert.equal(isAllowedImageSignature(input), false);
    await assert.rejects(normalizeUpload(input), /Unsupported image signature/);
  }
});

test('native SVG loader stays blocked even when invoked directly', async () => {
  await assert.rejects(sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')).metadata(), /blocked|unsupported/i);
});

test('truncated inputs with allowed PNG, JPEG and WebP signatures still fail validation', async (t) => {
  for (const [format, input] of [
    ['png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
    ['jpeg', Buffer.from([0xff, 0xd8, 0xff])],
    ['webp', Buffer.from('RIFF\x04\0\0\0WEBP', 'latin1')],
  ] as const) {
    await t.test(format, async () => {
      assert.equal(isAllowedImageSignature(input), true);
      await assert.rejects(normalizeUpload(input));
    });
  }
});
