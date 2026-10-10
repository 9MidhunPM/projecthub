import { Prisma, ProjectStatus, Role } from '@prisma/client';
import { queryEnum, queryKeys, queryPage, queryText } from './query-params';

export function parseProjectCollectionQuery(query: Record<string, unknown>, collection: 'workspace' | 'bookmarks' | 'moderation') {
  queryKeys(query, collection === 'bookmarks' ? ['page', 'limit'] : ['page', 'limit', 'status']);
  const pagination = queryPage(query, 24, 48);
  const status = collection === 'bookmarks'
    ? 'APPROVED'
    : queryEnum(query, 'status', Object.values(ProjectStatus), collection === 'moderation' ? 'PENDING' : undefined);
  return { ...pagination, status };
}

export function parseUserCollectionQuery(query: Record<string, unknown>) {
  queryKeys(query, ['page', 'limit', 'q', 'role']);
  const pagination = queryPage(query, 50, 100);
  const search = queryText(query, 'q', 254);
  const role = queryEnum(query, 'role', Object.values(Role));
  const where: Prisma.UserWhereInput = {};
  if (role) where.role = role;
  if (search) {
    // Prisma contains uses SQL LIKE patterns: search ordinary text literally,
    // including percent, underscore and backslash characters in names/emails.
    const literal = search.replace(/[\\%_]/g, '\\$&');
    where.OR = [{ name: { contains: literal, mode: 'insensitive' } }, { email: { contains: literal, mode: 'insensitive' } }];
  }
  return { ...pagination, where };
}

export function parseAuditCollectionQuery(query: Record<string, unknown>) {
  queryKeys(query, ['page', 'limit']);
  return queryPage(query, 50, 100);
}
