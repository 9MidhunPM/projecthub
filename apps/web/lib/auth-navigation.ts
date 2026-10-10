const DEFAULT_DESTINATION = '/workspace';
const LOCAL_ORIGIN = 'https://projecthub.invalid';

/** Accept app-local return paths without allowing browser URL normalization to escape. */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value) || /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)) {
    return DEFAULT_DESTINATION;
  }
  try {
    const url = new URL(value, LOCAL_ORIGIN);
    // URL normalization can turn dot segments into a leading double slash.
    // Re-check the returned pathname, not only the original input and origin.
    if (url.origin !== LOCAL_ORIGIN || url.pathname.startsWith('//') || ['/login', '/signup'].includes(url.pathname)) return DEFAULT_DESTINATION;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_DESTINATION;
  }
}

export function authHref(signup: boolean, destination: string): string {
  return `${signup ? '/signup' : '/login'}?${new URLSearchParams({next: safeReturnPath(destination)})}`;
}
