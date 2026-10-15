import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // This folder is the project root (silences the multiple-lockfiles warning).
  outputFileTracingRoot: __dirname,
  turbopack: { root: __dirname },
};

export default nextConfig;
