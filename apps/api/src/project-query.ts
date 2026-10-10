import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

function text(query: Record<string, unknown>, name: string, maxLength: number): string | undefined {
  const value = query[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new BadRequestException(`Invalid ${name} query parameter`);
  }
  return value.trim() || undefined;
}

function integer(query: Record<string, unknown>, name: string, max: number, fallback?: number): number {
  const raw = query[name];
  if (raw === undefined && fallback !== undefined) return fallback;
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) {
    throw new BadRequestException(`Invalid ${name}: use an integer from 1 to ${max}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > max) {
    throw new BadRequestException(`Invalid ${name}: use an integer from 1 to ${max}`);
  }
  return value;
}

export function parseProjectQuery(query: Record<string, unknown>) {
  const page = integer(query, 'page', 10000, 1);
  const limit = integer(query, 'limit', 48, 12);
  const search = text(query, 'q', 200);
  const department = text(query, 'department', 80);
  const type = text(query, 'type', 60);
  const technology = text(query, 'tech', 40);
  const sort = text(query, 'sort', 10) ?? 'recent';
  if (sort !== 'recent' && sort !== 'popular') {
    throw new BadRequestException('Invalid sort: use recent or popular');
  }

  const where: Prisma.ProjectWhereInput = { status: 'APPROVED' };
  if (search) where.OR = ['title', 'description'].map(field => ({ [field]: { contains: search, mode: 'insensitive' } }));
  if (department) where.department = department;
  if (query.semester !== undefined) where.semester = integer(query, 'semester', 12);
  if (type) where.type = type;
  if (technology) where.techStack = { has: technology };

  // Stable tie-breakers prevent duplicate or missing records between adjacent
  // offset pages when projects have equal timestamps or like counts.
  const orderBy: Prisma.ProjectOrderByWithRelationInput[] = sort === 'popular'
    ? [{ likes: { _count: 'desc' } }, { createdAt: 'desc' }, { id: 'desc' }]
    : [{ createdAt: 'desc' }, { id: 'desc' }];
  return { page, limit, where, orderBy };
}
