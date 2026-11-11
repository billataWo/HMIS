import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import type { NextConfig } from "next";

/**
 * `next dev` only serves its scripts to localhost. Allow this machine's own network addresses too,
 * so the app also works when opened as http://<this-pc's-ip>:3000 (from this PC or a tablet on the
 * clinic network). Extra hostnames can be added with DEV_ORIGINS="host1,host2". Dev server only.
 */
const devOrigins = [
  ...Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => a!.address),
  ...(process.env.DEV_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
];

const production = process.env.NODE_ENV === "production";

/**
 * Content Security Policy. In production: scripts, styles, connections and frames only from this
 * site, so an injected script could neither load code from elsewhere nor send patient data to
 * another server, and no other site can show HMIS inside a frame (clickjacking). Inline scripts
 * stay allowed: Next.js uses them to start the page. Development needs eval and a websocket for
 * hot reloading, so it gets only the frame and plugin rules.
 */
const csp = production
  ? [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "worker-src 'self'",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ")
  : "object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" }, // older browsers: no framing
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" }, // patient ids in URLs never leave the site
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  // Browsers ignore this over plain HTTP; over HTTPS it keeps them on HTTPS for a year.
  ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
];

const nextConfig: NextConfig = {
  // Don't advertise the server software.
  poweredByHeader: false,
  // Lets a verification build run beside a running `next dev` without fighting over .next.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // The server image (deploy/app/Dockerfile): a self-contained server with only the files it needs.
  ...(process.env.NEXT_STANDALONE === "1" && {
    output: "standalone" as const,
    outputFileTracingRoot: resolve(process.cwd(), "../.."),
  }),
  allowedDevOrigins: devOrigins,
  cacheComponents: true,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The voice studio records from the microphone; everywhere else it stays off.
      {
        source: "/platform/voice",
        headers: [{ key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()" }],
      },
      // The service worker must always be fetched fresh, so a new version takes over straight away.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
