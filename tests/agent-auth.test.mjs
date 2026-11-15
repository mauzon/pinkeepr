#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { agentTokenHashMap, constantTimeEqualHex, matchAgentBearerToken } from "../worker/auth/agent-tokens.ts";

const good = "correct-agent-token-value";
const goodHash = createHash("sha256").update(good).digest("hex");
const wrong = "wrong-token";

{
  assert.equal(constantTimeEqualHex(goodHash, goodHash), true);
  assert.equal(constantTimeEqualHex(goodHash, goodHash.toUpperCase()), true);
  assert.equal(constantTimeEqualHex(goodHash, createHash("sha256").update(wrong).digest("hex")), false);
}

{
  const env = {
    AGENT_TOKEN_HASHES: JSON.stringify({ "test-agent": goodHash }),
  };
  const map = agentTokenHashMap(env);
  assert.equal(map["test-agent"], goodHash);
  const ok = await matchAgentBearerToken(good, env);
  assert.ok(ok);
  assert.equal(ok.id, "test-agent");
  const bad = await matchAgentBearerToken(wrong, env);
  assert.equal(bad, null);
}

{
  const env = {
    AGENT_TOKEN_HASHES: JSON.stringify({ a: goodHash }),
    AGENT_TOKENS: JSON.stringify({ a: "0000000000000000000000000000000000000000000000000000000000000000" }),
  };
  assert.equal(agentTokenHashMap(env).a, "0000000000000000000000000000000000000000000000000000000000000000");
}

console.log("✓ agent-auth tests");