'use strict';

async function checkReadiness(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(4000), redirect: 'error' });
  if (!response.ok) throw new Error('Readiness endpoint returned a failure.');
  const body = await response.json();
  if (body?.ok !== true || body?.database !== 'up') throw new Error('Readiness endpoint returned an unexpected response.');
}

if (require.main === module) {
  const service = process.argv[2];
  if (!['api', 'web'].includes(service)) {
    console.error('Choose api or web readiness.');
    process.exitCode = 1;
  } else {
    // The web check traverses the real Next proxy as well as the API and DB.
    const port = service === 'api' ? 4000 : 3000;
    checkReadiness(`http://127.0.0.1:${port}/api/health/ready`).catch(() => {
      console.error('Service readiness check failed.');
      process.exitCode = 1;
    });
  }
}

module.exports = { checkReadiness };
