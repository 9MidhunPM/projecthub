import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient, Role } from '@prisma/client';
import { userSelect } from './auth';

export async function changeUserRole(db: Pick<PrismaClient, '$transaction'>, actorId: string, targetId: string, role: Role) {
  if (actorId === targetId) throw new BadRequestException('You cannot change your own administrator role');
  return db.$transaction(async tx => {
    // Every API role change uses this application-specific transaction lock.
    // Waiting requests must inspect fresh roles after the prior change commits.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1346917698, 1)`;
    const users = await tx.$queryRaw<{ id: string; role: Role }[]>`
      SELECT id,role FROM "User" WHERE id IN (${actorId},${targetId}) ORDER BY id FOR UPDATE
    `;
    const actor = users.find(user => user.id === actorId);
    if (!actor || actor.role !== 'ADMIN') throw new ForbiddenException('Administrator access required');
    const target = users.find(user => user.id === targetId);
    if (!target) throw new NotFoundException('User not found');
    if (target.role === 'ADMIN' && role !== 'ADMIN' && await tx.user.count({ where: { role: 'ADMIN' } }) <= 1) {
      throw new ConflictException('The last administrator cannot be demoted');
    }
    const user = await tx.user.update({ where: { id: targetId }, data: { role }, select: userSelect });
    await tx.audit.create({ data: { actorId, action: 'CHANGE_ROLE', targetId, details: JSON.stringify({ role }) } });
    return user;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
