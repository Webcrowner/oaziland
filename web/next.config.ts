import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  // Blocks framing by other sites, plugins and injected <base> tags. A full script-src policy is not set because the
  // pages rely on inline scripts; add one with nonces if stricter XSS protection is needed.
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'" },
];

const nextConfig: NextConfig = {
  // WHY this is needed for Docker specifically: without it, a
  // production Next.js build still expects the full node_modules
  // folder to run — "standalone" instead produces a small, self-
  // contained server folder with only the files actually needed at
  // runtime, which is exactly what a lean Docker image wants.
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
