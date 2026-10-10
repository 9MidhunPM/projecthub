export type CollectionQuery = {page: number; status: string; q: string; role: string};
export type CollectionQueryOptions = {statuses?: readonly string[]; defaultStatus?: string; people?: boolean};

export function parseCollectionQuery(search: string, options: CollectionQueryOptions = {}): CollectionQuery {
  const params = new URLSearchParams(search);
  const rawPage = params.get('page') ?? '1';
  const page = /^[1-9]\d*$/.test(rawPage) && Number(rawPage) <= 10000 ? Number(rawPage) : 1;
  const status = params.get('status') ?? options.defaultStatus ?? '';
  const role = params.get('role') ?? '';
  return {
    page,
    status: options.statuses?.includes(status) ? status : options.defaultStatus ?? '',
    q: options.people ? (params.get('q') ?? '').trim().slice(0, 254) : '',
    role: options.people && ['STUDENT', 'FACULTY', 'ADMIN'].includes(role) ? role : '',
  };
}

export function serializeCollectionQuery(query: CollectionQuery, options: CollectionQueryOptions = {}): string {
  const params = new URLSearchParams();
  if (query.page > 1) params.set('page', String(query.page));
  if (query.status && query.status !== options.defaultStatus) params.set('status', query.status);
  if (options.people && query.q.trim()) params.set('q', query.q.trim());
  if (options.people && query.role) params.set('role', query.role);
  return params.toString();
}
