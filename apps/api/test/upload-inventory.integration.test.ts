import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { inventoryCliOptions } from '../dist/upload-inventory';
const { assertTestDatabaseUrl } = require('../../../scripts/test-database.cjs');

test('inventory CLI runs read-only against disposable PostgreSQL and leaves fictional records/files unchanged', { skip: !process.env.TEST_DATABASE_URL, timeout: 30000 }, async t => {
  const url = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  const directory = await mkdtemp(join(tmpdir(), 'projecthub-inventory-pg-'));
  const filename = randomUUID() + '.webp';
  const ownerId = randomUUID();
  const db = new PrismaClient({ datasources: { db: { url } } });
  const args = ['--database-url-env', 'INVENTORY_DATABASE_URL', '--upload-dir', directory, '--batch-size', '2'];
  const options = inventoryCliOptions(args, { INVENTORY_DATABASE_URL: url });
  const readonly = new PrismaClient({ datasources: { db: { url: options.databaseUrl } } });
  try {
    await db.user.create({ data: { id: ownerId, email: `${ownerId}@test.example`, passwordHash: 'fixture', name: 'Inventory fixture', department: 'CS', semester: 1 } });
    const upload = await db.upload.create({ data: { filename, ownerId } });
    await writeFile(join(directory, filename), 'legacy bytes');
    const settings = await readonly.$queryRaw<any[]>`SHOW transaction_read_only`;
    assert.equal(settings[0].transaction_read_only, 'on');
    const timeout = await readonly.$queryRaw<any[]>`SHOW statement_timeout`;
    assert.equal(timeout[0].statement_timeout, '15s');
    const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [join(__dirname, '../dist/upload-inventory.js'), ...args], {
        signal: t.signal, env: { ...process.env, NODE_ENV: 'test', INVENTORY_DATABASE_URL: url }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '';
      child.stdout.on('data', value => { stdout += value; });
      child.stderr.on('data', value => { stderr += value; });
      child.on('error', reject);
      child.on('close', status => resolve({ status, stdout, stderr }));
    });
    assert.equal(result.status, 0, result.stderr);
    const records = result.stdout.trim().split('\n').map(value => JSON.parse(value));
    const record = records.find(value => value.kind === 'upload' && value.filename === filename);
    assert.equal(record.state, 'READY');
    assert.equal(record.recordedBytes, null);
    assert.equal(record.fileBytes, '12');
    assert.equal(record.ownerKnown, true);
    assert.equal(record.createdAt, upload.createdAt.toISOString());
    assert.equal(records.at(-1).complete, true);
    assert.deepEqual(await db.upload.findUniqueOrThrow({ where: { filename } }), upload);
    assert.equal(await readFile(join(directory, filename), 'utf8'), 'legacy bytes');
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(ownerId));
  } finally {
    await readonly.$disconnect();
    await db.upload.deleteMany({ where: { filename } });
    await db.user.deleteMany({ where: { id: ownerId } });
    await db.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
