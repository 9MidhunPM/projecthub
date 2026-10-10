'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAudit } = require('../audit-dependencies.cjs');

function fixture() {
  const advisory = 'https://github.com/advisories/GHSA-fixture';
  return {
    report: { auditReportVersion: 2, vulnerabilities: {
      parent: { severity: 'high', nodes: ['node_modules/parent'], via: ['leaf'] },
      leaf: { severity: 'high', nodes: ['node_modules/leaf'], via: [{ url: advisory, severity: 'high' }] },
    } },
    lock: { packages: { 'node_modules/leaf': { version: '1.2.3' } } },
    policy: { exceptions: [{ package: 'leaf', advisory, severity: 'high', nodes: { 'node_modules/leaf': '1.2.3' }, expires: '2026-11-09', reason: 'Reviewed fixture only.' }] },
    now: new Date('2026-10-10T00:00:00Z'),
  };
}
const evaluate = value => evaluateAudit(value.report, value.lock, value.policy, value.now);

test('accepts exact reviewed advisory versions and resolves propagated findings once', () => {
  const result = evaluate(fixture());
  assert.deepEqual(result.issues, []);
  assert.equal(result.accepted.length, 1);
});

test('new advisories and changed severity fail instead of using a package-wide ignore', () => {
  const value = fixture();
  value.report.vulnerabilities.leaf.via.push({ url: 'https://github.com/advisories/new', severity: 'high' });
  assert.match(evaluate(value).issues.join(' '), /Unreviewed/);
  value.report.vulnerabilities.leaf.via[0].severity = 'critical';
  assert.match(evaluate(value).issues.join(' '), /Severity changed/);
});

test('changed versions, extra nested copies, and expired reviews fail closed', () => {
  const version = fixture();
  version.lock.packages['node_modules/leaf'].version = '1.2.4';
  assert.match(evaluate(version).issues.join(' '), /version or dependency path changed/);
  const nested = fixture();
  nested.report.vulnerabilities.leaf.nodes.push('node_modules/parent/node_modules/leaf');
  assert.match(evaluate(nested).issues.join(' '), /version or dependency path changed/);
  const expired = fixture();
  expired.now = new Date('2026-11-10T00:00:00Z');
  assert.match(evaluate(expired).issues.join(' '), /expired/);
});

test('registry errors, incomplete reports, missing causes and dependency cycles fail', () => {
  const value = fixture();
  for (const report of [null, {}, { error: 'unavailable' }, { auditReportVersion: 1 }]) {
    assert(evaluateAudit(report, value.lock, value.policy, value.now).issues.length);
  }
  delete value.report.vulnerabilities.leaf;
  assert.match(evaluate(value).issues.join(' '), /Missing advisory/);
  const cyclic = fixture();
  cyclic.report.vulnerabilities.leaf.via = ['parent'];
  assert.match(evaluate(cyclic).issues.join(' '), /Cyclic/);
});

test('obsolete and duplicate exceptions must be removed rather than silently ignored', () => {
  const clean = fixture();
  clean.report.vulnerabilities = {};
  assert.match(evaluate(clean).issues.join(' '), /stale/);
  clean.policy.exceptions = [];
  assert.deepEqual(evaluate(clean).issues, []);
  const duplicate = fixture();
  duplicate.policy.exceptions.push({ ...duplicate.policy.exceptions[0] });
  assert(evaluate(duplicate).issues.length);
});
