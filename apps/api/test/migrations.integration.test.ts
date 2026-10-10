import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
const { assertTestDatabaseUrl } = require('../../../scripts/test-database.cjs');

test('migrations preserve populated baseline projects and initialize concurrency versions', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  const db = new PrismaClient({ datasources: { db: { url } } });
  const schema = 'migration_test_' + randomUUID().replaceAll('-', '');
  const directory = join(__dirname, '../prisma/migrations');
  const migrations = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  const rollback = new Error('rollback isolated migration fixture');
  try {
    await assert.rejects(db.$transaction(async tx => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      async function apply(name: string) {
        // Checked-in migrations currently contain plain SQL statements, not
        // stored procedures or strings containing statement delimiters.
        const sql = (await readFile(join(directory, name, 'migration.sql'), 'utf8')).replace(/^\s*--.*$/gm, '');
        for (const statement of sql.split(';').filter(value => value.trim())) await tx.$executeRawUnsafe(statement);
      }
      await apply(migrations[0]);
      await tx.$executeRaw`INSERT INTO "User" (id,email,"passwordHash",name,department,semester) VALUES ('owner','fixture@example.test','fixture','Owner','CS',4)`;
      await tx.$executeRaw`INSERT INTO "Project" (id,title,description,department,semester,type,"techStack","teamMembers",screenshots,status,views,"ownerId","updatedAt") VALUES ('project','Existing title','Existing description','CS',4,'Research',ARRAY['TypeScript'],ARRAY['Owner'],ARRAY[]::text[],'APPROVED',12,'owner',CURRENT_TIMESTAMP)`;
      await tx.$executeRaw`INSERT INTO "Upload" (filename,"ownerId","createdAt") VALUES ('11111111-1111-4111-8111-111111111111.webp','owner','2020-01-01')`;
      for (const migration of migrations.slice(1)) await apply(migration);
      const [project] = await tx.$queryRaw<any[]>`SELECT title,status,views,version,"ownerId","techStack" FROM "Project" WHERE id='project'`;
      assert.deepEqual(project, { title: 'Existing title', status: 'APPROVED', views: 12, version: 0, ownerId: 'owner', techStack: ['TypeScript'] });
      const [upload] = await tx.$queryRaw<any[]>`SELECT filename,"ownerId",bytes,state,"createdAt" FROM "Upload"`;
      assert.deepEqual(upload, { filename: '11111111-1111-4111-8111-111111111111.webp', ownerId: 'owner', bytes: null, state: 'READY', createdAt: new Date('2020-01-01') });
      assert.equal(await tx.$executeRaw`UPDATE "Project" SET version=version+1 WHERE id='project' AND version=0`, 1);
      assert.equal(await tx.$executeRaw`UPDATE "Project" SET title='Lost update' WHERE id='project' AND version=0`, 0);
      const indexes = await tx.$queryRaw<{ indexname: string; indexdef: string }[]>`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=${schema}`;
      const names = new Set(indexes.map(index => index.indexname));
      for (const name of ['Session_userId_expiresAt_idx', 'Project_ownerId_updatedAt_idx', 'Project_status_updatedAt_idx', 'Like_projectId_idx', 'Bookmark_projectId_idx', 'Audit_createdAt_idx']) assert(names.has(name), name);
      for (const name of ['Project_techStack_idx', 'Project_screenshots_idx']) assert.match(indexes.find(index => index.indexname === name)!.indexdef, /USING gin/);
      throw rollback;
    }, { timeout: 15000 }), error => error === rollback);
  } finally {
    await db.$disconnect();
  }
});
