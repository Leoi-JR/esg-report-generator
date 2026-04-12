/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow reading files from parent directory
  experimental: {
    serverActions: {
      bodySizeLimit: '3300mb',
    },
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
  // Disable strict mode for development
  reactStrictMode: false,
};

export default nextConfig;
