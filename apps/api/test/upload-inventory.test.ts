import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { inventoryCliOptions, inventoryUploads, type InventoryUpload, type UploadInventoryReader } from '../src/upload-inventory';

const filename = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}.webp`;
const row = (value: number, overrides: Partial<InventoryUpload> = {}): InventoryUpload => ({
  filename: filename(value), ownerId: 'fictional-owner', bytes: 4n, state: 'READY', createdAt: new Date('2026-01-02T03:04:05.000Z'), ...overrides,
});

function fakeReader(rows: InventoryUpload[], references: Record<string, number> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const sorted = [...rows].sort((a, b) => a.filename.localeCompare(b.filename));
  const reader: UploadInventoryReader = {
    async listUploads(after, limit) {
      calls.push({ method: 'listUploads', args: [after, limit] });
      const start = after === undefined ? 0 : sorted.findIndex(row => row.filename === after) + 1;
      return sorted.slice(start, start + limit);
    },
    async existingOwners(ids) {
      calls.push({ method: 'existingOwners', args: [ids] });
      return ids.filter(id => id === 'fictional-owner');
    },
    async hasUpload(name) {
      calls.push({ method: 'hasUpload', args: [name] });
      return rows.some(row => row.filename === name);
    },
    async referencingProjects(name) {
      calls.push({ method: 'referencingProjects', args: [name] });
      return references[name] ?? 0;
    },
  };
  return { reader, calls };
}

async function collect(reader: UploadInventoryReader, directory: string, batchSize = 2) {
  const records = [];
  for await (const record of inventoryUploads(reader, { directory, batchSize })) records.push(record);
  return records;
}

test('inventory reports bytes, state, owners, references and file anomalies without changing fixtures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'projecthub-inventory-'));
  try {
    await writeFile(join(directory, filename(1)), '1234');
    await writeFile(join(directory, filename(2)), 'legacy');
    await writeFile(join(directory, filename(4)), '12');
    await mkdir(join(directory, filename(5)));
    await writeFile(join(directory, filename(6)), 'orphan');
    await writeFile(join(directory, filename(7)), 'referenced');
    const { reader, calls } = fakeReader([
      row(1), row(2, { bytes: null }),
      row(3, { state: 'PENDING', ownerId: 'deleted-fictional-owner', bytes: null }),
      row(4, { bytes: 9007199254740993n }), row(5),
    ], { [filename(1)]: 2, [filename(7)]: 3 });
    const before = await readdir(directory);
    const beforeStats = await lstat(join(directory, filename(1)), { bigint: true });
    const records = await collect(reader, directory);
    assert.equal(records[0].kind, 'metadata');
    assert.equal(records[0].readOnly, true);
    assert.equal(records[0].consistency, 'best_effort_non_snapshot');
    const first = records.find(record => record.kind === 'upload' && record.filename === filename(1))!;
    assert.deepEqual(first, {
      kind: 'upload', filename: filename(1), state: 'READY', createdAt: '2026-01-02T03:04:05.000Z', ownerKnown: true,
      recordedBytes: '4', fileStatus: 'file', fileBytes: '4', sizeMatches: true,
      referencingProjects: 2, issues: [],
    });
    const pending = records.find(record => record.filename === filename(3))!;
    assert.equal(pending.state, 'PENDING');
    assert.equal(pending.ownerKnown, false);
    assert.equal(pending.fileStatus, 'missing');
    assert.deepEqual(pending.issues, ['unknown_owner', 'unknown_recorded_size', 'pending_upload', 'missing']);
    const summary = records.at(-1)!;
    assert.equal(summary.kind, 'summary');
    assert.equal(summary.complete, true);
    assert.equal(summary.uploadRows, 5);
    assert.equal(summary.readyRows, 4);
    assert.equal(summary.pendingRows, 1);
    assert.equal(summary.unknownSizeRows, 2);
    assert.equal(summary.unknownOwnerRows, 1);
    assert.equal(summary.missingFileRows, 1);
    assert.equal(summary.sizeMismatchRows, 1);
    assert.equal(summary.nonRegularFileRows, 1);
    assert.equal(summary.recordedBytes, '9007199254741001');
    assert.equal(summary.observedTrackedBytes, '12');
    assert.equal(summary.directoryEntries, 6);
    assert.equal(summary.orphanFiles, 1);
    assert.equal(summary.referencedUntrackedFiles, 1);
    assert.equal(summary.observedUntrackedBytes, '16');
    assert.deepEqual(calls.filter(call => call.method === 'listUploads').map(call => call.args), [
      [undefined, 2], [filename(2), 2], [filename(4), 2],
    ]);
    assert.ok(calls.filter(call => call.method === 'existingOwners').every(call => (call.args[0] as string[]).length <= 2));
    assert.deepEqual(await readdir(directory), before);
    assert.equal(await readFile(join(directory, filename(1)), 'utf8'), '1234');
    const afterStats = await lstat(join(directory, filename(1)), { bigint: true });
    assert.equal(afterStats.mtimeNs, beforeStats.mtimeNs);
    assert.equal(afterStats.mode, beforeStats.mode);
    assert.doesNotMatch(JSON.stringify(records), /projecthub-inventory-|deleted-fictional-owner/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('inventory never follows leaf symlinks, descends into directories, or inspects unsafe names', async () => {
  const root = await mkdtemp(join(tmpdir(), 'projecthub-inventory-'));
  const directory = join(root, 'uploads');
  try {
    await mkdir(directory);
    const privatePath = join(root, 'private-fixture');
    await writeFile(privatePath, 'confidential fictional content');
    await symlink(privatePath, join(directory, filename(1)));
    await symlink(privatePath, join(directory, filename(2)));
    await symlink(privatePath, join(directory, 'unsafe-name'));
    await mkdir(join(directory, 'nested'));
    await writeFile(join(directory, 'nested', filename(3)), 'nested');
    const { reader, calls } = fakeReader([
      row(1), row(4, { filename: '../private-fixture' }),
      row(5, { filename: privatePath }), row(6, { filename: 'filename\nforged-log.webp' }),
    ]);
    const records = await collect(reader, directory);
    const trackedLink = records.find(record => record.filename === filename(1))!;
    assert.equal(trackedLink.fileStatus, 'symlink');
    assert.equal(trackedLink.fileBytes, null);
    const untrackedLink = records.find(record => record.filename === filename(2))!;
    assert.equal(untrackedLink.fileStatus, 'symlink');
    assert.equal(untrackedLink.fileBytes, null);
    const invalid = records.filter(record => record.kind === 'upload' && record.fileStatus === 'invalid_filename');
    assert.equal(invalid.length, 3);
    assert.ok(invalid.every(record => typeof record.filenameHash === 'string' && record.filename === undefined && record.referencingProjects === null));
    assert.equal(records.at(-1)!.symlinkRows, 1);
    assert.equal(records.at(-1)!.untrackedSymlinks, 1);
    assert.equal(records.at(-1)!.unrecognizedEntries, 2);
    assert.equal(records.at(-1)!.orphanFiles, 0);
    assert.equal(records.at(-1)!.directoryEntries, 4);
    assert.equal(records.find(record => record.filename === filename(3)), undefined);
    assert.ok(calls.filter(call => call.method === 'hasUpload' || call.method === 'referencingProjects')
      .every(call => /^[a-f0-9-]+\.webp$/.test(String(call.args[0]))));
    assert.doesNotMatch(JSON.stringify(records), /private-fixture|confidential|forged-log|unsafe-name|projecthub-inventory-/);
    assert.equal(await readFile(privatePath, 'utf8'), 'confidential fictional content');
    assert.equal((await lstat(join(directory, filename(1)))).isSymbolicLink(), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('root or parent directory symlinks are rejected before the first database read', async () => {
  const root = await mkdtemp(join(tmpdir(), 'projecthub-inventory-'));
  try {
    await mkdir(join(root, 'actual'));
    await mkdir(join(root, 'actual', 'uploads'));
    await symlink(join(root, 'actual'), join(root, 'link'));
    const { reader, calls } = fakeReader([]);
    await assert.rejects(collect(reader, join(root, 'link')), /without symlinks/);
    await assert.rejects(collect(reader, join(root, 'link', 'uploads')), /without symlinks/);
    await assert.rejects(collect(reader, 'relative/uploads'), /absolute/);
    assert.deepEqual(calls, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('unknown metadata is safely represented and an empty directory gives a complete summary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'projecthub-inventory-'));
  try {
    const { reader } = fakeReader([row(1, { bytes: -1n, state: 'not-a-valid-state' })]);
    const records = await collect(reader, directory);
    assert.equal(records[1].state, 'UNKNOWN');
    assert.equal(records[1].recordedBytes, null);
    assert.equal(records.at(-1)!.unknownStateRows, 1);
    assert.equal(records.at(-1)!.invalidSizeRows, 1);
    assert.equal(records.at(-1)!.recordedBytes, '0');
    const empty = await collect(fakeReader([]).reader, directory);
    assert.equal(empty.length, 2);
    assert.equal(empty[1].uploadRows, 0);
    assert.equal(empty[1].complete, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('batch limits, advancing cursors, invalid counts and consumer cancellation are bounded', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'projecthub-inventory-'));
  try {
    const { reader, calls } = fakeReader([row(1), row(2), row(3)]);
    for (const batchSize of [0, -1, 501, 1.5, NaN]) await assert.rejects(collect(reader, directory, batchSize), /batch size/);
    assert.deepEqual(calls, []);
    const stream = inventoryUploads(reader, { directory, batchSize: 1 });
    await stream.next(); // metadata
    await stream.next(); // first row only
    await stream.return();
    assert.equal(calls.filter(call => call.method === 'listUploads').length, 1);
    await assert.rejects(collect({ ...reader, listUploads: async () => [row(1), row(2)] }, directory, 1), /batch limit/);
    await assert.rejects(collect({ ...reader, listUploads: async () => [row(1)] }, directory, 1), /cursor did not advance/);
    await assert.rejects(collect({ ...reader, referencingProjects: async () => -1 }, directory), /reference count/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

const cliArgs = ['--database-url-env', 'INVENTORY_DATABASE_URL', '--upload-dir', '/fictional/uploads'];
const localUrl = 'postgresql://fictional:private-test-password@127.0.0.1:5432/projecthub_test_inventory?schema=public';

test('CLI requires explicit credentials and isolated local target; forces read-only timeout options', () => {
  const options = inventoryCliOptions([...cliArgs, '--batch-size', '25'], { INVENTORY_DATABASE_URL: localUrl });
  assert.equal(options.batchSize, 25);
  assert.equal(options.directory, '/fictional/uploads');
  const url = new URL(options.databaseUrl);
  assert.equal(url.searchParams.get('options'), '-c default_transaction_read_only=on -c statement_timeout=15000');
  assert.equal(url.searchParams.get('connection_limit'), '1');
  assert.throws(() => inventoryCliOptions(cliArgs, { DATABASE_URL: localUrl }), /explicitly selected/);
  assert.throws(() => inventoryCliOptions(cliArgs, { INVENTORY_DATABASE_URL: localUrl, NODE_ENV: 'production' }), /refuses/);
  for (const value of [
    'postgresql://fictional:private-test-password@live.example/projecthub_test',
    'postgresql://fictional:private-test-password@localhost/projecthub',
    'postgresql://fictional:private-test-password@localhost/%70rojecthub_test',
    localUrl + '&host=live.example', localUrl + '&options=-c%20default_transaction_read_only=off',
    localUrl + '&schema=other', localUrl + '#secret-fragment',
    'postgresql://fictional:private-test-password@localhost:0/projecthub_test',
    'https://fictional:private-test-password@localhost/projecthub_test',
    'private-test-password',
  ]) {
    assert.throws(() => inventoryCliOptions(cliArgs, { INVENTORY_DATABASE_URL: value }), error => {
      assert.doesNotMatch(String(error), /private-test-password|live\.example|secret-fragment/);
      return true;
    });
  }
  for (const args of [[], [...cliArgs, '--unknown', 'secret'], [...cliArgs, '--batch-size', '501'],
    [...cliArgs, '--batch-size', '1.5'], [...cliArgs, '--upload-dir', '/duplicate'],
    ['--database-url', localUrl, '--upload-dir', '/fictional']]) {
    assert.throws(() => inventoryCliOptions(args, { INVENTORY_DATABASE_URL: localUrl }));
  }
});

test('CLI fails closed with sanitized output and never falls back to ambient DATABASE_URL', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'apps/api/src/upload-inventory.ts', ...cliArgs], {
    cwd: join(__dirname, '../../..'),
    env: { ...process.env, INVENTORY_DATABASE_URL: '', DATABASE_URL: 'postgresql://private-user:private-password@live.example/production' },
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Upload inventory failed/);
  assert.doesNotMatch(result.stderr, /private-user|private-password|live\.example|\/fictional\/uploads|Error:/);
});
