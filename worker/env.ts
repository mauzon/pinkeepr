import type { D1Database } from "../shared/d1-types.ts";

type Fetcher = { fetch: (request: Request) => Promise<Response> };

export interface Env {
  /** Present only in Cloudflare + D1 mode; omit for static-assets-only forks. */
  DB?: D1Database;
  ASSETS: Fetcher;
  ACCESS_AUD?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_BYPASS_DEV?: string;
  WRITE_EMAILS?: string;
  /** Optional secret override; same JSON shape as AGENT_TOKEN_HASHES. */
  AGENT_TOKENS?: string;
  /** Plain-var JSON map: agent name → sha256(token) hex (forks / CI friendly). */
  AGENT_TOKEN_HASHES?: string;
  PLACE_STORE?: string;
  /** When "true", GET /api/* skips auth (forks only). Default: protected reads. */
  API_PUBLIC_READS?: string;
}

export function isD1ApiEnabled(env: Env): boolean {
  return env.DB != null;
}

export function apiPublicReads(env: Env): boolean {
  return env.API_PUBLIC_READS === "1" || env.API_PUBLIC_READS === "true";
}