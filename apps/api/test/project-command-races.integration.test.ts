import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../dist/db';
import { isolatedApi } from './support/isolated-api';

type Command = 'edit' | 'delete' | 'approve';

/** Delay one real write after validation; leave competing Prisma promises lazy. */
function pauseOnce(object: any, method: string, predicate: (...args: any[]) => boolean) {
  const original = object[method];
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let used = false;
  object[method] = function (...args: any[]) {
    if (!used && predicate(...args)) {
      used = true;
      enter();
      return waiting.then(() => original.apply(this, args));
    }
    // An async wrapper here would replace the competitor's PrismaPromise with a
    // native Promise, breaking the real approval transaction instead of racing it.
    return original.apply(this, args);
  };
  return {
    release,
    restore() { object[method] = original; },
    async wait(pending: Promise<unknown>) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          entered,
          pending.then(() => { throw new Error('Command finished before its write barrier'); }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Command write barrier timed out')), 5000); }),
        ]);
      } finally { clearTimeout(timer); }
    },
  };
}

test('overlapping edit, delete, and approval commands preserve the winner in both orders', {
  skip: !process.env.TEST_DATABASE_URL, timeout: 30000,
}, async t => {
  const cancellation = new AbortController();
  const pending = new Set<Promise<unknown>>();
  const gates = new Set<ReturnType<typeof pauseOnce>>();
  let api: Awaited<ReturnType<typeof isolatedApi>> | undefined;
  let initializing: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  const active = () => { if (cancellation.signal.aborted) throw new Error('Command race fixture cancelled'); };
  const cancel = () => {
    cancellation.abort();
    for (const gate of gates) gate.release();
  };
  const close = () => closing ??= (async () => {
    cancel();
    await Promise.allSettled([...pending]);
    for (const gate of gates) gate.restore();
    await initializing?.catch(() => {});
    await api?.close();
  })();
  t.signal.addEventListener('abort', cancel, { once: true });
  t.after(async () => {
    t.signal.removeEventListener('abort', cancel);
    await close();
  });

  try {
    initializing = isolatedApi().then(value => { api = value; });
    await initializing;
    active();
    const { db } = api!;
    const applicationDb = api!.app.get(Db);
    const owner = await db.user.create({ data: { email: 'owner@command-races.test.example', name: 'Fictional owner', passwordHash: 'not-a-login-fixture', department: 'CS', semester: 2 } });
    active();
    const reviewer = await db.user.create({ data: { email: 'reviewer@command-races.test.example', name: 'Fictional reviewer', passwordHash: 'not-a-login-fixture', department: 'CS', semester: 2, role: 'FACULTY' } });
    active();
    const ownerCookie = await api!.cookie(owner.id);
    active();
    const reviewerCookie = await api!.cookie(reviewer.id);
    const original = { title: 'Original reviewed content', description: 'Fictional original content already shown to the reviewer.', department: 'CS', semester: 2, type: 'Research', techStack: ['TypeScript'], teamMembers: ['Fictional owner'], screenshots: [] };
    const replacement = { ...original, title: 'Owner replacement', description: 'Unreviewed owner replacement content.' };

    function request(path: string, method = 'GET', body?: unknown, cookie = '') {
      active();
      const result = fetch(api!.base + '/api' + path, {
        method, headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(10000)]),
      }).then(async response => ({ status: response.status, body: await response.json() }));
      pending.add(result);
      result.then(() => pending.delete(result), () => pending.delete(result));
      return result;
    }
    function command(kind: Command, id: string) {
      if (kind === 'edit') return request('/projects/' + id, 'PATCH', { ...replacement, expectedVersion: 0 }, ownerCookie);
      if (kind === 'delete') return request('/projects/' + id, 'DELETE', { expectedVersion: 0 }, ownerCookie);
      return request('/moderation/projects/' + id, 'PATCH', { status: 'APPROVED', expectedVersion: 0 }, reviewerCookie);
    }
    const schedules: [Command, Command][] = [
      ['edit', 'delete'], ['delete', 'edit'],
      ['approve', 'delete'], ['delete', 'approve'],
      ['edit', 'approve'], ['approve', 'edit'],
    ];
    for (const [paused, winner] of schedules) await t.test(`${paused} pauses after validation; ${winner} commits first`, async () => {
      active();
      const initial = await db.project.create({ data: { ...original, ownerId: owner.id, status: 'PENDING', views: 7 } });
      active();
      const gate = paused === 'approve'
        ? pauseOnce(applicationDb, '$transaction', operations => Array.isArray(operations))
        : pauseOnce(applicationDb.project, paused === 'edit' ? 'update' : 'delete', query => query.where.id === initial.id);
      gates.add(gate);
      const losing = command(paused, initial.id);
      try {
        await gate.wait(losing);
        // The independent connection proves the delayed command passed validation
        // without yet changing project content, version, or its audit history.
        assert.deepEqual(await db.project.findUniqueOrThrow({ where: { id: initial.id } }), initial);
        assert.equal(await db.audit.count({ where: { targetId: initial.id } }), 0);
        const won = await command(winner, initial.id);
        assert.equal(won.status, 200);
        if (winner === 'delete') assert.deepEqual(won.body, { ok: true });
        else assert.equal(won.body.version, 1);
        const committed = await db.project.findUnique({ where: { id: initial.id } });
        const committedAudits = await db.audit.findMany({ where: { targetId: initial.id } });
        gate.release();
        const lost = await losing;
        assert.equal(lost.status, 409);
        // This distinguishes a compare-and-swap failure from a stale-client
        // precheck. The loser had already accepted expectedVersion 0.
        assert.match(lost.body.message, /changed while/);
        assert.deepEqual(await db.project.findUnique({ where: { id: initial.id } }), committed);
        assert.deepEqual(await db.audit.findMany({ where: { targetId: initial.id } }), committedAudits);
        const publicRead = await request('/projects/' + initial.id);
        if (winner === 'delete') {
          assert.equal(committed, null, 'The losing command must not resurrect the deleted project');
          assert.equal(publicRead.status, 404);
        } else {
          assert(committed);
          assert.equal(committed.version, 1);
          assert.equal(committed.views, 7);
          assert.equal(committed.status, winner === 'approve' ? 'APPROVED' : 'DRAFT');
          assert.equal(committed.title, winner === 'approve' ? original.title : replacement.title);
          assert.equal(committed.description, winner === 'approve' ? original.description : replacement.description);
          assert.equal(publicRead.status, winner === 'approve' ? 200 : 404);
          if (winner === 'approve') assert.equal(publicRead.body.title, original.title);
        }
        assert.equal(committedAudits.length, winner === 'approve' ? 1 : 0);
        if (winner === 'approve') {
          assert.equal(committedAudits[0].actorId, reviewer.id);
          assert.equal(committedAudits[0].action, 'MODERATE_PROJECT');
          assert.equal(committedAudits[0].targetId, initial.id);
          assert.deepEqual(JSON.parse(committedAudits[0].details), { status: 'APPROVED', expectedVersion: 0 });
        }
      } finally {
        gate.release();
        await losing.catch(() => {});
        gate.restore();
        gates.delete(gate);
      }
    });
  } finally { await close(); }
});
