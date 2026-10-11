'use strict';

// Kept self-contained so the exact tested probe can run inside the API container
// through `node -e`, without copying test tooling into the production image.
async function verifyApiPackages(apiRequire = require('node:module').createRequire('/app/apps/api/package.json')) {
  const assert = require('node:assert/strict');
  const { dirname, resolve } = require('node:path');
  const excluded = ['next', 'react', 'react-dom', 'lucide-react', 'tailwindcss', '@tailwindcss/postcss', 'jsdom', '@testing-library/react', 'concurrently'];
  for (const name of excluded) {
    for (const specifier of [name, `${name}/package.json`]) {
      // ERR_PACKAGE_PATH_NOT_EXPORTED proves presence, not absence. Checking the
      // metadata too also catches an installed package with a missing main file.
      assert.throws(() => apiRequire.resolve(specifier), error => error.code === 'MODULE_NOT_FOUND', `Unexpected API dependency: ${name}`);
    }
  }
  const prismaManifestPath = apiRequire.resolve('prisma/package.json');
  const prismaManifest = apiRequire('prisma/package.json');
  assert.equal(typeof prismaManifest.bin?.prisma, 'string', 'Prisma CLI must be installed.');
  apiRequire.resolve(resolve(dirname(prismaManifestPath), prismaManifest.bin.prisma));
  for (const name of ['tsx/cli', 'typescript', '@prisma/client', 'sharp']) apiRequire.resolve(name);
  const { PrismaClient } = apiRequire('@prisma/client');
  // The ungenerated placeholder throws here. Do not open a second DB connection;
  // the existing migration/readiness smoke already exercises real database use.
  const client = new PrismaClient({ log: [] });
  try {
    assert.equal(typeof client.upload?.aggregate, 'function', 'Generated Upload client is required.');
    assert.equal(typeof client.project?.findUnique, 'function', 'Generated Project client is required.');
    const sharp = apiRequire('sharp');
    const encoded = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#245678' } }).webp().toBuffer();
    assert(encoded.length > 0);
    const decoded = await sharp(encoded).raw().toBuffer({ resolveWithObject: true });
    assert.equal(decoded.info.width, 2);
    assert.equal(decoded.info.height, 2);
    assert.equal(decoded.info.channels, 3);
    assert.equal(decoded.data.length, 12);
  } finally { await client.$disconnect(); }
}

function apiPackageProbeSource() {
  return `(${verifyApiPackages.toString()})().catch(() => { console.error('API package isolation or native codec verification failed.'); process.exitCode = 1; });`;
}

module.exports = { verifyApiPackages, apiPackageProbeSource };
