#!/usr/bin/env node
/**
 * Generate an agent API token (printed once) and store its SHA-256 hash in wrangler.d1.jsonc.
 * Usage: npm run agent-token -- <agent-name>
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { d1WranglerConfigPath } from "./lib/d1-wrangler-config.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerPath = d1WranglerConfigPath(root);
const name = process.argv[2];
const KEY = "AGENT_TOKEN_HASHES";

if (!name || name.startsWith("-")) {
  console.error("Usage: npm run agent-token -- <agent-name>");
  process.exit(1);
}
if (!/^[a-z][a-z0-9-]{0,62}$/.test(name)) {
  console.error("Agent name must match ^[a-z][a-z0-9-]{0,62}$");
  process.exit(1);
}

const token = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");

let text = fs.readFileSync(wranglerPath, "utf8");
const keyRe = new RegExp(`"${KEY}"\\s*:\\s*"(?:\\\\.|[^"\\\\])*"`, "g");

function readHashes() {
  const m = text.match(keyRe);
  if (!m?.[0]) return {};
  const inner = m[0].match(/:\s*"(.*)"\s*$/s);
  if (!inner) return {};
  try {
    const unquoted = JSON.parse(`"${inner[1]}"`);
    return JSON.parse(unquoted);
  } catch {
    return {};
  }
}

const hashes = { ...readHashes(), [name]: hash };
const encoded = JSON.stringify(JSON.stringify(hashes));

if (keyRe.test(text)) {
  text = text.replace(keyRe, `"${KEY}": ${encoded}`);
} else {
  text = text.replace(
    /("WRITE_EMAILS"\s*:\s*"(?:\\.|[^"\\])*")(\s*\n)/,
    `$1,\n    "${KEY}": ${encoded}$2`,
  );
}

fs.writeFileSync(wranglerPath, text);
process.stdout.write(`${token}\n`);
console.error(`Updated ${KEY} for "${name}" in ${path.basename(wranglerPath)}.`);
console.error("Store the token privately. Only the hash is committed.");