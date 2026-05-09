// next.config.mjs
import baseConfig from './base.config.mjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...baseConfig,
  distDir: "app/.next",  // Bổ sung thư mục output
};

export default nextConfig;
