import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createSession } from '../../dist/sessions';
const { assertTestDatabaseUrl } = require('../../../../scripts/test-database.cjs');

/** A private schema keeps global collection totals independent of parallel tests. */
export async function isolatedApi() {
  const source = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  const schema = 'collection_test_' + randomUUID().replaceAll('-', '');
  const url = new URL(source);
  url.searchParams.set('schema', schema);
  const control = new PrismaClient({ datasources: { db: { url: source } } });
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const previous = { DATABASE_URL: process.env.DATABASE_URL, WEB_ORIGIN: process.env.WEB_ORIGIN };
  let app: NestExpressApplication | undefined;
  async function close() {
    try {
      await app?.close();
      await db.$disconnect();
      await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await control.$disconnect();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  }
  try {
    const directory = join(__dirname, '../../prisma/migrations');
    const migrations = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    await control.$transaction(async tx => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      for (const migration of migrations) {
        // These checked-in migrations contain plain SQL, not stored procedures
        // or string literals containing statement delimiters.
        const sql = (await readFile(join(directory, migration, 'migration.sql'), 'utf8')).replace(/^\s*--.*$/gm, '');
        for (const statement of sql.split(';').filter(value => value.trim())) await tx.$executeRawUnsafe(statement);
      }
    }, { timeout: 15000 });
    process.env.DATABASE_URL = url.toString();
    process.env.WEB_ORIGIN = 'http://localhost:3000';
    const { bootstrap } = await import('../../dist/main');
    app = await bootstrap({ port: 0, host: '127.0.0.1' });
    const base = await app.getUrl();
    return {
      db, close,
      cookie: async (userId: string) => 'ph_session=' + (await createSession(db, userId)).token,
      request: async (path: string, cookie = '', method = 'GET', body?: unknown) => {
        const response = await fetch(base + '/api' + path, {
          method, headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', ...(cookie ? { Cookie: cookie } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await response.text();
        return { status: response.status, body: JSON.parse(text), bytes: Buffer.byteLength(text) };
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
