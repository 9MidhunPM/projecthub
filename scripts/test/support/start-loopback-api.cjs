'use strict';
const assert = require('node:assert/strict');

async function startLoopbackApi(bootstrap) {
  const app = await bootstrap({ host: '127.0.0.1' });
  try {
    const address = app.getHttpServer().address();
    assert.equal(address?.address, '127.0.0.1', 'Test API must listen only on loopback.');
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

if (require.main === module) {
  const { bootstrap } = require('../../../apps/api/dist/main.js');
  startLoopbackApi(bootstrap).catch(() => {
    console.error('Unable to start the isolated loopback test API.');
    process.exitCode = 1;
  });
}
module.exports = { startLoopbackApi };
