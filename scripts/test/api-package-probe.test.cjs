'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Script, runInNewContext } = require('node:vm');
const { verifyApiPackages, apiPackageProbeSource } = require('../api-package-probe.cjs');
const excluded = ['next', 'react', 'react-dom', 'lucide-react', 'tailwindcss', '@tailwindcss/postcss', 'jsdom', '@testing-library/react', 'concurrently'];

function fixture() {
  const resolved = [];
  let disconnected = false;
  const modules = {
    'prisma/package.json': { bin: { prisma: 'build/index.js' } },
    '@prisma/client': { PrismaClient: class {
      upload = { aggregate() {} };
      project = { findUnique() {} };
      async $disconnect() { disconnected = true; }
    } },
    sharp: input => ({
      webp: () => ({ toBuffer: async () => Buffer.from('encoded fixture') }),
      raw: () => ({ toBuffer: async () => {
        assert(Buffer.isBuffer(input));
        return { data: Buffer.alloc(12), info: { width: 2, height: 2, channels: 3 } };
      } }),
    }),
  };
  const required = new Set(['prisma/package.json', '/fixture/node_modules/prisma/build/index.js', 'tsx/cli', 'typescript', '@prisma/client', 'sharp']);
  const load = name => modules[name];
  load.resolve = name => {
    resolved.push(name);
    if (!required.has(name)) throw Object.assign(new Error('Fixture module is absent.'), { code: 'MODULE_NOT_FOUND' });
    return name.startsWith('/') ? name : '/fixture/node_modules/' + name;
  };
  return { load, modules, required, resolved, disconnected: () => disconnected };
}

test('API probe resolves real CLI entries, instantiates generated models, and round-trips native pixels', async () => {
  const data = fixture();
  await verifyApiPackages(data.load);
  assert(data.disconnected());
  for (const name of data.required) assert(data.resolved.includes(name), name);
  for (const name of excluded) {
    assert(data.resolved.includes(name));
    assert(data.resolved.includes(name + '/package.json'));
  }
});

test('excluded packages fail even with hidden metadata exports or a broken main entrypoint', async () => {
  for (const name of excluded) {
    const present = fixture();
    present.required.add(name);
    await assert.rejects(verifyApiPackages(present.load), /Unexpected API dependency/);
    const metadataOnly = fixture();
    metadataOnly.required.add(name + '/package.json');
    await assert.rejects(verifyApiPackages(metadataOnly.load), /Unexpected API dependency/);
  }
  const hidden = fixture();
  const original = hidden.load.resolve;
  hidden.load.resolve = name => {
    if (name === 'next') throw Object.assign(new Error('Hidden export'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
    return original(name);
  };
  await assert.rejects(verifyApiPackages(hidden.load));
});

test('missing migration/seed tools or ungenerated Prisma Client fail the probe', async () => {
  for (const name of fixture().required) {
    const data = fixture();
    data.required.delete(name);
    await assert.rejects(verifyApiPackages(data.load));
  }
  const ungenerated = fixture();
  ungenerated.modules['@prisma/client'].PrismaClient = class { constructor() { throw new Error('Not generated'); } };
  await assert.rejects(verifyApiPackages(ungenerated.load), /Not generated/);
});

test('native codec failures still disconnect the client and the serialized container probe is valid JavaScript', async () => {
  const data = fixture();
  data.modules.sharp = () => { throw new Error('Native codec unavailable'); };
  await assert.rejects(verifyApiPackages(data.load), /Native codec unavailable/);
  assert(data.disconnected());
  assert.doesNotThrow(() => new Script(apiPackageProbeSource()));
  assert.doesNotMatch(apiPackageProbeSource(), /process\.env|console\.log/);
});


test('the exact serialized container program anchors resolution in the API workspace and redacts failures', async () => {
  for (const fail of [false, true]) {
    const data = fixture();
    if (fail) data.required.add('next');
    const errors = [];
    const context = {
      require: name => name === 'node:module' ? { createRequire: anchor => {
        assert.equal(anchor, '/app/apps/api/package.json');
        return data.load;
      } } : require(name),
      console: { error: message => errors.push(message) },
      process: { exitCode: undefined },
    };
    await runInNewContext(apiPackageProbeSource(), context);
    assert.equal(context.process.exitCode, fail ? 1 : undefined);
    assert.deepEqual(errors, fail ? ['API package isolation or native codec verification failed.'] : []);
    if (!fail) assert(data.disconnected());
  }
});
