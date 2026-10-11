import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { queryInteger, queryKeys, queryPage, queryText } from './query-params';

export function parseProjectQuery(query: Record<string, unknown>) {
  queryKeys(query, ['q', 'department', 'semester', 'type', 'tech', 'page', 'limit', 'sort']);
  const { page, limit } = queryPage(query, 12, 48);
  const search = queryText(query, 'q', 200);
  const department = queryText(query, 'department', 80);
  const type = queryText(query, 'type', 60);
  const technology = queryText(query, 'tech', 40);
  const sort = queryText(query, 'sort', 10) ?? 'recent';
  if (sort !== 'recent' && sort !== 'popular') {
    throw new BadRequestException('Invalid sort: use recent or popular');
  }

  const where: Prisma.ProjectWhereInput = { status: 'APPROVED' };
  if (search) where.OR = ['title', 'description'].map(field => ({ [field]: { contains: search, mode: 'insensitive' } }));
  if (department) where.department = department;
  if (query.semester !== undefined) where.semester = queryInteger(query, 'semester', 12);
  if (type) where.type = type;
  if (technology) where.techStack = { has: technology };

  // Stable tie-breakers prevent duplicate or missing records between adjacent
  // offset pages when projects have equal timestamps or like counts.
  const orderBy: Prisma.ProjectOrderByWithRelationInput[] = sort === 'popular'
    ? [{ likes: { _count: 'desc' } }, { createdAt: 'desc' }, { id: 'desc' }]
    : [{ createdAt: 'desc' }, { id: 'desc' }];
  return { page, limit, where, orderBy };
}
