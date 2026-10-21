import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  output: "standalone",
  // Next.js 16.3+ can resolve @swc/helpers' module-sync exports to ESM
  // at runtime on Node 22.12+/24, although standalone tracing omits esm/.
  outputFileTracingIncludes: {
    "*": ["./node_modules/@swc/helpers/esm/**"],
  },
};

export default nextConfig;
