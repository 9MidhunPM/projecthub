'use strict';
// CI-only: builds the checked-in local Compose recipe on an ephemeral hosted runner.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { startProcess, stopProcess, unusedPort } = require('./process-utils.cjs');
const { apiPackageProbeSource } = require('./api-package-probe.cjs');

const root = resolve(__dirname, '..');
const fixturePassword = 'ci-only-local-password';
const services = ['api', 'db', 'migrate', 'web'];
const projectLabel = 'com.docker.compose.project';

function projectName(environment) {
  assert.equal(environment.GITHUB_ACTIONS, 'true', 'Docker smoke runs only on an ephemeral GitHub Actions runner.');
  assert.equal(environment.RUNNER_ENVIRONMENT, 'github-hosted', 'A GitHub-hosted runner is required.');
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']) assert.match(environment[key] || '', /^\d+$/, `${key} must be numeric.`);
  return `projecthub-ci-${environment.GITHUB_RUN_ID}-${environment.GITHUB_RUN_ATTEMPT}-${randomBytes(6).toString('hex')}`;
}

function sanitize(value) {
  return String(value).slice(-12000).replaceAll(fixturePassword, '[CI fixture redacted]')
    .replace(/([a-z][a-z0-9+.-]{0,20}:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[credentials redacted]@')
    .replace(/\b(DATABASE_URL|POSTGRES_PASSWORD|TOKEN|PASSWORD|SECRET)\s*[=:]\s*[^\s]+/gi, '$1=[redacted]')
    .slice(-12000);
}

function validateConfig(config, project, port) {
  assert.equal(config.name, project);
  assert.deepEqual(Object.keys(config.services).sort(), services);
  assert.deepEqual(Object.keys(config.volumes).sort(), ['postgres_data', 'uploads']);
  for (const [name, volume] of Object.entries(config.volumes)) {
    assert.equal(volume.name, `${project}_${name}`);
    assert(!volume.external && !volume.driver_opts, 'Only fresh project-scoped local volumes are permitted.');
  }
  assert.deepEqual(Object.keys(config.networks), ['default']);
  assert.equal(config.networks.default.name, `${project}_default`);
  assert(!config.networks.default.external && !config.networks.default.driver_opts);
  for (const [name, service] of Object.entries(config.services)) {
    assert(!service.container_name && !service.network_mode && !service.privileged);
    assert.deepEqual(Object.keys(service.networks || {}), ['default']);
    for (const mount of service.volumes || []) {
      assert.equal(mount.type, 'volume', 'Bind mounts are not permitted in this smoke test.');
      assert(['postgres_data', 'uploads'].includes(mount.source));
    }
    if (name !== 'web') assert.equal((service.ports || []).length, 0, `${name} must not publish host ports.`);
  }
  const ports = config.services.web.ports;
  assert.equal(ports.length, 1);
  assert.equal(ports[0].host_ip, '127.0.0.1');
  assert.equal(Number(ports[0].published), port);
  assert.equal(ports[0].target, 3000);
}

function validateOwned(resources, project, kind) {
  for (const resource of resources) {
    const labels = kind === 'container' ? resource.Config?.Labels : resource.Labels;
    assert.equal(labels?.[projectLabel], project, `Refusing cleanup of an unowned ${kind}.`);
    if (kind === 'container') assert(services.includes(labels['com.docker.compose.service']));
    if (kind === 'volume') assert(['postgres_data', 'uploads'].includes(labels['com.docker.compose.volume']));
    if (kind === 'network') assert.equal(labels['com.docker.compose.network'], 'default');
  }
}

function validateRuntime(containers, project, port) {
  validateOwned(containers, project, 'container');
  assert.equal(containers.length, services.length);
  const byService = Object.fromEntries(containers.map(item => [item.Config.Labels['com.docker.compose.service'], item]));
  assert.deepEqual(Object.keys(byService).sort(), services);
  assert.equal(byService.migrate.State.Status, 'exited');
  assert.equal(byService.migrate.State.ExitCode, 0);
  for (const name of ['db', 'api', 'web']) assert.equal(byService[name].State.Health?.Status, 'healthy', `${name} must be healthy.`);
  for (const name of ['api', 'web']) {
    assert.equal(byService[name].Config.User, 'node');
    assert.equal(byService[name].HostConfig.Init, true);
  }
  for (const name of ['db', 'api', 'migrate']) {
    assert(Object.values(byService[name].NetworkSettings.Ports || {}).every(bindings => bindings === null || bindings.length === 0), `${name} unexpectedly publishes a host port.`);
  }
  assert.deepEqual(byService.web.NetworkSettings.Ports, { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: String(port) }] });
}

async function command(args, { signal, timeoutMs = 60000 } = {}) {
  if (signal?.aborted) throw new Error('Docker smoke interrupted.');
  // Never honor an inherited remote Docker host/context.
  const env = { ...process.env, DOCKER_HOST: undefined, DOCKER_CONTEXT: undefined, POSTGRES_PASSWORD: fixturePassword };
  const handle = startProcess('docker', ['--context', 'default', ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let errors = '';
  let overflow = false;
  handle.child.stdout.on('data', chunk => {
    output += chunk;
    if (output.length > 1024 * 1024) { overflow = true; output = output.slice(-1024 * 1024); }
  });
  handle.child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-12000); });
  const closed = new Promise(resolve => handle.child.once('close', resolve));
  let timedOut = false;
  const stop = () => { void stopProcess(handle, 1000).catch(() => {}); };
  signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
  let result;
  try {
    result = await handle.completion;
    await closed;
    if (signal?.aborted || timedOut || result.code !== 0) throw new Error(`Docker command failed (${signal?.aborted ? 'interrupted' : timedOut ? 'timeout' : result.code}):\n${sanitize(output + '\n' + errors)}`);
    return { output, overflow };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
    if (signal?.aborted || timedOut || result?.code !== 0) await stopProcess(handle, 1000);
  }
}

async function recoverDatabase(compose, run, waitForReadiness) {
  // Some hosted Compose versions lack `start --wait`. The application readiness
  // poll already supplies a bounded check of the database, API, and proxy.
  await run([...compose, 'start', 'db']);
  await waitForReadiness(200);
}

async function main() {
  const project = projectName(process.env);
  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  const compose = ['compose', '--project-name', project, '--env-file', '/dev/null', '-f', resolve(root, 'compose.yaml')];
  // These fixture settings apply only to the disposable Compose command, never a .env file.
  process.env.WEB_PORT = String(port);
  process.env.WEB_ORIGIN = base;
  process.env.COOKIE_SECURE = 'false';
  const controller = new AbortController();
  const interrupted = () => controller.abort();
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  const deadline = setTimeout(interrupted, 15 * 60 * 1000);
  const run = (args, options = {}) => command(args, { signal: controller.signal, ...options });
  const json = async (args, options) => {
    const result = await command(args, options);
    assert(!result.overflow, 'Docker inspection exceeded its bounded output limit.');
    return JSON.parse(result.output);
  };
  const inventory = async (kind, options) => {
    const listArgs = kind === 'container' ? ['ps', '-aq'] : [kind, 'ls', '-q'];
    const result = await command([...listArgs, '--filter', `label=${projectLabel}=${project}`], options);
    const ids = result.output.trim().split(/\s+/).filter(Boolean);
    if (!ids.length) return [];
    return json(kind === 'container' ? ['inspect', '--type', kind, ...ids] : [kind, 'inspect', ...ids], options);
  };
  let mayClean = false;
  try {
    const version = await run(['compose', 'version']);
    console.log('Compose tooling:', sanitize(version.output.trim()));
    const config = await json([...compose, 'config', '--format', 'json'], { signal: controller.signal });
    validateConfig(config, project, port);
    for (const kind of ['container', 'volume', 'network']) assert.equal((await inventory(kind, { signal: controller.signal })).length, 0, 'The smoke project must start empty.');
    mayClean = true;
    console.log('Building and starting isolated Compose runtime.');
    await run([...compose, 'build'], { timeoutMs: 10 * 60 * 1000 });
    await run([...compose, 'up', '--detach', '--wait', '--wait-timeout', '180'], { timeoutMs: 200000 });
    validateRuntime(await inventory('container', { signal: controller.signal }), project, port);
    await run([...compose, 'exec', '-T', 'api', 'node', '-e', apiPackageProbeSource()]);
    console.log('API package isolation, generated client, and native image codec verified.');
    const fetchLocal = async path => fetch(`${base}${path}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]), redirect: 'error' });
    const waitForReadiness = async expected => {
      const until = Date.now() + 60000;
      while (Date.now() < until) {
        try {
          const response = await fetchLocal('/api/health/ready');
          const body = await response.json();
          if (response.status === expected) {
            if (expected === 200) assert.deepEqual(body, { ok: true, database: 'up' });
            return;
          }
        } catch (error) { if (controller.signal.aborted) throw error; }
        await delay(500, undefined, { signal: controller.signal });
      }
      throw new Error(`Readiness did not reach HTTP ${expected} within 60 seconds.`);
    };
    await waitForReadiness(200);
    const page = await fetchLocal('/');
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    const html = await page.text();
    assert.match(html, /ProjectHub/);
    const assets = [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"?]+\.(?:js|css))(?:\?[^\"]*)?"/g)].map(match => match[1]);
    assert(assets.length > 0);
    for (const asset of new Set(assets)) {
      const response = await fetchLocal(asset);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('cache-control'), /immutable/);
      assert((await response.arrayBuffer()).byteLength > 0);
    }
    // The inert marker exercises real named-volume ownership without creating an account.
    await run([...compose, 'exec', '-T', 'api', 'node', '-e', "require('node:assert/strict').equal(process.getuid(),1000);require('node:fs').writeFileSync('/app/apps/api/uploads/.ci-volume-probe','ci-volume-probe',{flag:'wx'});"]);
    await run([...compose, 'exec', '-T', 'web', 'node', '-e', "require('node:assert/strict').equal(process.getuid(),1000);"]);
    await run([...compose, 'up', '--detach', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '90', 'api'], { timeoutMs: 110000 });
    await run([...compose, 'exec', '-T', 'api', 'node', '-e', "const fs=require('node:fs');require('node:assert/strict').equal(fs.readFileSync('/app/apps/api/uploads/.ci-volume-probe','utf8'),'ci-volume-probe');fs.unlinkSync('/app/apps/api/uploads/.ci-volume-probe');"]);
    await waitForReadiness(200);
    await run([...compose, 'stop', 'db']);
    const live = await fetchLocal('/api/health');
    assert.equal(live.status, 200);
    await live.arrayBuffer();
    await waitForReadiness(503);
    await recoverDatabase(compose, run, waitForReadiness);
    console.log('Docker smoke passed: migrations, health, proxy/assets, non-root users, volume persistence, port isolation, and database recovery.');
  } catch (error) {
    console.error(sanitize(error.message));
    if (mayClean) {
      try {
        const containers = await inventory('container', { timeoutMs: 15000 });
        console.error('Container status:', JSON.stringify(containers.map(item => ({ service: item.Config?.Labels?.['com.docker.compose.service'], status: item.State?.Status, exitCode: item.State?.ExitCode, health: item.State?.Health?.Status }))));
      } catch { console.error('Container diagnostics unavailable.'); }
    }
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
    if (mayClean) {
      const cleanup = AbortSignal.timeout(90000);
      for (const kind of ['container', 'volume', 'network']) validateOwned(await inventory(kind, { signal: cleanup, timeoutMs: 15000 }), project, kind);
      await command([...compose, 'down', '--volumes', '--remove-orphans', '--timeout', '10'], { signal: cleanup, timeoutMs: 45000 });
      for (const kind of ['container', 'volume', 'network']) assert.equal((await inventory(kind, { signal: cleanup, timeoutMs: 10000 })).length, 0, 'Smoke resources remain after cleanup.');
      console.log('Owned Compose containers, network, and volumes removed.');
    }
  }
}

if (require.main === module) main().catch(error => { console.error(sanitize(error.message)); process.exitCode = 1; });
module.exports = { projectName, sanitize, validateConfig, validateOwned, validateRuntime, recoverDatabase };
