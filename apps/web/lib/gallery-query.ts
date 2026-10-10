export type GalleryQuery = {
  q: string;
  department: string;
  semester: string;
  type: string;
  tech: string;
  sort: 'recent' | 'popular';
  page: number;
};

export const defaultGalleryQuery: GalleryQuery = {
  q: '', department: '', semester: '', type: '', tech: '', sort: 'recent', page: 1,
};

function positiveInteger(value: string | null, maximum: number): number | undefined {
  if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= maximum ? number : undefined;
}

export function parseGalleryQuery(search: string): GalleryQuery {
  const params = new URLSearchParams(search);
  const semester = positiveInteger(params.get('semester'), 12);
  return {
    q: (params.get('q') ?? '').trim().slice(0, 200),
    department: (params.get('department') ?? '').trim().slice(0, 80),
    semester: semester ? String(semester) : '',
    type: (params.get('type') ?? '').trim().slice(0, 60),
    tech: (params.get('tech') ?? '').trim().slice(0, 40),
    sort: params.get('sort') === 'popular' ? 'popular' : 'recent',
    page: positiveInteger(params.get('page'), 10000) ?? 1,
  };
}

export function serializeGalleryQuery(query: GalleryQuery): string {
  const params = new URLSearchParams();
  for (const key of ['q', 'department', 'semester', 'type', 'tech'] as const) {
    const value = query[key].trim();
    if (value) params.set(key, value);
  }
  if (query.sort !== 'recent') params.set('sort', query.sort);
  if (query.page > 1) params.set('page', String(query.page));
  return params.toString();
}

export function galleryHref(query: GalleryQuery): string {
  const search = serializeGalleryQuery(query);
  return search ? `/?${search}` : '/';
}

export function hasGalleryFilters(query: GalleryQuery): boolean {
  return Boolean(query.q.trim() || query.department || query.semester || query.type || query.tech.trim());
}
