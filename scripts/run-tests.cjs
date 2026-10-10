'use strict';
const { readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { assertTestDatabaseUrl } = require('./test-database.cjs');

const root = resolve(__dirname, '..');

function selectTestFiles(directory, suite) {
  if (!['unit', 'integration'].includes(suite)) throw new Error('Choose unit or integration tests.');
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.test\.(?:ts|cjs|mjs)$/.test(entry.name))
    .filter(entry => entry.name.endsWith('.integration.test.ts') === (suite === 'integration'))
    .map(entry => resolve(directory, entry.name))
    .sort();
}

function testEnvironment(suite, environment = process.env) {
  const result = { ...environment };
  // Unit tests must never accidentally opt into a developer's configured DB.
  delete result.DATABASE_URL;
  delete result.TEST_DATABASE_URL;
  if (suite === 'integration') {
    result.TEST_DATABASE_URL = assertTestDatabaseUrl(environment.TEST_DATABASE_URL, environment);
  }
  return result;
}

function main() {
  const [workspace, suite = 'unit', ...options] = process.argv.slice(2);
  if (!['api', 'web', 'ops'].includes(workspace)) throw new Error('Choose the api, web, or ops test workspace.');
  const directories = workspace === 'ops'
    ? [resolve(root, 'scripts/test'), resolve(root, 'docker')]
    : [resolve(root, `apps/${workspace}/test`)];
  const files = directories.flatMap(directory => selectTestFiles(directory, suite));
  if (!files.length) throw new Error(`No ${suite} tests found in ${workspace}.`);
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...options, ...files], {
    cwd: root,
    env: testEnvironment(suite),
    stdio: 'inherit',
  });
  if (child.error) throw new Error('Unable to start the test runner.');
  process.exitCode = child.status ?? 1;
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { selectTestFiles, testEnvironment };
