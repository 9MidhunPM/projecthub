'use strict';
// Compose carries only a file path; the database URL exists only at runtime.
const fs = require('node:fs');
const { spawn } = require('node:child_process');
try {
  if (process.env.DATABASE_URL || process.env.POSTGRES_PASSWORD) throw new Error('Conflicting credential source');
  const path = '/run/projecthub-secrets/postgres-password';
  const descriptor = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let password;
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.uid !== 0 || stat.gid !== 1000 || (stat.mode & 0o777) !== 0o440) throw new Error('Invalid credential permissions');
    password = fs.readFileSync(descriptor, 'utf8');
    if (!/^[a-f0-9]{96}$/.test(password)) throw new Error('Invalid credential format');
  } finally { fs.closeSync(descriptor); }
  const args = process.argv.slice(2);
  if (!args.length) throw new Error('Missing service command');
  const child = spawn(args[0], args.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: `postgresql://projecthub:${password}@db:5432/projecthub?schema=public` },
  });
  password = undefined;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', () => { console.error('Unable to start the database-backed service.'); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
} catch {
  console.error('Database credential setup failed. Check the read-only secret volume and initialization job.');
  process.exit(1);
}
