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
  webpack: (config) => {
    // Wails generates TypeScript bindings that import each other with `.js`
    // specifiers. Resolve those to the actual `.ts` sources.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
