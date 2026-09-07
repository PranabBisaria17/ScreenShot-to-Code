import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp ships native binaries per-platform. Left to the default bundler,
  // Vercel's serverless functions can fail to find the right one at runtime
  // (works locally, breaks in production). This tells Next.js to leave sharp
  // as a plain Node `require` instead of bundling it, which is the
  // Vercel/Next.js-recommended fix for native-addon dependencies.
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
