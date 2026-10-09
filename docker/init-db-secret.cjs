'use strict';
// Runs only inside the one-shot deployment container. Never logs secret values.
const fs = require('node:fs');
const crypto = require('node:crypto');
const directory = '/run/projecthub-secrets';
const destination = `${directory}/postgres-password`;
const initializedDatabase = '/var/lib/projecthub-db/PG_VERSION';
function validateExisting() {
  const descriptor = fs.openSync(destination, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.uid !== 0 || stat.gid !== 1000 || (stat.mode & 0o777) !== 0o440) throw new Error('Invalid secret permissions');
    if (!/^[a-f0-9]{96}$/.test(fs.readFileSync(descriptor, 'utf8'))) throw new Error('Invalid secret format');
  } finally { fs.closeSync(descriptor); }
}
try {
  fs.mkdirSync(directory, { recursive: true, mode: 0o750 });
  fs.chownSync(directory, 0, 1000);
  fs.chmodSync(directory, 0o750);
  if (fs.existsSync(destination)) {
    validateExisting();
  } else {
    // Never silently change credentials for an initialized database.
    if (fs.existsSync(initializedDatabase)) throw new Error('Existing database has no matching secret file; restore its secret volume');
    const temporary = `${directory}/.pending-${crypto.randomUUID()}`;
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
      fs.writeFileSync(descriptor, crypto.randomBytes(48).toString('hex'));
      fs.fchownSync(descriptor, 0, 1000);
      fs.fchmodSync(descriptor, 0o440);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor); descriptor = undefined;
      // link is atomic and refuses replacement if another initializer won.
      try { fs.linkSync(temporary, destination); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      validateExisting();
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  console.log('Database credential file is ready.');
} catch (error) {
  // Never serialize errors carrying values or configuration objects.
  console.error('Database credential initialization failed. Check volume identity, ownership, and recovery requirements. No credential was printed.');
  process.exit(1);
}
