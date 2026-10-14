import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pg', 'pdf-parse', 'mammoth', '@google-cloud/storage'],
  outputFileTracingIncludes: {
    '/*': ['node_modules/pdf-parse/lib/**/*'],
  },
};

export default nextConfig;
