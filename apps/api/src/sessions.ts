import { UnauthorizedException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { digest } from './security';

export const SESSION_LIFETIME_MS = 7 * 86400000;
export const MAX_USER_SESSIONS = 10;

export async function createSession(db: Pick<PrismaClient, '$transaction'>, userId: string) {
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
  await db.$transaction(async tx => {
    // Serialize issuance for this user so parallel logins cannot exceed the
    // session cap. This lock is released with the transaction, not process-local.
    const users = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    if (!users.length) throw new UnauthorizedException('Account no longer exists');
    await tx.session.deleteMany({ where: { userId, expiresAt: { lte: now } } });
    const overflow = await tx.session.findMany({
      where: { userId }, orderBy: [{ expiresAt: 'desc' }, { id: 'desc' }],
      skip: MAX_USER_SESSIONS - 1, select: { id: true },
    });
    if (overflow.length) await tx.session.deleteMany({ where: { userId, id: { in: overflow.map(session => session.id) } } });
    await tx.session.create({ data: { id: digest(token), userId, expiresAt } });
  });
  return { token, expiresAt };
}
