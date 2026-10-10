import { ProjectStatus } from '@prisma/client';
import { queryEnum, queryKeys, queryPage } from './query-params';

export function parseProjectCollectionQuery(query: Record<string, unknown>, collection: 'workspace' | 'bookmarks' | 'moderation') {
  queryKeys(query, collection === 'bookmarks' ? ['page', 'limit'] : ['page', 'limit', 'status']);
  const pagination = queryPage(query, 24, 48);
  const status = collection === 'bookmarks'
    ? 'APPROVED'
    : queryEnum(query, 'status', Object.values(ProjectStatus), collection === 'moderation' ? 'PENDING' : undefined);
  return { ...pagination, status };
}
