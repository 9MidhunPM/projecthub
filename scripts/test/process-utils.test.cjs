'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { unusedPort, startProcess, stopProcess, run } = require('../process-utils.cjs');

test('allocates a loopback port and releases the temporary listener', async () => {
  const port = await unusedPort();
  assert(Number.isInteger(port) && port > 0 && port <= 65535);
});

test('propagates nonzero process exits and missing executables', async () => {
  await assert.rejects(run(process.execPath, ['-e', 'process.exit(7)'], { stdio: 'ignore' }), /failed \(7\)/);
  await assert.rejects(run('/this-command-does-not-exist', [], { stdio: 'ignore' }));
});

test('stops a long-running service and tolerates repeated cleanup', async () => {
  const handle = startProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  await stopProcess(handle);
  await stopProcess(handle);
  assert(handle.child.signalCode || handle.child.exitCode !== null);
});

test('times out stalled commands instead of hanging verification', async () => {
  await assert.rejects(run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 30, stdio: 'ignore' }), /timed out/);
});

test('honors cancellation before and during a command', async () => {
  const controller = new AbortController();
  const pending = run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { signal: controller.signal, stdio: 'ignore' });
  controller.abort();
  await assert.rejects(pending, /interrupted/);
  await assert.rejects(run(process.execPath, [], { signal: controller.signal, stdio: 'ignore' }), /interrupted/);
});

test('kills a resistant same-group descendant even after its wrapper exits', { skip: process.platform === 'win32' }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'projecthub-process-tree-'));
  const heartbeat = join(directory, 'heartbeat');
  const descendant = `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(heartbeat)}, String(process.pid) + '\\n'); setInterval(() => require('node:fs').appendFileSync(${JSON.stringify(heartbeat)}, '.'), 5);`;
  const wrapper = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {stdio: 'ignore'}); process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);`;
  const handle = startProcess(process.execPath, ['-e', wrapper], { stdio: 'ignore' });
  try {
    let value;
    const deadline = Date.now() + 3000;
    while (!value && Date.now() < deadline) {
      try { value = readFileSync(heartbeat, 'utf8'); } catch { await delay(10); }
    }
    assert(value, 'Descendant must be running before the teardown assertion.');
    await stopProcess(handle, 50);
    assert.equal(handle.child.exitCode, 0, 'Wrapper exited normally before escalation.');
    await delay(40);
    const stopped = readFileSync(heartbeat, 'utf8');
    await delay(80);
    assert.equal(readFileSync(heartbeat, 'utf8'), stopped, 'Resistant descendant must stop producing work.');
    if (process.platform === 'linux') {
      const pid = Number(stopped.split('\n')[0]);
      try { assert.match(readFileSync(`/proc/${pid}/status`, 'utf8'), /State:\s+Z/, 'Only an unreaped zombie may remain.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  } finally {
    try { if (handle.child.pid) process.kill(-handle.child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await handle.completion.catch(() => {});
    rmSync(directory, { recursive: true, force: true });
  }
});
