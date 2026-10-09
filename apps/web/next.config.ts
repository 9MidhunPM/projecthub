import type { NextConfig } from 'next';
const nextConfig: NextConfig = { experimental: { cpus: 2 }, async rewrites() { return [{ source: '/api/:path*', destination: `${process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000'}/api/:path*` },{ source: '/uploads/:path*', destination: `${process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000'}/uploads/:path*` }]; } };
export default nextConfig;
