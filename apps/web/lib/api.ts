export type PublicProfile = {
  id: string;
  name: string;
  department: string;
  semester: number;
  bio?: string | null;
};

export type User = PublicProfile & {
  email: string;
  role: 'STUDENT' | 'FACULTY' | 'ADMIN';
};

export type ProjectStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED' | 'HIDDEN';

export type Project = {
  id: string;
  title: string;
  description: string;
  department: string;
  semester: number;
  type: string;
  techStack: string[];
  teamMembers: string[];
  githubUrl?: string | null;
  demoUrl?: string | null;
  screenshots: string[];
  status: ProjectStatus;
  feedback?: string | null;
  views: number;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
  owner: PublicProfile;
  likes: number;
  liked: boolean;
  bookmarked: boolean;
};

export type Listing = {items: Project[]; total: number; page: number; limit: number; pages: number};
export type Engagement = {liked: boolean; bookmarked: boolean; likes: number};

type ApiErrorCode = 'http' | 'network' | 'invalid_response';

export class ApiError extends Error {
  readonly status?: number;
  readonly code: ApiErrorCode;
  readonly retryAfter?: number;

  constructor(message: string, options: {status?: number; code?: ApiErrorCode; retryAfter?: number; cause?: unknown} = {}) {
    super(message, {cause: options.cause});
    this.name = 'ApiError';
    this.status = options.status;
    this.code = options.code ?? 'http';
    this.retryAfter = options.retryAfter;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function fallbackMessage(status: number): string {
  if (status === 401) return 'Your session has ended. Please sign in again.';
  if (status === 403) return 'You do not have permission to do that.';
  if (status === 404) return 'This item could not be found or is no longer available.';
  if (status === 413) return 'This upload is too large. Choose a smaller file.';
  if (status === 429) return 'Too many requests. Please wait a moment before trying again.';
  if (status >= 500) return 'ProjectHub is temporarily unavailable. Please try again shortly.';
  return `The request could not be completed (${status}). Please try again.`;
}

function errorMessage(data: unknown, status: number): string {
  if (!data || typeof data !== 'object' || !('message' in data)) return fallbackMessage(status);
  const message = data.message;
  if (typeof message === 'string' && message.trim()) return message;
  if (Array.isArray(message)) {
    const messages = message.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));
    if (messages.length) return messages.join('. ');
  }
  return fallbackMessage(status);
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('Accept', 'application/json');

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {...options, credentials: 'include', headers});
  } catch (error) {
    // Cancellation is a control-flow signal. Callers must be able to ignore it.
    if (isAbortError(error)) throw error;
    throw new ApiError('Could not connect to ProjectHub. Check your connection and try again.', {code: 'network', cause: error});
  }

  if (response.status === 204 && response.ok) return undefined as T;

  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (response.ok) {
      throw new ApiError('ProjectHub returned an unexpected response. Please try again.', {
        code: 'invalid_response', status: response.status, cause: error,
      });
    }
  }

  if (!response.ok) {
    const retryHeader = response.headers.get('Retry-After');
    const retrySeconds = retryHeader === null ? NaN : Number(retryHeader);
    throw new ApiError(errorMessage(data, response.status), {
      status: response.status,
      retryAfter: Number.isFinite(retrySeconds) && retrySeconds >= 0 ? retrySeconds : undefined,
    });
  }
  return data as T;
}

export const departments = ['Computer Science', 'Information Technology', 'Electronics', 'Mechanical Engineering', 'Civil Engineering', 'Environmental Engineering', 'Design', 'Business', 'Other'];
export const projectTypes = ['Web Application', 'Mobile Application', 'AI / Machine Learning', 'IoT / Hardware', 'Research', 'Design', 'Other'];
export const initials = (name: string) => name.split(' ').filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase();
export function mediaUrl(url: string) { return url; }
