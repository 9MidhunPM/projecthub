import { BadRequestException } from '@nestjs/common';

export function queryKeys(query: Record<string, unknown>, supported: string[]) {
  if (Object.keys(query).some(key => !supported.includes(key))) throw new BadRequestException('Unsupported query parameter');
}

export function queryText(query: Record<string, unknown>, name: string, maxLength: number): string | undefined {
  const value = query[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > maxLength) throw new BadRequestException(`Invalid ${name} query parameter`);
  return value.trim() || undefined;
}

export function queryInteger(query: Record<string, unknown>, name: string, max: number, fallback?: number): number {
  const raw = query[name];
  if (raw === undefined && fallback !== undefined) return fallback;
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) throw new BadRequestException(`Invalid ${name}: use an integer from 1 to ${max}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > max) throw new BadRequestException(`Invalid ${name}: use an integer from 1 to ${max}`);
  return value;
}

export function queryEnum<T extends string>(query: Record<string, unknown>, name: string, values: T[], fallback?: T): T | undefined {
  const value = queryText(query, name, Math.max(...values.map(item => item.length)));
  if (value === undefined) return fallback;
  if (!values.includes(value as T)) throw new BadRequestException(`Invalid ${name} query parameter`);
  return value as T;
}

export function queryPage(query: Record<string, unknown>, defaultLimit: number, maxLimit: number) {
  const page = queryInteger(query, 'page', 10000, 1);
  const limit = queryInteger(query, 'limit', maxLimit, defaultLimit);
  return { page, limit, skip: (page - 1) * limit };
}

export function pageResult<T>(items: T[], total: number, pagination: { page: number; limit: number }) {
  return { items, total, page: pagination.page, limit: pagination.limit, pages: Math.ceil(total / pagination.limit) };
}
