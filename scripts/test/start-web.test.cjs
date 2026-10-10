'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, readFile, access, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { prepareStandalone } = require('../start-web.cjs');

test('local production startup reports a missing build with an actionable command', async () => {
  const root = await mkdtemp(join(tmpdir(), 'projecthub-web-start-'));
  try { await assert.rejects(prepareStandalone(root), /npm run build -w @projecthub\/web/); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test('prepares public and compiled assets beside the generated standalone server', async () => {
  const root = await mkdtemp(join(tmpdir(), 'projecthub-web-start-'));
  const web = join(root, 'apps/web');
  const runtime = join(web, '.next/standalone/apps/web');
  try {
    await Promise.all([mkdir(runtime, { recursive: true }), mkdir(join(web, '.next/static'), { recursive: true }), mkdir(join(web, 'public'), { recursive: true })]);
    await writeFile(join(runtime, 'server.js'), '// generated server');
    await writeFile(join(web, '.next/static', 'fixture.js'), 'compiled bundle');
    await writeFile(join(web, 'public', 'fixture.txt'), 'public asset');
    await writeFile(join(web, 'source.tsx'), 'must not be copied');
    assert.equal(await prepareStandalone(root), join(runtime, 'server.js'));
    assert.equal(await readFile(join(runtime, '.next/static/fixture.js'), 'utf8'), 'compiled bundle');
    assert.equal(await readFile(join(runtime, 'public/fixture.txt'), 'utf8'), 'public asset');
    await assert.rejects(access(join(runtime, 'source.tsx')));
    await prepareStandalone(root);
    assert.equal(await readFile(join(runtime, 'server.js'), 'utf8'), '// generated server');
  } finally { await rm(root, { recursive: true, force: true }); }
});
