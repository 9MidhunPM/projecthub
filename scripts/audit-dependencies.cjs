'use strict';
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

function evaluateAudit(report, lock, policy, now = new Date()) {
  const issues = [];
  const accepted = new Set();
  const seenExceptions = new Set();
  const visited = new Set();
  if (report?.error || report?.auditReportVersion !== 2 || !report.vulnerabilities || typeof report.vulnerabilities !== 'object' || Array.isArray(report.vulnerabilities)) {
    return { accepted: [], issues: ['The npm audit response is missing, unsupported, or reports a registry error.'] };
  }
  if (!lock?.packages || !Array.isArray(policy?.exceptions) || !Number.isFinite(now.getTime())) {
    return { accepted: [], issues: ['The lockfile, audit policy, or review date is invalid.'] };
  }
  function visit(name, ancestors = new Set()) {
    if (ancestors.has(name)) { issues.push(`Cyclic advisory dependency: ${name}.`); return; }
    if (visited.has(name)) return;
    const vulnerability = report.vulnerabilities[name];
    if (!vulnerability || !Array.isArray(vulnerability.via) || !vulnerability.via.length || !Array.isArray(vulnerability.nodes) || !vulnerability.nodes.length) {
      issues.push(`Missing advisory details for ${name}.`); return;
    }
    if (vulnerability.severity === 'critical') issues.push(`Critical dependency finding: ${name}.`);
    for (const via of vulnerability.via) {
      if (typeof via === 'string') { visit(via, new Set([...ancestors, name])); continue; }
      if (!via || typeof via.url !== 'string' || typeof via.severity !== 'string') {
        issues.push(`Malformed advisory details for ${name}.`); continue;
      }
      const key = `${name}:${via.url}`;
      const matches = policy.exceptions.filter(entry => entry.package === name && entry.advisory === via.url);
      if (matches.length !== 1) { issues.push(`Unreviewed advisory for ${name}: ${via.url}.`); continue; }
      const exception = matches[0];
      seenExceptions.add(exception);
      if (via.severity === 'critical' || via.severity !== exception.severity) {
        issues.push(`Severity changed for ${name}: ${via.url}.`); continue;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(exception.expires || '') || !Number.isFinite(Date.parse(`${exception.expires}T23:59:59Z`)) || now > new Date(`${exception.expires}T23:59:59Z`)) {
        issues.push(`Audit review expired for ${name}: ${via.url}.`); continue;
      }
      if (typeof exception.reason !== 'string' || !exception.reason.trim()) {
        issues.push(`Audit exception needs a documented rationale for ${name}.`); continue;
      }
      let exactNodes = true;
      for (const node of vulnerability.nodes) {
        const reviewedVersion = exception.nodes?.[node];
        if (typeof reviewedVersion !== 'string' || reviewedVersion !== lock.packages[node]?.version) exactNodes = false;
      }
      if (!exactNodes) { issues.push(`Affected version or dependency path changed for ${name}: ${via.url}.`); continue; }
      accepted.add(key);
    }
    visited.add(name);
  }
  for (const name of Object.keys(report.vulnerabilities)) visit(name);
  for (const exception of policy.exceptions) {
    if (!seenExceptions.has(exception)) issues.push(`Remove the stale audit exception for ${exception.package}: ${exception.advisory}.`);
  }
  return { accepted: [...accepted], issues: [...new Set(issues)] };
}

function main() {
  const root = resolve(__dirname, '..');
  if (!process.env.npm_execpath) throw new Error('Run this check through npm run security:audit.');
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'audit', '--json', '--package-lock-only'], {
    cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.signal || ![0, 1].includes(result.status)) throw new Error('npm audit could not complete. Retry after checking registry connectivity.');
  let report;
  try { report = JSON.parse(result.stdout); }
  catch { throw new Error('npm audit did not return valid JSON.'); }
  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
  const policy = JSON.parse(readFileSync(resolve(root, 'docs/AUDIT-EXCEPTIONS.json'), 'utf8'));
  const evaluation = evaluateAudit(report, lock, policy);
  if (evaluation.issues.length) {
    for (const issue of evaluation.issues) console.error(issue);
    process.exitCode = 1;
  } else {
    console.log(`Dependency audit passed with ${evaluation.accepted.length} explicitly reviewed, version-scoped temporary advisory exceptions.`);
  }
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { evaluateAudit };
