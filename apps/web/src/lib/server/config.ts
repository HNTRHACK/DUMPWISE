import "server-only";
import { z } from "zod";

// Server-only configuration. None of these values reach the browser bundle: the
// "server-only" import makes the build fail if a Client Component ever imports this file,
// and no variable uses the NEXT_PUBLIC_ prefix.
const schema = z.object({
  DUMPWISE_API_URL: z.url().default("http://127.0.0.1:3001"),
  // Set to "true" when the site is served over HTTPS (forced on in production builds).
  DUMPWISE_COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  // Public origin of this web app, e.g. https://app.example.com. Optional in development;
  // used for the CSRF Origin check when a reverse proxy rewrites the Host header.
  DUMPWISE_APP_ORIGIN: z.url().optional(),
  // "true" ONLY when a trusted reverse proxy in front of Next.js overwrites X-Forwarded-For.
  // Default: client-supplied X-Forwarded-For is never forwarded to the API.
  DUMPWISE_TRUST_PROXY_HEADER: z.enum(["true", "false"]).default("false"),
});

const env = schema.parse({
  DUMPWISE_API_URL: process.env.DUMPWISE_API_URL || undefined,
  DUMPWISE_COOKIE_SECURE: process.env.DUMPWISE_COOKIE_SECURE || undefined,
  DUMPWISE_APP_ORIGIN: process.env.DUMPWISE_APP_ORIGIN || undefined,
  DUMPWISE_TRUST_PROXY_HEADER: process.env.DUMPWISE_TRUST_PROXY_HEADER || undefined,
});

export const serverConfig = {
  apiBaseUrl: env.DUMPWISE_API_URL.replace(/\/+$/, ""),
  cookieSecure: env.DUMPWISE_COOKIE_SECURE ? env.DUMPWISE_COOKIE_SECURE === "true" : process.env.NODE_ENV === "production",
  appHost: env.DUMPWISE_APP_ORIGIN ? new URL(env.DUMPWISE_APP_ORIGIN).host : null,
  trustProxyHeader: env.DUMPWISE_TRUST_PROXY_HEADER === "true",
  timeoutMs: 15_000,
  uploadTimeoutMs: 180_000,
  /** 20 MiB CSV + 1 MiB control totals + multipart overhead. The API enforces its own limits. */
  maxUploadBytes: 22 * 1024 * 1024,
  maxJsonBytes: 64 * 1024,
};
