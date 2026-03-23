/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow reading files from parent directory
  experimental: {
    serverActions: {
      bodySizeLimit: '25mb',
    },
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
  // Disable strict mode for development
  reactStrictMode: false,
};

export default nextConfig;
