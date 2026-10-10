'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { projectName, sanitize, validateConfig, validateOwned, validateRuntime } = require('../docker-smoke.cjs');

const project = 'projecthub-ci-123-1-aabbccddeeff';
const port = 32123;
const clone = value => structuredClone(value);
const label = 'com.docker.compose.project';
function configFixture() {
  return {
    name: project,
    services: {
      api: { networks: { default: null }, volumes: [{ type: 'volume', source: 'uploads' }] },
      db: { networks: { default: null }, volumes: [{ type: 'volume', source: 'postgres_data' }] },
      migrate: { networks: { default: null } },
      web: { networks: { default: null }, ports: [{ target: 3000, published: String(port), host_ip: '127.0.0.1' }] },
    },
    volumes: { postgres_data: { name: `${project}_postgres_data` }, uploads: { name: `${project}_uploads` } },
    networks: { default: { name: `${project}_default` } },
  };
}
function containerFixture() {
  return ['api', 'db', 'migrate', 'web'].map(service => ({
    Config: { User: service === 'db' ? '' : 'node', Labels: { [label]: project, 'com.docker.compose.service': service } },
    State: { Status: service === 'migrate' ? 'exited' : 'running', ExitCode: 0, ...(service === 'migrate' ? {} : { Health: { Status: 'healthy' } }) },
    HostConfig: { Init: ['api', 'web'].includes(service) },
    NetworkSettings: { Ports: service === 'web' ? { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: String(port) }] } : { '4000/tcp': null } },
  }));
}

test('smoke project identity requires a hosted CI run and is unique', () => {
  const env = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
  const first = projectName(env);
  assert.match(first, /^projecthub-ci-123-1-[a-f0-9]{12}$/);
  assert.notEqual(projectName(env), first);
  for (const key of Object.keys(env)) assert.throws(() => projectName({ ...env, [key]: '' }));
  assert.throws(() => projectName({ ...env, RUNNER_ENVIRONMENT: 'self-hosted' }));
  assert.throws(() => projectName({ ...env, GITHUB_RUN_ID: '123; unsafe' }));
});

test('resolved smoke config requires scoped volumes and loopback-only web publishing', () => {
  validateConfig(configFixture(), project, port);
  const mutations = [
    config => { config.name = 'production'; },
    config => { config.volumes.uploads.name = 'existing-uploads'; },
    config => { config.volumes.uploads.external = true; },
    config => { config.volumes.uploads.driver_opts = { device: '/srv/data' }; },
    config => { config.networks.default.external = true; },
    config => { config.networks.default.name = 'production'; },
    config => { config.services.api.volumes[0].type = 'bind'; },
    config => { config.services.api.volumes[0].source = 'unscoped'; },
    config => { config.services.api.ports = [{ target: 4000 }]; },
    config => { config.services.db.ports = [{ target: 5432 }]; },
    config => { config.services.web.ports[0].host_ip = '0.0.0.0'; },
    config => { config.services.web.ports[0].published = '3000'; },
    config => { config.services.web.ports.push({ target: 1234 }); },
    config => { config.services.api.privileged = true; },
    config => { config.services.api.container_name = 'fixed-name'; },
    config => { config.services.api.network_mode = 'host'; },
    config => { config.services.unexpected = {}; },
  ];
  for (const mutate of mutations) {
    const config = configFixture();
    mutate(config);
    assert.throws(() => validateConfig(config, project, port));
  }
});

test('cleanup refuses resources without exact project and expected resource labels', () => {
  const fixtures = {
    container: { Config: { Labels: { [label]: project, 'com.docker.compose.service': 'api' } } },
    volume: { Labels: { [label]: project, 'com.docker.compose.volume': 'uploads' } },
    network: { Labels: { [label]: project, 'com.docker.compose.network': 'default' } },
  };
  for (const [kind, resource] of Object.entries(fixtures)) {
    validateOwned([resource], project, kind);
    validateOwned([], project, kind);
    const foreign = clone(resource);
    (kind === 'container' ? foreign.Config.Labels : foreign.Labels)[label] = 'projecthub';
    assert.throws(() => validateOwned([foreign], project, kind));
    assert.throws(() => validateOwned([{}], project, kind));
  }
  assert.throws(() => validateOwned([{ Labels: { [label]: project, 'com.docker.compose.volume': 'foreign' } }], project, 'volume'));
});

test('runtime checks enforce migration success, readiness, users, init, and actual port bindings', () => {
  validateRuntime(containerFixture(), project, port);
  const mutations = [
    rows => { rows[2].State.ExitCode = 1; },
    rows => { rows[2].State.Status = 'running'; },
    rows => { rows[0].State.Health.Status = 'unhealthy'; },
    rows => { rows[3].State.Health.Status = 'starting'; },
    rows => { rows[0].Config.User = 'root'; },
    rows => { rows[3].HostConfig.Init = false; },
    rows => { rows[1].NetworkSettings.Ports['5432/tcp'] = [{ HostIp: '127.0.0.1', HostPort: '5432' }]; },
    rows => { rows[3].NetworkSettings.Ports['3000/tcp'][0].HostIp = '0.0.0.0'; },
    rows => { rows.pop(); },
  ];
  for (const mutate of mutations) {
    const rows = containerFixture();
    mutate(rows);
    assert.throws(() => validateRuntime(rows, project, port));
  }
});

test('failure diagnostics redact fixture passwords and credential URLs and stay bounded', () => {
  const output = sanitize('failure postgresql://person:sensitive@db/test POSTGRES_PASSWORD=other TOKEN=private ci-only-local-password');
  for (const value of ['person', 'sensitive', 'other', 'private', 'ci-only-local-password']) assert(!output.includes(value));
  assert(output.includes('failure'));
  assert(sanitize('x'.repeat(20000)).length <= 12000);
});
