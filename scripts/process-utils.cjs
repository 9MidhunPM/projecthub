'use strict';
const { spawn } = require('node:child_process');
const net = require('node:net');
const { setTimeout: delay } = require('node:timers/promises');

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function startProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    ...options,
    // Keep descendants in a group we own, so an interrupted npm command cannot
    // leave an API, Next server, or database behind.
    detached: process.platform !== 'win32',
  });
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  // The caller can start a service and inspect it later without an unhandled
  // rejection in the intervening event loop tick.
  completion.catch(() => {});
  return { child, completion };
}

function sendSignal(child, signal) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    }
    else process.kill(-child.pid, signal);
  } catch (error) { if (error.code !== 'ESRCH') throw error; }
}

function processGroupAlive(child) {
  if (!child.pid) return false;
  if (process.platform === 'win32') return child.exitCode === null && child.signalCode === null;
  try { process.kill(-child.pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

async function stopProcess(handle, graceMs = 5000) {
  if (!handle) return;
  if (handle.stopping) return handle.stopping;
  handle.stopping = (async () => {
    sendSignal(handle.child, 'SIGTERM');
    const deadline = Date.now() + graceMs;
    // The npm/shell leader can exit first while a descendant ignores SIGTERM.
    // Keep watching the owned process group rather than only the leader's exit.
    while (processGroupAlive(handle.child) && Date.now() < deadline) {
      await delay(Math.min(25, Math.max(1, deadline - Date.now())));
    }
    if (processGroupAlive(handle.child)) sendSignal(handle.child, 'SIGKILL');
    await handle.completion.catch(() => {});
  })();
  return handle.stopping;
}

async function run(command, args, { timeoutMs = 120000, stopGraceMs = 5000, signal, ...options } = {}) {
  if (signal?.aborted) throw new Error('Command interrupted.');
  const handle = startProcess(command, args, options);
  let timedOut = false;
  let result;
  const cancel = () => { void stopProcess(handle, stopGraceMs).catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; cancel(); }, timeoutMs);
  try {
    result = await handle.completion;
    if (timedOut) throw new Error('Command timed out.');
    if (signal?.aborted) throw new Error('Command interrupted.');
    if (result.code !== 0) throw new Error(`Command failed (${result.signal || result.code}).`);
    return result;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    // Successful one-shot commands may intentionally daemonize (pg_ctl start).
    // Explicit cancellation and failures still own cleanup of all descendants.
    if (result?.code !== 0 || timedOut || signal?.aborted) await stopProcess(handle, stopGraceMs);
  }
}

function createCommandScope() {
  const controller = new AbortController();
  const commands = new Set();
  return {
    run(command, args, options = {}) {
      const pending = run(command, args, { ...options, signal: controller.signal, stopGraceMs: 1000 });
      commands.add(pending);
      const finished = () => commands.delete(pending);
      pending.then(finished, finished);
      return pending;
    },
    async close() {
      controller.abort();
      await Promise.allSettled([...commands]);
    },
  };
}

module.exports = { unusedPort, startProcess, stopProcess, run, createCommandScope };
