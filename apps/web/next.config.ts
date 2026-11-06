import { networkInterfaces } from "node:os";
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

const nextConfig: NextConfig = {
  // Lets a verification build run beside a running `next dev` without fighting over .next.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  allowedDevOrigins: devOrigins,
  cacheComponents: true,
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
