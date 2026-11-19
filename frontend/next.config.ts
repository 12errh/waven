import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // The desktop shell serves the exported files from the app root, so no
  // server-side image optimization or Next.js server is available.
  images: {
    unoptimized: true,
  },
  output: 'export',
  trailingSlash: true,
  transpilePackages: ['motion'],
};

export default nextConfig;
