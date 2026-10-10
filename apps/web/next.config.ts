import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: { cpus: 2 },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }];
  },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000'}/api/:path*` },
      { source: '/uploads/:path*', destination: `${process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000'}/uploads/:path*` },
    ];
  },
};
export default nextConfig;
