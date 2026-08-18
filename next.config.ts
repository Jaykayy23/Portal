import type { NextConfig } from 'next';

// `output: 'standalone'` produces a self-contained .next/standalone/server.js for
// a small Docker image — but it also makes `next start` refuse to run, which is
// how the plain-Node deployment path works. So it is opt-in: the Dockerfile sets
// BUILD_STANDALONE=1, and everything else gets a normal build.
const standalone = process.env.BUILD_STANDALONE === '1';

const nextConfig: NextConfig = {
  ...(standalone ? { output: 'standalone' as const } : {}),
};

export default nextConfig;
