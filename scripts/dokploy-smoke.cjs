'use strict';
// CI-only exercise of the unchanged Dokploy recipe. No Dokploy API or domain use.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { resolve } = require('node:path');
const { startProcess, stopProcess } = require('./process-utils.cjs');
const { recipeProbeSource } = require('./dokploy-probes.cjs');

const root = resolve(__dirname, '..');
const services = ['api', 'db', 'migrate', 'secrets-init', 'web'];
const volumes = ['db_credentials', 'postgres_data', 'uploads'];
const projectLabel = 'com.docker.compose.project';
const token = 'PROJECTHUB_RECIPE_OK\n';
const mounts = {
  'secrets-init': [['db_credentials', '/run/projecthub-secrets', false], ['postgres_data', '/var/lib/projecthub-db', true]],
  db: [['postgres_data', '/var/lib/postgresql/data', false], ['db_credentials', '/run/projecthub-secrets', true]],
  migrate: [['db_credentials', '/run/projecthub-secrets', true]],
  api: [['uploads', '/app/apps/api/uploads', false], ['db_credentials', '/run/projecthub-secrets', true]],
  web: [],
};

function projectName(env) {
  assert.equal(env.GITHUB_ACTIONS, 'true');
  assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted');
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']) assert.match(env[key] || '', /^\d+$/);
  return `projecthub-recipe-ci-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}-${randomBytes(6).toString('hex')}`;
}

function dockerEnvironment(env) {
  // In particular, do not inherit COMPOSE_*, DOCKER_*, BUILDX_*, credentials,
  // NODE_OPTIONS or command-line proxy configuration from the invoking shell.
  const result = { PATH: env.PATH, HOME: env.HOME, LANG: 'C.UTF-8' };
  if (env.TMPDIR) result.TMPDIR = env.TMPDIR;
  return result;
}

function validateConfig(config, project) {
  assert.equal(config.name, project);
  assert(!config.secrets && !config.configs && !config.include);
  assert.deepEqual(Object.keys(config.services).sort(), services);
  assert.deepEqual(Object.keys(config.volumes).sort(), volumes);
  for (const [name, item] of Object.entries(config.volumes)) {
    assert.equal(item.name, `${project}_${name}`);
    assert(!item.external && !item.driver && !item.driver_opts && !item.labels);
  }
  assert.deepEqual(Object.keys(config.networks), ['default']);
  const network = config.networks.default;
  assert.equal(network.name, `${project}_default`);
  assert(!network.external && !network.driver && !network.driver_opts && !network.ipam && !network.labels);
  const environments = {
    'secrets-init': {}, migrate: {},
    db: { POSTGRES_USER: 'projecthub', POSTGRES_PASSWORD_FILE: '/run/projecthub-secrets/postgres-password', POSTGRES_HOST_AUTH_METHOD: 'scram-sha-256', POSTGRES_DB: 'projecthub' },
    api: { NODE_ENV: 'production', PORT: '4000', WEB_ORIGIN: 'https://projecthub.midhunpm.in', COOKIE_SECURE: 'true', UPLOAD_DIR: '/app/apps/api/uploads' },
    web: { API_INTERNAL_URL: 'http://api:4000' },
  };
  const dependencies = { 'secrets-init': {}, db: { 'secrets-init': 'service_completed_successfully' }, migrate: { db: 'service_healthy' }, api: { migrate: 'service_completed_successfully' }, web: { api: 'service_healthy' } };
  for (const [name, service] of Object.entries(config.services)) {
    const permitted = ['build', 'image', 'restart', 'read_only', 'security_opt', 'volumes', 'depends_on', 'environment', 'healthcheck', 'init', 'entrypoint', 'command', 'expose', 'networks'];
    assert(Object.keys(service).every(key => permitted.includes(key)));
    for (const key of ['container_name', 'network_mode', 'privileged', 'devices', 'cap_add', 'pid', 'ipc', 'extra_hosts', 'secrets', 'configs', 'env_file', 'labels', 'volumes_from', 'develop']) assert(!service[key]);
    assert.equal((service.ports || []).length, 0);
    assert.deepEqual(Object.keys(service.networks || {}), ['default']);
    assert.deepEqual(service.environment || {}, environments[name]);
    assert.deepEqual(Object.keys(service.depends_on || {}).sort(), Object.keys(dependencies[name]).sort());
    for (const [dependency, condition] of Object.entries(dependencies[name])) {
      assert.equal(service.depends_on[dependency].condition, condition);
      assert.notEqual(service.depends_on[dependency].required, false);
    }
    const actual = (service.volumes || []).map(item => {
      assert.equal(item.type, 'volume');
      assert(!item.volume?.subpath);
      return [item.source, item.target, item.read_only === true];
    });
    assert.deepEqual(actual.sort(), [...mounts[name]].sort());
    if (name === 'db') {
      assert.equal(service.image, 'postgres:17-bookworm');
      assert(!service.build && !service.entrypoint && !service.command && !service.user);
    } else {
      assert(!service.image && !service.user);
      assert.equal(service.build.context, root);
      assert.equal(service.build.dockerfile, name === 'secrets-init' ? 'Dockerfile.secrets' : name === 'web' ? 'Dockerfile.web' : 'Dockerfile.api');
      assert.deepEqual(Object.keys(service.build).sort(), name === 'web' ? ['args', 'context', 'dockerfile'] : ['context', 'dockerfile']);
      if (name === 'web') assert.deepEqual(service.build.args, { API_INTERNAL_URL: 'http://api:4000', NODE_BUILD_OPTIONS: '--max-old-space-size=1536' });
    }
  }
  assert.equal(config.services['secrets-init'].read_only, true);
  assert.deepEqual(config.services['secrets-init'].security_opt, ['no-new-privileges:true']);
  for (const name of ['api', 'migrate']) assert.deepEqual(config.services[name].entrypoint, ['node', '/app/docker/with-db-secret.cjs']);
  for (const name of ['web', 'secrets-init']) assert(!config.services[name].entrypoint && !config.services[name].command);
  assert.deepEqual(config.services.migrate.command, ['npm', 'run', 'db:migrate']);
  assert.deepEqual(config.services.api.command, ['node', 'apps/api/dist/main.js']);
}

function validateOwned(items, project, kind) {
  for (const item of items) {
    assert.equal(item.project, project, 'Unowned recipe resource.');
    if (kind === 'container') assert(services.includes(item.service));
    if (kind === 'volume') {
      assert(volumes.includes(item.volume));
      assert.equal(item.name, `${project}_${item.volume}`);
    }
    if (kind === 'network') {
      assert.equal(item.network, 'default');
      assert.equal(item.name, `${project}_default`);
    }
  }
}

function validateRuntime(items, project, stopped = false) {
  validateOwned(items, project, 'container');
  assert.equal(items.length, services.length);
  assert.deepEqual(items.map(item => item.service).sort(), services);
  for (const item of items) {
    assert(Object.values(item.ports || {}).every(value => value === null || value.length === 0));
    assert(!item.privileged);
    assert.deepEqual(Object.keys(item.networks || {}), [`${project}_default`]);
    const actual = item.mounts.map(mount => {
      assert.equal(mount.Type, 'volume');
      return [mount.Name, mount.Destination, mount.RW === false];
    });
    assert.deepEqual(actual.sort(), mounts[item.service].map(([volume, target, ro]) => [`${project}_${volume}`, target, ro]).sort());
    if (['api', 'migrate', 'web'].includes(item.service)) assert.equal(item.user, 'node');
    if (['api', 'web'].includes(item.service)) assert.equal(item.init, true);
    if (item.service === 'secrets-init') {
      assert.equal(item.user, 'root');
      assert.equal(item.readOnly, true);
    }
    if (stopped || ['migrate', 'secrets-init'].includes(item.service)) {
      assert.equal(item.status, 'exited');
      if (!stopped) assert.equal(item.exitCode, 0);
    } else {
      assert.equal(item.status, 'running');
      assert.equal(item.health, 'healthy');
    }
  }
}

function safeDiagnostics(items) {
  // Never print labels, names, health logs, commands, environment or thrown data.
  return items.slice(0, 10).map(item => ({
    service: services.includes(item.service) ? item.service : 'unknown',
    status: ['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'].includes(item.status) ? item.status : 'unknown',
    exitCode: Number.isInteger(item.exitCode) && item.exitCode >= 0 && item.exitCode <= 255 ? item.exitCode : null,
    health: ['starting', 'healthy', 'unhealthy'].includes(item.health) ? item.health : null,
  }));
}

async function dockerCommand(args, { signal, timeoutMs = 60000, capture = false, expectExit = 0 } = {}) {
  if (signal?.aborted) throw new Error('Recipe command cancelled.');
  const handle = startProcess('docker', ['--host', 'unix:///var/run/docker.sock', ...args], {
    cwd: root, env: dockerEnvironment(process.env), stdio: ['ignore', capture ? 'pipe' : 'ignore', 'ignore'],
  });
  let output = '';
  let overflow = false;
  let timedOut = false;
  const stop = () => { void stopProcess(handle, 1000).catch(() => {}); };
  if (capture) handle.child.stdout.on('data', chunk => {
    if (output.length + chunk.length > 65536) { overflow = true; stop(); }
    else output += chunk;
  });
  const closed = new Promise(resolve => handle.child.once('close', resolve));
  signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
  let result;
  try {
    result = await handle.completion;
    await closed;
    if (signal?.aborted || timedOut || overflow || result.code !== expectExit) throw new Error('Recipe command failed.');
    return output;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
    if (signal?.aborted || timedOut || overflow || result?.code !== expectExit) await stopProcess(handle, 1000);
  }
}

// Docker exposes only these structural fields, never Config.Env or health logs.
const containerFormat = '{"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"user":{{json .Config.User}},"status":{{json .State.Status}},"exitCode":{{json .State.ExitCode}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},"init":{{json .HostConfig.Init}},"readOnly":{{json .HostConfig.ReadonlyRootfs}},"privileged":{{json .HostConfig.Privileged}},"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}},"mounts":{{json .Mounts}}}';

async function inventory(kind, project, command, options = {}) {
  assert(['container', 'volume', 'network'].includes(kind));
  const list = kind === 'container' ? ['ps', '-aq'] : [kind, 'ls', '-q'];
  const output = await command([...list, '--filter', `label=${projectLabel}=${project}`], { ...options, capture: true });
  let ids = output.trim() ? output.trim().split(/\s+/) : [];
  // Compose down targets configured volume/network names, too. A foreign or
  // unlabeled exact-name collision must not disappear from a label-only scan.
  if (kind === 'volume') {
    const names = await command(['volume', 'ls', '-q'], { ...options, capture: true });
    ids.push(...names.trim().split(/\s+/).filter(name => volumes.some(volume => name === `${project}_${volume}`)));
  }
  if (kind === 'network') {
    const names = await command(['network', 'ls', '--format', '{{.ID}} {{.Name}}'], { ...options, capture: true });
    for (const line of names.trim().split('\n')) {
      const [id, name] = line.split(' ');
      if (name === `${project}_default`) ids.push(id);
    }
  }
  ids = [...new Set(ids)];
  if (!ids.length) return [];
  for (const id of ids) assert(kind === 'volume' ? volumes.some(name => id === `${project}_${name}`) : /^[a-f0-9]{12,64}$/.test(id));
  const format = kind === 'container' ? containerFormat : `{"project":{{json (index .Labels "${projectLabel}")}},"${kind}":{{json (index .Labels "com.docker.compose.${kind}")}},"name":{{json .Name}}}`;
  const result = await command(kind === 'container' ? ['inspect', '--type', 'container', '--format', format, ...ids] : [kind, 'inspect', '--format', format, ...ids], { ...options, capture: true });
  const items = result.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(items.length, ids.length);
  return items;
}

async function exerciseRecipe(compose, project, run, inspect, onStage = () => {}) {
  const probe = async (service, operation, oneOff = false) => {
    const prefix = oneOff ? [...compose, 'run', '--rm', '--no-deps', '-T', ...(service === 'secrets-init' ? ['--entrypoint', 'node'] : []), service] : [...compose, 'exec', '-T', service];
    const executable = oneOff && service === 'secrets-init' ? [] : service === 'api' ? ['node', '/app/docker/with-db-secret.cjs', 'node'] : ['node'];
    assert.equal(await run([...prefix, ...executable, '-e', recipeProbeSource(operation)], { capture: true }), token);
  };
  onStage('build-and-start');
  await run([...compose, 'build'], { timeoutMs: 10 * 60 * 1000 });
  await run([...compose, 'up', '--detach', '--wait', '--wait-timeout', '180'], { timeoutMs: 200000 });
  validateRuntime(await inspect(), project);
  onStage('fresh-authentication');
  assert.equal(await run([...compose, 'exec', '-T', 'db', 'sh', '-c', 'test "$(cat /proc/1/comm)" = postgres && test "$(id -u postgres)" != 0 && awk -v expected="$(id -u postgres)" \'/^Uid:/{found=1; for(i=2;i<=5;i++) if($i!=expected) exit 1} END{if(!found) exit 1}\' /proc/1/status && printf "PROJECTHUB_RECIPE_OK\\n"'], { capture: true }), token);
  await probe('secrets-init', 'capture', true);
  await probe('migrate', 'auth', true);
  await probe('api', 'auth');
  await probe('web', 'http');
  onStage('restart-preservation');
  await run([...compose, 'run', '--rm', '--no-deps', '-T', 'secrets-init']);
  await probe('secrets-init', 'preserved', true);
  for (const service of ['db', 'api']) await run([...compose, 'up', '--detach', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '90', service], { timeoutMs: 110000 });
  await run([...compose, 'run', '--rm', '--no-deps', '-T', 'migrate']);
  await probe('api', 'auth');
  await probe('web', 'http');
  await probe('secrets-init', 'preserved', true);
  validateRuntime(await inspect(), project);
  onStage('stopped-fixture-refusal');
  // Damage only this synthetic fixture, after all original services are stopped.
  await run([...compose, 'stop', '--timeout', '10'], { timeoutMs: 45000 });
  validateRuntime(await inspect(), project, true);
  await probe('secrets-init', 'withhold', true);
  await probe('secrets-init', 'missing', true);
  await run([...compose, 'run', '--rm', '--no-deps', '-T', 'secrets-init'], { expectExit: 1 });
  await probe('secrets-init', 'missing', true);
  validateRuntime(await inspect(), project, true);
}

async function cleanup(compose, project, command, inspect) {
  const signal = AbortSignal.timeout(90000);
  for (const kind of ['container', 'volume', 'network']) validateOwned(await inspect(kind, { signal, timeoutMs: 15000 }), project, kind);
  await command([...compose, 'down', '--volumes', '--remove-orphans', '--timeout', '10'], { signal, timeoutMs: 45000 });
  for (const kind of ['container', 'volume', 'network']) assert.equal((await inspect(kind, { signal, timeoutMs: 10000 })).length, 0);
}

async function main() {
  const project = projectName(process.env);
  const compose = ['compose', '--project-name', project, '--env-file', '/dev/null', '-f', resolve(root, 'compose.dokploy.yaml')];
  const controller = new AbortController();
  const interrupted = () => controller.abort();
  process.on('SIGINT', interrupted);
  process.on('SIGTERM', interrupted);
  const deadline = setTimeout(interrupted, 15 * 60 * 1000);
  const run = (args, options = {}) => dockerCommand(args, { signal: controller.signal, ...options });
  const inspect = (kind, options = {}) => inventory(kind, project, dockerCommand, options);
  let mayClean = false;
  try {
    validateConfig(JSON.parse(await run([...compose, 'config', '--format', 'json'], { capture: true })), project);
    for (const kind of ['container', 'volume', 'network']) assert.equal((await inspect(kind, { signal: controller.signal })).length, 0);
    mayClean = true;
    console.log('Starting isolated, port-free recipe verification. Runtime logs are suppressed.');
    await exerciseRecipe(compose, project, run, () => inspect('container', { signal: controller.signal }), stage => console.log('Recipe stage:', stage));
    console.log('Recipe checks passed: initialization, authentication, privilege drop, preservation, and missing-secret refusal.');
  } catch {
    console.error('Recipe verification failed. Raw runtime diagnostics are intentionally unavailable.');
    if (mayClean) {
      try { console.error('Service states:', JSON.stringify(safeDiagnostics(await inspect('container', { timeoutMs: 15000 })))); }
      catch { console.error('Service state diagnostics unavailable.'); }
    }
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    try {
      if (mayClean) {
        await cleanup(compose, project, dockerCommand, inspect);
        console.log('Owned recipe containers, network, and disposable volumes removed.');
      }
    } finally {
      process.removeListener('SIGINT', interrupted);
      process.removeListener('SIGTERM', interrupted);
    }
  }
}

if (require.main === module) main().catch(() => { console.error('Recipe verification or scoped cleanup failed.'); process.exitCode = 1; });
module.exports = { projectName, dockerEnvironment, validateConfig, validateOwned, validateRuntime, safeDiagnostics, dockerCommand, inventory, exerciseRecipe, cleanup, containerFormat };
