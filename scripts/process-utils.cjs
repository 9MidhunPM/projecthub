'use strict';
const { spawn } = require('node:child_process');
const net = require('node:net');

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
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) { if (error.code !== 'ESRCH') throw error; }
}

async function stopProcess(handle, graceMs = 5000) {
  if (!handle) return;
  sendSignal(handle.child, 'SIGTERM');
  let timer;
  try {
    await Promise.race([
      handle.completion.catch(() => {}),
      new Promise(resolve => { timer = setTimeout(() => { sendSignal(handle.child, 'SIGKILL'); resolve(); }, graceMs); }),
    ]);
    await handle.completion.catch(() => {});
  } finally { clearTimeout(timer); }
}

async function run(command, args, { timeoutMs = 120000, signal, ...options } = {}) {
  if (signal?.aborted) throw new Error('Command interrupted.');
  const handle = startProcess(command, args, options);
  let timedOut = false;
  const cancel = () => { void stopProcess(handle); };
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; cancel(); }, timeoutMs);
  try {
    const result = await handle.completion;
    if (timedOut) throw new Error('Command timed out.');
    if (signal?.aborted) throw new Error('Command interrupted.');
    if (result.code !== 0) throw new Error(`Command failed (${result.signal || result.code}).`);
    return result;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    await stopProcess(handle);
  }
}

module.exports = { unusedPort, startProcess, stopProcess, run };
