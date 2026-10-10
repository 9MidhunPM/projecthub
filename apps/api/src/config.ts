import { isIP } from 'node:net';

export function readApiConfig(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.NODE_ENV === 'production' && !environment.WEB_ORIGIN) {
    throw new Error('WEB_ORIGIN is required in production');
  }
  const origin = environment.WEB_ORIGIN || 'http://localhost:3000';
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error();
  } catch {
    throw new Error('WEB_ORIGIN must be an exact HTTP or HTTPS origin without a path, credentials, query, or fragment');
  }

  const rawPort = environment.PORT ?? '4000';
  const port = Number(rawPort);
  if (!/^[1-9]\d*$/.test(rawPort) || !Number.isInteger(port) || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }
  if (environment.COOKIE_SECURE !== undefined && !['true', 'false'].includes(environment.COOKIE_SECURE)) {
    throw new Error('COOKIE_SECURE must be true or false');
  }

  const trustedProxies = (environment.TRUST_PROXY_IPS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (trustedProxies.some(ip => !isIP(ip))) {
    throw new Error('TRUST_PROXY_IPS must contain explicit IP addresses');
  }
  return { origin, port, trustedProxies };
}
