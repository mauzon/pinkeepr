#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { getPlatformProxy } from "wrangler";
import { accessJwtTokenFromRequest } from "../worker/auth/access.ts";
import { d1WranglerConfigPath } from "../scripts/lib/d1-wrangler-config.mjs";

{
  const req = new Request("http://x/", {
    headers: {
      Cookie: "other=1; CF_Authorization=eyJhbG.header.sig; lang=en",
    },
  });
  assert.equal(accessJwtTokenFromRequest(req), "eyJhbG.header.sig");
}

{
  const req = new Request("http://x/", {
    headers: {
      "Cf-Access-Jwt-Assertion": "from-header",
      Cookie: "CF_Authorization=from-cookie",
    },
  });
  assert.equal(accessJwtTokenFromRequest(req), "from-header");
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CITY = "london";
execSync("npm run d1:seed", { cwd: root, stdio: "pipe" });

const TEST_TOKEN = "read-test-agent-token";
const tokenHash = createHash("sha256").update(TEST_TOKEN).digest("hex");

const { env, dispose } = await getPlatformProxy({
  configPath: d1WranglerConfigPath(root),
});
delete env.ACCESS_BYPASS_DEV;
env.AGENT_TOKEN_HASHES = JSON.stringify({ "test-agent": tokenHash });

const worker = (await import("../worker/index.ts")).default;

async function invoke(pathname, init = {}) {
  const req = new Request(`http://localhost${pathname}`, init);
  return worker.fetch(req, env, { waitUntil: () => {}, passThroughOnException: () => {} });
}

{
  const res = await invoke(`/api/cities/${CITY}`);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, "Unauthorized");
}

{
  const res = await invoke(`/api/cities/${CITY}/version`);
  assert.equal(res.status, 401);
}

{
  const res = await invoke("/api/cities");
  assert.equal(res.status, 401);
}

{
  const res = await invoke(`/api/cities/${CITY}`, {
    headers: { Authorization: `Bearer ${TEST_TOKEN}` },
  });
  assert.equal(res.status, 200);
}

{
  const res = await invoke(`/api/cities/${CITY}`, {
    headers: { Cookie: "CF_Authorization=not.a.valid.jwt" },
  });
  assert.equal(res.status, 401);
}

env.API_PUBLIC_READS = "1";
{
  const res = await invoke(`/api/cities/${CITY}`);
  assert.equal(res.status, 200);
}

await dispose();
console.log("✓ api-read-auth tests");