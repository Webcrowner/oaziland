import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // WHY this is needed for Docker specifically: without it, a
  // production Next.js build still expects the full node_modules
  // folder to run — "standalone" instead produces a small, self-
  // contained server folder with only the files actually needed at
  // runtime, which is exactly what a lean Docker image wants.
  output: "standalone",
};

export default withNextIntl(nextConfig);
