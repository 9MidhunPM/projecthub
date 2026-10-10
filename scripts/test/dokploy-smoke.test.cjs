'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { stat, readdir, rm } = require('node:fs/promises');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { runInNewContext } = require('node:vm');
const smoke = require('../dokploy-smoke.cjs');
const root = resolve(__dirname, '../..');
const project = 'projecthub-recipe-ci-123-1-aabbccddeeff';
const token = 'PROJECTHUB_RECIPE_OK\n';
const services = ['api', 'db', 'migrate', 'secrets-init', 'web'];
const mount = (source, target, read_only = false) => ({ type: 'volume', source, target, read_only });
function configFixture() {
  const build = dockerfile => ({ context: root, dockerfile });
  const dependency = (name, condition) => ({ [name]: { condition, required: true } });
  return {
    name: project,
    services: {
      'secrets-init': { build: build('Dockerfile.secrets'), read_only: true, security_opt: ['no-new-privileges:true'], volumes: [mount('db_credentials', '/run/projecthub-secrets'), mount('postgres_data', '/var/lib/projecthub-db', true)] },
      db: { image: 'postgres:17-bookworm', environment: { POSTGRES_USER: 'projecthub', POSTGRES_PASSWORD_FILE: '/run/projecthub-secrets/postgres-password', POSTGRES_HOST_AUTH_METHOD: 'scram-sha-256', POSTGRES_DB: 'projecthub' }, volumes: [mount('postgres_data', '/var/lib/postgresql/data'), mount('db_credentials', '/run/projecthub-secrets', true)], depends_on: dependency('secrets-init', 'service_completed_successfully') },
      migrate: { build: build('Dockerfile.api'), entrypoint: ['node', '/app/docker/with-db-secret.cjs'], command: ['npm', 'run', 'db:migrate'], volumes: [mount('db_credentials', '/run/projecthub-secrets', true)], depends_on: dependency('db', 'service_healthy') },
      api: { build: build('Dockerfile.api'), entrypoint: ['node', '/app/docker/with-db-secret.cjs'], command: ['node', 'apps/api/dist/main.js'], environment: { NODE_ENV: 'production', PORT: '4000', WEB_ORIGIN: 'https://projecthub.midhunpm.in', COOKIE_SECURE: 'true', UPLOAD_DIR: '/app/apps/api/uploads' }, volumes: [mount('uploads', '/app/apps/api/uploads'), mount('db_credentials', '/run/projecthub-secrets', true)], depends_on: dependency('migrate', 'service_completed_successfully') },
      web: { build: { ...build('Dockerfile.web'), args: { API_INTERNAL_URL: 'http://api:4000', NODE_BUILD_OPTIONS: '--max-old-space-size=1536' } }, environment: { API_INTERNAL_URL: 'http://api:4000' }, depends_on: dependency('api', 'service_healthy') },
    },
    volumes: Object.fromEntries(['db_credentials', 'postgres_data', 'uploads'].map(name => [name, { name: `${project}_${name}` }])),
    networks: { default: { name: `${project}_default` } },
  };
}
function configured() {
  const config = configFixture();
  for (const service of Object.values(config.services)) service.networks = { default: null };
  return config;
}
function containers(stopped = false) {
  const config = configured();
  return services.map(service => ({
    project, service, user: service === 'db' ? '' : service === 'secrets-init' ? 'root' : 'node',
    init: ['api', 'web'].includes(service), readOnly: service === 'secrets-init', privileged: false,
    status: stopped || ['migrate', 'secrets-init'].includes(service) ? 'exited' : 'running', exitCode: 0,
    health: ['db', 'api', 'web'].includes(service) ? 'healthy' : null,
    ports: {}, networks: { [`${project}_default`]: {} },
    mounts: (config.services[service].volumes || []).map(item => ({ Type: 'volume', Name: `${project}_${item.source}`, Destination: item.target, RW: !item.read_only })),
  }));
}

test('recipe identity requires hosted CI and ordinary execution refuses before Docker', () => {
  const env = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
  assert.match(smoke.projectName(env), /^projecthub-recipe-ci-123-1-[a-f0-9]{12}$/);
  assert.notEqual(smoke.projectName(env), smoke.projectName(env));
  for (const key of Object.keys(env)) assert.throws(() => smoke.projectName({ ...env, [key]: '' }));
  assert.throws(() => smoke.projectName({ ...env, RUNNER_ENVIRONMENT: 'self-hosted' }));
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/dokploy-smoke.cjs')], { env: { GITHUB_ACTIONS: 'false', DATABASE_URL: 'private-do-not-print' }, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Recipe verification or scoped cleanup failed.\n');
});

test('Docker environment cannot inherit remote endpoints, Compose overrides, builders or credentials', () => {
  const result = smoke.dockerEnvironment({ PATH: '/bin', HOME: '/home/runner', TMPDIR: '/tmp', DOCKER_HOST: 'ssh://remote', DOCKER_CONTEXT: 'remote', DOCKER_CONFIG: '/private', DOCKER_TLS_VERIFY: '1', COMPOSE_FILE: 'other.yml', COMPOSE_PROFILES: 'live', BUILDX_BUILDER: 'remote', DATABASE_URL: 'private', NODE_OPTIONS: '--require=/private.js' }, '/tmp/fixture-cli');
  assert.deepEqual(result, { PATH: '/bin', HOME: '/tmp/fixture-cli', TMPDIR: '/tmp/fixture-cli', LANG: 'C.UTF-8', DOCKER_CONFIG: '/tmp/fixture-cli/docker', BUILDX_CONFIG: '/tmp/fixture-cli/buildx', BUILDX_BUILDER: 'default' });
  assert.throws(() => smoke.dockerEnvironment({ HOME: '/inherited' }));
});

test('client configuration starts private and empty without copying inherited Docker settings', async () => {
  const directory = await smoke.createDockerHome();
  try {
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.deepEqual((await readdir(directory)).sort(), ['buildx', 'docker']);
    for (const name of ['buildx', 'docker']) {
      assert.equal((await stat(resolve(directory, name))).mode & 0o777, 0o700);
      assert.deepEqual(await readdir(resolve(directory, name)), []);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('resolved recipe rejects publishing, external resources, unsafe builds and changed secret wiring', () => {
  smoke.validateConfig(configured(), project);
  const changes = [
    c => { c.name = 'other'; }, c => { c.secrets = {}; }, c => { c.configs = {}; },
    c => { c.services.api.ports = [{ target: 4000 }]; },
    c => { c.volumes.db_credentials.name = 'existing'; }, c => { c.volumes.uploads.external = true; },
    c => { c.volumes.uploads.driver = 'remote'; }, c => { c.volumes.uploads.driver_opts = { device: '/data' }; },
    c => { c.networks.default.external = true; }, c => { c.networks.default.driver = 'host'; },
    c => { c.services.api.volumes[0].type = 'bind'; }, c => { c.services.api.volumes[1].read_only = false; },
    c => { c.services.api.volumes[1].target = '/different'; }, c => { c.services.web.volumes = [mount('db_credentials', '/run/projecthub-secrets', true)]; },
    c => { c.services.api.network_mode = 'host'; }, c => { c.services.api.privileged = true; },
    c => { c.services.api.container_name = 'fixed'; }, c => { c.services.api.logging = { driver: 'remote' }; },
    c => { c.services.api.environment.DATABASE_URL = 'must-not-be-passed'; },
    c => { c.services.db.environment.POSTGRES_HOST_AUTH_METHOD = 'trust'; },
    c => { c.services.api.build.context = 'https://external.test/repo'; },
    c => { c.services.api.build.dockerfile = 'Other'; },
    ...['ssh', 'secrets', 'network', 'additional_contexts', 'privileged'].map(key => c => { c.services.api.build[key] = 'forbidden'; }),
    c => { c.services.api.entrypoint = ['other']; }, c => { c.services.web.command = ['other']; },
    c => { c.services['secrets-init'].read_only = false; },
    c => { c.services.api.depends_on.migrate.condition = 'service_started'; },
    c => { c.services.api.depends_on.migrate.required = false; },
  ];
  for (const change of changes) { const config = configured(); change(config); assert.throws(() => smoke.validateConfig(config, project)); }
});

test('official Compose 2.38.2 JSON accepts empty default IPAM but no configured IPAM options', () => {
  // Captured using the official v2.38.2 linux-x86_64 release, verified SHA-256:
  // 486b3ffc0f806ca2efbc430cef89955386011662f0c76bad17c103d059cfa9cf
  // config --format json needs no daemon. Only absolute build.context is replaced.
  const config = structuredClone(require('./fixtures/dokploy-compose-2.38.2.json'));
  for (const service of Object.values(config.services)) if (service.build) {
    assert.equal(service.build.context, '__REPOSITORY_ROOT__');
    service.build.context = root;
  }
  assert.deepEqual(config.networks.default.ipam, {});
  smoke.validateConfig(config, project);
  delete config.networks.default.ipam;
  smoke.validateConfig(config, project);
  for (const ipam of [null, [], false, { driver: 'default' }, { config: [] }, { config: [{ subnet: '10.20.0.0/16' }] }, { unexpected: true }]) {
    config.networks.default.ipam = ipam;
    assert.throws(() => smoke.validateConfig(config, project));
  }
});

test('preflight stage diagnostics accept only fixed labels and never serialize unknown input', () => {
  const output = [];
  for (const stage of ['normalize-config', 'validate-config', 'check-empty-container', 'check-empty-volume', 'check-empty-network']) smoke.reportStage(stage, (...args) => output.push(args));
  assert.deepEqual(output.map(args => args[0]), Array(5).fill('Recipe stage:'));
  for (const stage of ['private-value', { secret: 'private-value' }, undefined]) assert.throws(() => smoke.reportStage(stage, (...args) => output.push(args)));
  assert.equal(output.length, 5);
  assert(!JSON.stringify(output).includes('private-value'));
});

test('runtime requires successful initialization/migration, readonly credentials and zero host bindings', () => {
  smoke.validateRuntime(containers(), project);
  smoke.validateRuntime(containers(true), project, true);
  const changes = [
    rows => { rows[3].exitCode = 1; }, rows => { rows[2].status = 'running'; },
    rows => { rows[0].user = 'root'; }, rows => { rows[0].init = false; },
    rows => { rows[0].mounts[1].RW = true; }, rows => { rows[3].readOnly = false; },
    rows => { rows[4].ports = { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '3000' }] }; },
    rows => { rows[1].health = 'starting'; }, rows => { rows[0].project = 'foreign'; },
    rows => { rows[0].mounts[0].Name = 'foreign_uploads'; }, rows => { rows.pop(); },
  ];
  for (const change of changes) { const rows = containers(); change(rows); assert.throws(() => smoke.validateRuntime(rows, project)); }
  assert.throws(() => smoke.validateRuntime(containers(), project, true));
});

test('structural diagnostics cannot carry labels, health logs, secrets, fingerprints or arbitrary error text', () => {
  const marker = 'private-value-must-not-escape';
  const result = smoke.safeDiagnostics([{ service: marker, status: marker, exitCode: marker, health: marker, Env: [marker], Log: marker, fingerprint: marker }, { service: 'api', status: 'exited', exitCode: 1, health: 'unhealthy' }]);
  assert.deepEqual(result, [{ service: 'unknown', status: 'unknown', exitCode: null, health: null }, { service: 'api', status: 'exited', exitCode: 1, health: 'unhealthy' }]);
  assert(!JSON.stringify(result).includes(marker));
  assert.equal(smoke.safeDiagnostics(Array(30).fill({})).length, 10);
  assert.doesNotMatch(smoke.containerFormat, /Config\.Env|State\.Health\.Log|\.Args|\.Path/);
});

test('inventory finds unlabeled exact-name volume/network collisions as well as labeled resources', async () => {
  for (const kind of ['volume', 'network']) {
    const name = `${project}_${kind === 'volume' ? 'db_credentials' : 'default'}`;
    const commands = [];
    const result = await smoke.inventory(kind, project, async args => {
      commands.push(args);
      if (args.includes('--filter')) return '';
      if (args[1] === 'ls') return kind === 'volume' ? name + '\n' : 'abcdef123456 ' + name + '\n';
      return JSON.stringify({ project: null, [kind]: null, name });
    });
    assert.equal(result.length, 1);
    assert(commands.some(args => args.includes('inspect')));
    assert.throws(() => smoke.validateOwned(result, project, kind));
  }
});

test('cleanup refuses foreign/missing ownership before down and verifies complete scoped removal', async () => {
  for (const kind of ['container', 'volume', 'network']) {
    let deleted = false;
    await assert.rejects(smoke.cleanup(['compose'], project, async () => { deleted = true; }, async current => current === kind ? [{ project: 'foreign' }] : []));
    assert.equal(deleted, false);
  }
  const calls = [];
  await smoke.cleanup(['compose', '--project-name', project], project, async (args, options) => { calls.push(args); assert(options.signal); }, async () => []);
  assert.deepEqual(calls, [['compose', '--project-name', project, 'down', '--volumes', '--remove-orphans', '--timeout', '10']]);
  let down = false;
  await assert.rejects(smoke.cleanup(['compose'], project, async () => { down = true; }, async kind => down && kind === 'container' ? [{ project, service: 'api' }] : []));
});

test('orchestration stops services before damage and requires an executed refusal probe rather than CLI failure', async () => {
  const calls = []; const phases = []; let stopped = false;
  await smoke.exerciseRecipe(['compose'], project, async (args, options = {}) => {
    calls.push({ args, options });
    if (args.includes('stop')) stopped = true;
    if (options.capture) return token;
    return '';
  }, async () => containers(stopped), phase => phases.push(phase));
  assert.deepEqual(phases, ['build-and-start', 'fresh-authentication', 'restart-preservation', 'stopped-fixture-refusal']);
  const stop = calls.findIndex(call => call.args.includes('stop'));
  const withheld = calls.findIndex(call => call.args.some(arg => arg.includes('})("withhold")')));
  assert(withheld > stop);
  const refusal = calls.filter(call => call.args.some(arg => arg.includes('})("refusal")')));
  assert.equal(refusal.length, 1);
  assert.deepEqual(refusal[0].args.slice(0, -1), ['compose', 'run', '--rm', '--no-deps', '-T', '--entrypoint', 'node', 'secrets-init', '-e']);
  assert(!calls.some(call => call.options.expectExit));
  assert(calls.filter(call => call.args.includes('run')).every(call => call.args.includes('--no-deps') && call.args.includes('--rm')));
  assert(!calls.some(call => call.args.includes('--publish') || call.args.includes('--service-ports') || call.args.includes('push')));
  const migrateProbe = calls.find(call => call.args.includes('migrate') && call.args.includes('-e'));
  assert(!migrateProbe.args.includes('--entrypoint'), 'Probe must retain the actual credential wrapper.');
  await assert.rejects(smoke.exerciseRecipe(['compose'], project, async () => 'unexpected output', async () => containers()));
  let withholdAttempted = false;
  await assert.rejects(smoke.exerciseRecipe(['compose'], project, async (args, options = {}) => {
    if (args.some(arg => arg.includes('})("withhold")'))) withholdAttempted = true;
    return options.capture ? token : '';
  }, async () => containers()));
  assert.equal(withholdAttempted, false, 'Running services must block fixture damage.');
});

function fakeCommand({ code = 0, output = '', pending = false } = {}) {
  const calls = []; let stopped = 0;
  const context = { module: { exports: {} }, process: { env: { PATH: '/bin', HOME: '/home/runner', DOCKER_HOST: 'ssh://foreign' } }, __dirname: resolve(root, 'scripts'), setTimeout, clearTimeout, AbortSignal, console };
  context.require = name => name === './process-utils.cjs' ? {
    startProcess(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter(); child.stdout = new EventEmitter();
      let finish;
      const completion = new Promise(resolve => { finish = result => { resolve(result); child.emit('close'); }; });
      if (!pending) setImmediate(() => { child.stdout.emit('data', Buffer.from(output)); finish({ code }); });
      return { child, completion, finish };
    },
    async stopProcess(handle) { stopped++; handle.finish({ code: 143 }); },
  } : name === './dokploy-probes.cjs' ? require('../dokploy-probes.cjs') : require(name);
  runInNewContext(readFileSync(resolve(root, 'scripts/dokploy-smoke.cjs'), 'utf8'), context);
  return { command: (args, options = {}) => context.module.exports.dockerCommand(args, { dockerHome: '/tmp/fixture-cli', ...options }), calls, stopped: () => stopped };
}

test('command transport pins the local socket, discards runtime streams, and never reports raw errors', async () => {
  const normal = fakeCommand(); await normal.command(['compose', 'up']);
  assert.deepEqual(Array.from(normal.calls[0].args), ['--config', '/tmp/fixture-cli/docker', '--host', 'unix:///var/run/docker.sock', 'compose', 'up']);
  assert.deepEqual(Array.from(normal.calls[0].options.stdio), ['ignore', 'ignore', 'ignore']);
  assert.equal(normal.calls[0].options.env.DOCKER_HOST, undefined);
  const failure = fakeCommand({ code: 1, output: 'private-material' });
  await assert.rejects(failure.command(['exec'], { capture: true }), error => error.message === 'Recipe command failed.');
  assert(failure.stopped());
  const refused = fakeCommand({ code: 1 }); await assert.rejects(refused.command(['run'], { expectExit: 1 }), error => error.message === 'Recipe command failed.');
  const overflow = fakeCommand({ output: 'x'.repeat(65537) }); await assert.rejects(overflow.command(['inspect'], { capture: true }));
  assert(overflow.stopped());
  const timed = fakeCommand({ pending: true }); await assert.rejects(timed.command(['run'], { timeoutMs: 10 })); assert(timed.stopped());
  const active = fakeCommand({ pending: true }); const controller = new AbortController();
  const running = active.command(['run'], { signal: controller.signal }); controller.abort();
  await assert.rejects(running); assert(active.stopped());
  const aborted = fakeCommand(); await assert.rejects(aborted.command(['run'], { signal: AbortSignal.abort() })); assert.equal(aborted.calls.length, 0);
});
