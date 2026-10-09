import sharp from 'sharp';

// Reject unsupported formats before invoking any native image parser.
// The loader allowlist also prevents ambiguous/polyglot inputs reaching SVG,
// HEIF, TIFF or other parsers that this application does not need.
sharp.block({ operation: ['VipsForeignLoad'] });
sharp.unblock({ operation: ['VipsForeignLoadJpegBuffer', 'VipsForeignLoadPngBuffer', 'VipsForeignLoadWebpBuffer'] });

export function isAllowedImageSignature(input: Buffer): boolean {
  return (input.length >= 8 && input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) ||
    (input.length >= 12 && input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP');
}

export async function normalizeUpload(input: Buffer): Promise<Buffer> {
  if (!isAllowedImageSignature(input)) throw new Error('Unsupported image signature');
  const image = sharp(input, { limitInputPixels: 40000000 });
  const meta = await image.metadata();
  if (!['png', 'jpeg', 'webp'].includes(meta.format || '')) throw new Error('Unsupported image format');
  return image.rotate().resize({ width: 1800, height: 1200, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
}
