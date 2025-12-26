import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ignore ESLint errors during production builds on Vercel
  eslint: { ignoreDuringBuilds: true },
  // Ignore TypeScript build errors on Vercel (we still lint locally)
  typescript: { ignoreBuildErrors: true },
  compiler: {
    // Remove console logs in production
    removeConsole: false,
  },
  experimental: {
    // Force use of forceSwcTransforms to handle large files
    forceSwcTransforms: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'tradewithsuli.com',
        pathname: '/wp-content/uploads/**',
      },
    ],
  },
};

export default nextConfig;
