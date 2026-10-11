import { createHash } from 'node:crypto';
import { lstat, opendir } from 'node:fs/promises';
import { isAbsolute, join, parse, resolve, sep } from 'node:path';

const SAFE_FILENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;

export interface InventoryUpload {
  filename: string;
  ownerId: string;
  bytes: bigint | null;
  state: string;
  createdAt: Date;
}

/** Deliberately has no mutation methods. Reads must not have side effects. */
export interface UploadInventoryReader {
  listUploads(after: string | undefined, limit: number): Promise<InventoryUpload[]>;
  existingOwners(ids: string[]): Promise<string[]>;
  hasUpload(filename: string): Promise<boolean>;
  referencingProjects(filename: string): Promise<number>;
}

type FileStatus = 'file' | 'missing' | 'symlink' | 'directory' | 'other' | 'unreadable' | 'invalid_filename';
type FileObservation = { fileStatus: FileStatus; fileBytes: string | null };
export type InventoryRecord = Record<string, unknown> & { kind: 'metadata' | 'upload' | 'entry' | 'summary' };

function filenameIdentity(filename: string) {
  return SAFE_FILENAME.test(filename)
    ? { filename }
    : { filenameHash: createHash('sha256').update(filename).digest('hex') };
}

/** Reject symlinks in every supplied directory component before traversing it. */
async function checkedDirectory(directory: string): Promise<string> {
  if (!isAbsolute(directory)) throw new Error('Inventory requires an absolute upload directory.');
  const normalized = resolve(directory);
  const root = parse(normalized).root;
  let current = root;
  for (const component of [root, ...normalized.slice(root.length).split(sep).filter(Boolean)]) {
    current = component === root ? root : join(current, component);
    let stats;
    try { stats = await lstat(current); }
    catch { throw new Error('Inventory directory is unavailable.'); }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error('Inventory directory and its parents must be real directories, without symlinks.');
    }
  }
  return normalized;
}

async function observeFile(directory: string, filename: string): Promise<FileObservation> {
  // Never join or inspect an untrusted database filename unless it is canonical.
  if (!SAFE_FILENAME.test(filename)) return { fileStatus: 'invalid_filename', fileBytes: null };
  try {
    const stats = await lstat(join(directory, filename), { bigint: true });
    if (stats.isSymbolicLink()) return { fileStatus: 'symlink', fileBytes: null };
    if (stats.isFile()) return { fileStatus: 'file', fileBytes: stats.size.toString() };
    return { fileStatus: stats.isDirectory() ? 'directory' : 'other', fileBytes: null };
  } catch (error) {
    return { fileStatus: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable', fileBytes: null };
  }
}

function checkedCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Inventory received an invalid reference count.');
  return value;
}

/**
 * Streaming, read-only inventory. At most batchSize upload/owner rows are retained;
 * directory entries are streamed, and output honors the consumer's backpressure.
 *
 * This is NOT a transactional snapshot: rows and files may change between reads.
 * Use a quiescent isolated copy, keep the directory and its parents stable during
 * the scan, and review findings before separately authorizing any backfill/cleanup.
 * Files are never opened or decoded, and symlinks are never followed intentionally.
 */
export async function* inventoryUploads(
  reader: UploadInventoryReader,
  options: { directory: string; batchSize?: number },
): AsyncGenerator<InventoryRecord> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`Inventory batch size must be an integer from 1 to ${MAX_BATCH_SIZE}.`);
  }
  const directory = await checkedDirectory(options.directory);
  const summary = {
    uploadRows: 0, readyRows: 0, pendingRows: 0, unknownStateRows: 0,
    unknownSizeRows: 0, invalidSizeRows: 0, unknownOwnerRows: 0,
    missingFileRows: 0, symlinkRows: 0, invalidFilenameRows: 0,
    nonRegularFileRows: 0, unreadableFileRows: 0, sizeMismatchRows: 0,
    recordedBytes: 0n, observedTrackedBytes: 0n,
    directoryEntries: 0, unrecognizedEntries: 0, untrackedEntries: 0,
    orphanFiles: 0, referencedUntrackedFiles: 0, untrackedSymlinks: 0,
    observedUntrackedBytes: 0n,
  };
  yield { kind: 'metadata', version: 1, readOnly: true, consistency: 'best_effort_non_snapshot', batchSize };
  let after: string | undefined;
  for (;;) {
    const rows = await reader.listUploads(after, batchSize);
    if (rows.length > batchSize) throw new Error('Inventory reader exceeded its batch limit.');
    if (!rows.length) break;
    const last = rows[rows.length - 1].filename;
    if (last === after) throw new Error('Inventory cursor did not advance.');
    const ownerIds = [...new Set(rows.map(row => row.ownerId))];
    const owners = new Set(await reader.existingOwners(ownerIds));
    for (const row of rows) {
      summary.uploadRows++;
      const state = row.state === 'READY' || row.state === 'PENDING' ? row.state : 'UNKNOWN';
      if (state === 'READY') summary.readyRows++;
      else if (state === 'PENDING') summary.pendingRows++;
      else summary.unknownStateRows++;
      const ownerKnown = owners.has(row.ownerId);
      if (!ownerKnown) summary.unknownOwnerRows++;
      const knownSize = typeof row.bytes === 'bigint' && row.bytes >= 0n;
      if (row.bytes === null) summary.unknownSizeRows++;
      else if (!knownSize) summary.invalidSizeRows++;
      if (knownSize) summary.recordedBytes += row.bytes!;
      const file = await observeFile(directory, row.filename);
      const referencingProjects = SAFE_FILENAME.test(row.filename)
        ? checkedCount(await reader.referencingProjects(row.filename)) : null;
      const sizeMatches = knownSize && file.fileBytes !== null ? row.bytes!.toString() === file.fileBytes : null;
      const issues: string[] = [];
      if (!ownerKnown) issues.push('unknown_owner');
      if (row.bytes === null) issues.push('unknown_recorded_size');
      else if (!knownSize) issues.push('invalid_recorded_size');
      if (state === 'UNKNOWN') issues.push('unknown_state');
      if (state === 'PENDING') issues.push('pending_upload');
      if (file.fileStatus === 'missing') summary.missingFileRows++;
      if (file.fileStatus === 'symlink') summary.symlinkRows++;
      if (file.fileStatus === 'invalid_filename') summary.invalidFilenameRows++;
      if (file.fileStatus === 'directory' || file.fileStatus === 'other') summary.nonRegularFileRows++;
      if (file.fileStatus === 'unreadable') summary.unreadableFileRows++;
      if (file.fileStatus !== 'file') issues.push(file.fileStatus);
      if (file.fileBytes !== null) summary.observedTrackedBytes += BigInt(file.fileBytes);
      if (sizeMatches === false) { summary.sizeMismatchRows++; issues.push('size_mismatch'); }
      yield {
        kind: 'upload', ...filenameIdentity(row.filename), state, createdAt: row.createdAt.toISOString(), ownerKnown,
        recordedBytes: knownSize ? row.bytes!.toString() : null,
        ...file, sizeMatches, referencingProjects, issues,
      };
    }
    after = last;
    if (rows.length < batchSize) break;
  }
  const entries = await opendir(directory);
  // Async directory iteration closes the handle even if the consumer stops early.
  for await (const entry of entries) {
    summary.directoryEntries++;
    if (!SAFE_FILENAME.test(entry.name)) {
      summary.unrecognizedEntries++;
      yield {
        kind: 'entry', ...filenameIdentity(entry.name), tracked: null,
        fileStatus: entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
        fileBytes: null, referencingProjects: null, issues: ['unrecognized_filename'],
      };
      continue;
    }
    if (await reader.hasUpload(entry.name)) continue;
    summary.untrackedEntries++;
    const file = await observeFile(directory, entry.name);
    const referencingProjects = checkedCount(await reader.referencingProjects(entry.name));
    const issues = ['missing_upload_record'];
    if (file.fileStatus === 'file') {
      summary.observedUntrackedBytes += BigInt(file.fileBytes!);
      if (referencingProjects) { summary.referencedUntrackedFiles++; issues.push('referenced_untracked_file'); }
      else { summary.orphanFiles++; issues.push('orphan_file'); }
    } else {
      issues.push(file.fileStatus);
      if (file.fileStatus === 'symlink') summary.untrackedSymlinks++;
    }
    yield { kind: 'entry', ...filenameIdentity(entry.name), tracked: false, ...file, referencingProjects, issues };
  }
  yield {
    kind: 'summary', complete: true, ...summary,
    recordedBytes: summary.recordedBytes.toString(),
    observedTrackedBytes: summary.observedTrackedBytes.toString(),
    observedUntrackedBytes: summary.observedUntrackedBytes.toString(),
  };
}

/**
 * No ambient DATABASE_URL fallback. Do not put credentials in CLI arguments.
 * This tool deliberately accepts only an isolated loopback test database.
 */
export function inventoryCliOptions(args: string[], environment: NodeJS.ProcessEnv) {
  const usage = 'Usage: node apps/api/dist/upload-inventory.js --database-url-env INVENTORY_DATABASE_URL --upload-dir /absolute/copy [--batch-size 100]';
  if (environment.NODE_ENV === 'production') throw new Error('Inventory CLI refuses NODE_ENV=production; use an isolated local copy.');
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!['--database-url-env', '--upload-dir', '--batch-size'].includes(name) || !value || values.has(name)) {
      throw new Error(usage);
    }
    values.set(name, value);
  }
  const variable = values.get('--database-url-env');
  const directory = values.get('--upload-dir');
  if (!variable || !/^[A-Z_][A-Z0-9_]*$/.test(variable) || !directory || !isAbsolute(directory)) throw new Error(usage);
  const raw = environment[variable];
  let url: URL;
  try { if (!raw) throw new Error(); url = new URL(raw); }
  catch { throw new Error('Inventory requires an explicitly selected PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !/^\/projecthub_test(?:_[a-z0-9_]+)?$/.test(url.pathname) || url.hash
      || (url.port && (Number(url.port) < 1 || Number(url.port) > 65535))) {
    throw new Error('Inventory CLI requires an isolated loopback projecthub_test database.');
  }
  const allowedParameters = new Set(['schema', 'connection_limit', 'pool_timeout']);
  for (const [key, value] of url.searchParams) {
    if (!allowedParameters.has(key) || url.searchParams.getAll(key).length !== 1
        || (key === 'schema' ? !/^[a-z_][a-z0-9_]*$/i.test(value) : !/^[1-9][0-9]*$/.test(value))) {
      throw new Error('Inventory database URL has unsupported connection parameters.');
    }
  }
  // Force read-only transactions, a bounded statement time, and one connection.
  url.searchParams.set('options', '-c default_transaction_read_only=on -c statement_timeout=15000');
  url.searchParams.set('connection_limit', '1');
  const batchText = values.get('--batch-size') ?? String(DEFAULT_BATCH_SIZE);
  if (!/^[1-9][0-9]*$/.test(batchText) || Number(batchText) > MAX_BATCH_SIZE) throw new Error('Invalid inventory batch size.');
  return { databaseUrl: url.toString(), directory, batchSize: Number(batchText) };
}

async function main() {
  // A closed pipe must produce the same sanitized failure as other output errors.
  process.stdout.on('error', () => {});
  const options = inventoryCliOptions(process.argv.slice(2), process.env);
  // Validate the filesystem before constructing any database client.
  await checkedDirectory(options.directory);
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url: options.databaseUrl } }, log: [] });
  const reader: UploadInventoryReader = {
    listUploads: (after, limit) => db.upload.findMany({
      where: after === undefined ? undefined : { filename: { gt: after } },
      orderBy: { filename: 'asc' }, take: limit,
      select: { filename: true, ownerId: true, bytes: true, state: true, createdAt: true },
    }),
    existingOwners: async ids => (await db.user.findMany({ where: { id: { in: ids } }, select: { id: true } })).map(row => row.id),
    hasUpload: async filename => Boolean(await db.upload.findUnique({ where: { filename }, select: { filename: true } })),
    referencingProjects: filename => db.project.count({ where: { screenshots: { has: '/api/uploads/' + filename } } }),
  };
  try {
    for await (const record of inventoryUploads(reader, options)) {
      // Callback completion supplies backpressure and catches closed output pipes.
      await new Promise<void>((done, fail) => process.stdout.write(JSON.stringify(record) + '\n', error => error ? fail(error) : done()));
    }
  } finally { await db.$disconnect(); }
}

if (require.main === module) {
  // Never echo a raw filesystem/Prisma error: it may contain paths or credentials.
  main().catch(() => {
    process.stderr.write('Upload inventory failed. Check explicit options, isolated database schema/access, and directory permissions. Any partial report is incomplete.\n');
    process.exitCode = 1;
  });
}
