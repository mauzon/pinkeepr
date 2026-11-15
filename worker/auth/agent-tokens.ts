import type { Env } from "../env.ts";
import type { WriteActor } from "../../shared/types.ts";

/** Merge plain-var hashes with optional AGENT_TOKENS secret (secret entries override). */
export function agentTokenHashMap(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  mergeJsonVar(env.AGENT_TOKEN_HASHES, out);
  mergeJsonVar(env.AGENT_TOKENS, out);
  return out;
}

function mergeJsonVar(raw: string | undefined, out: Record<string, string>): void {
  if (!raw?.trim()) return;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [name, hash] of Object.entries(parsed)) {
      if (typeof hash === "string" && /^[a-f0-9]{64}$/i.test(hash)) {
        out[name] = hash.toLowerCase();
      }
    }
  } catch {
    /* ignore malformed */
  }
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export async function matchAgentBearerToken(token: string, env: Env): Promise<WriteActor | null> {
  const map = agentTokenHashMap(env);
  if (!Object.keys(map).length) return null;
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hashHex = [...new Uint8Array(hashBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  for (const [name, expected] of Object.entries(map)) {
    if (constantTimeEqualHex(expected, hashHex)) return { kind: "agent", id: name };
  }
  return null;
}