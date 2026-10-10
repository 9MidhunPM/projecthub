'use strict';
const { access, cp } = require('node:fs/promises');
const { resolve, join } = require('node:path');

async function prepareStandalone(root) {
  const web = resolve(root, 'apps/web');
  const runtime = join(web, '.next/standalone/apps/web');
  const server = join(runtime, 'server.js');
  try {
    await Promise.all([access(server), access(join(web, '.next/static')), access(join(web, 'public'))]);
  } catch {
    throw new Error('Standalone frontend build is missing. Run npm run build -w @projecthub/web first.');
  }
  await cp(join(web, '.next/static'), join(runtime, '.next/static'), { recursive: true, verbatimSymlinks: true });
  await cp(join(web, 'public'), join(runtime, 'public'), { recursive: true, verbatimSymlinks: true });
  return server;
}

if (require.main === module) {
  prepareStandalone(resolve(__dirname, '..')).then(server => {
    // WEB_HOST avoids inheriting a container's unrelated HOSTNAME environment.
    // Local production previews listen on loopback unless explicitly configured.
    process.env.HOSTNAME = process.env.WEB_HOST || '127.0.0.1';
    process.env.PORT = process.env.WEB_PORT || process.env.PORT || '3000';
    require(server);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { prepareStandalone };
