import type { Env } from "../env.ts";
import { apiPublicReads } from "../env.ts";
import type { WriteActor } from "../../shared/types.ts";
import { matchAgentBearerToken } from "./agent-tokens.ts";

const ACCESS_HOST_RE = /cloudflareaccess\.com/i;

export function accessBypassAllowed(env: Env): boolean {
  return env.ACCESS_BYPASS_DEV === "1" || env.ACCESS_BYPASS_DEV === "true";
}

/** Access JWT from Cf-Access-Jwt-Assertion or CF_Authorization cookie (Bypass Application paths). */
export function accessJwtTokenFromRequest(request: Request): string | null {
  const header = request.headers.get("Cf-Access-Jwt-Assertion");
  if (header?.trim()) return header.trim();
  return accessJwtFromCookieHeader(request.headers.get("Cookie"));
}

function accessJwtFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (name.toLowerCase() !== "cf_authorization") continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

export async function verifyAccessJwt(request: Request, env: Env): Promise<{ ok: true; email: string } | { ok: false }> {
  if (accessBypassAllowed(env)) {
    return { ok: true, email: "dev@local" };
  }
  const token = accessJwtTokenFromRequest(request);
  if (!token) return { ok: false };
  const team = env.ACCESS_TEAM_DOMAIN || "mzn1.cloudflareaccess.com";
  const allowedAud = parseAudList(accessAudiences(env));
  if (!allowedAud.length) return { ok: false };
  try {
    const payload = await validateCfAccessJwt(token, team, allowedAud);
    const email = typeof payload.email === "string" ? payload.email : "";
    if (!email) return { ok: false };
    return { ok: true, email };
  } catch {
    return { ok: false };
  }
}

/** ACCESS_AUD from Worker var (wrangler) or secret; vars are fine — AUD is not confidential. */
export function accessAudiences(env: Env): string | undefined {
  const v = env.ACCESS_AUD;
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function parseAudList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function validateCfAccessJwt(token: string, teamDomain: string, allowedAud: string[]): Promise<Record<string, unknown>> {
  const [headerB64, payloadB64, sigB64] = token.split(".");
  if (!headerB64 || !payloadB64 || !sigB64) throw new Error("jwt shape");
  const header = JSON.parse(decodeB64Url(headerB64)) as { alg?: string; kid?: string };
  if (header.alg !== "RS256") throw new Error("alg");
  const certsUrl = `https://${teamDomain}/cdn-cgi/access/certs`;
  const res = await fetch(certsUrl);
  if (!res.ok) throw new Error("certs");
  const certs = (await res.json()) as { keys?: { kid: string; kty: string; n: string; e: string }[] };
  const jwk = certs.keys?.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("kid");
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true, key_ops: ["verify"] },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sig = decodeB64UrlBytes(sigB64);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data);
  if (!valid) throw new Error("sig");
  const payload = JSON.parse(decodeB64Url(payloadB64)) as Record<string, unknown>;
  const payloadAud = payload.aud;
  const audiences = Array.isArray(payloadAud) ? payloadAud : [payloadAud];
  if (!allowedAud.some((a) => audiences.includes(a))) throw new Error("aud");
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now) throw new Error("exp");
  return payload;
}

function decodeB64Url(s: string): string {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return atob(b64);
}

function decodeB64UrlBytes(s: string): Uint8Array {
  const str = decodeB64Url(s);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

export async function authorizeRead(request: Request, env: Env): Promise<WriteActor | null> {
  if (apiPublicReads(env)) return { kind: "public", id: "public-read" };
  if (accessBypassAllowed(env)) return { kind: "dev", id: "dev@local" };

  const bearer = parseBearer(request.headers.get("Authorization"));
  if (bearer) {
    const agent = await matchAgentBearerToken(bearer, env);
    if (agent) return agent;
  }

  const jwt = await verifyAccessJwt(request, env);
  if (!jwt.ok) return null;
  const allow = parseWriteEmails(env);
  if (!allow.has(jwt.email.toLowerCase())) return null;
  return { kind: "access", id: jwt.email };
}

export async function authorizeWrite(request: Request, env: Env): Promise<WriteActor | null> {
  const bearer = parseBearer(request.headers.get("Authorization"));
  if (bearer) {
    const agent = await matchAgentBearerToken(bearer, env);
    if (agent) return agent;
  }
  const jwt = await verifyAccessJwt(request, env);
  if (!jwt.ok) return null;
  const allow = parseWriteEmails(env);
  if (!allow.has(jwt.email.toLowerCase())) return null;
  return { kind: "access", id: jwt.email };
}

function parseWriteEmails(env: Env): Set<string> {
  const raw = env.WRITE_EMAILS || "owner@example.com";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m ? m[1].trim() : null;
}

export function isAccessRedirect(response: Response): boolean {
  if (response.type === "opaqueredirect") return true;
  if (response.status >= 300 && response.status < 400 && ACCESS_HOST_RE.test(response.url || "")) return true;
  return false;
}