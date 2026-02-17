import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: false,
  reactCompiler: true,
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/art/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=3600',
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/join/:gameCode',
        destination: '/join?code=:gameCode',
      },
      {
        source: '/watch/:gameCode',
        destination: '/watch?code=:gameCode',
      },
    ];
  },
};

export default nextConfig;
