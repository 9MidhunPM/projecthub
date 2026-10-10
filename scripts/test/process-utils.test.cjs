'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
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
