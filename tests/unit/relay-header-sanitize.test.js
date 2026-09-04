// Relay anonymity contract: every relay target (Vercel / Cloudflare / Deno)
// must strip client-IP and proxy-identifying headers before forwarding.
// Otherwise per-IP upstream limits (OpenCode free-tier HTTP 429
// FreeUsageLimitError) survive relaying — only Vercel worked, because its
// edge strips X-Forwarded-For on outbound fetch at the platform layer.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import {
  RELAY_STRIP_EXACT,
  RELAY_STRIP_PREFIXES,
  sanitizeRelayHeaders,
  buildRelaySanitizeSnippet,
} from "../../src/lib/network/relayHeaders.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readSource = (rel) => readFileSync(path.join(repoRoot, rel), "utf8");

describe("relay header strip lists", () => {
  it("covers the client-IP headers that defeat IP rotation", () => {
    for (const name of [
      "x-relay-target",
      "x-relay-path",
      "host",
      "x-forwarded-for",
      "forwarded",
      "via",
      "x-real-ip",
      "true-client-ip",
      "cdn-loop",
      "cf-connecting-ip",
      "cf-ray",
      "connection",
      "transfer-encoding",
    ]) {
      expect(RELAY_STRIP_EXACT, name).toContain(name);
    }
  });

  it("covers platform header families by prefix", () => {
    for (const prefix of ["cf-", "x-vercel-", "x-deno-", "x-forwarded-"]) {
      expect(RELAY_STRIP_PREFIXES, prefix).toContain(prefix);
    }
  });
});

describe("sanitizeRelayHeaders", () => {
  it("strips leak/hop-by-hop headers but preserves upstream request headers", () => {
    const headers = {
      "user-agent": "opencode",
      Authorization: "Bearer public",
      "Content-Type": "application/json",
      "x-opencode-session": "ses_abc",
      "x-opencode-request": "msg_abc",
      "x-opencode-client": "desktop",
      Accept: "text/event-stream",
      "x-forwarded-for": "203.0.113.7",
      "X-Real-IP": "203.0.113.7",
      "cf-connecting-ip": "203.0.113.7",
      "cdn-loop": "cloudflare",
      "x-vercel-id": "iad1::abc",
      "x-deno-region": "us-east",
      connection: "keep-alive",
      host: "relay.example.com",
      "x-relay-target": "https://opencode.ai",
      "x-relay-path": "/zen/v1/responses",
    };
    sanitizeRelayHeaders(headers);
    expect(headers).toMatchObject({
      "user-agent": "opencode",
      Authorization: "Bearer public",
      "Content-Type": "application/json",
      "x-opencode-session": "ses_abc",
      "x-opencode-request": "msg_abc",
      "x-opencode-client": "desktop",
      Accept: "text/event-stream",
    });
    for (const name of Object.keys(headers)) {
      expect(name.toLowerCase().startsWith("x-forwarded-")).toBe(false);
      expect(name.toLowerCase().startsWith("cf-")).toBe(false);
      expect(name.toLowerCase().startsWith("x-vercel-")).toBe(false);
    }
    expect("x-forwarded-for" in headers).toBe(false);
    expect("host" in headers).toBe(false);
    expect("x-relay-target" in headers).toBe(false);
  });
});

describe("deployed relay templates", () => {
  const routes = [
    "src/app/api/proxy-pools/vercel-deploy/route.js",
    "src/app/api/proxy-pools/cloudflare-deploy/route.js",
    "src/app/api/proxy-pools/deno-deploy/route.js",
  ];

  it("all three embed the shared sanitize snippet", () => {
    for (const rel of routes) {
      const source = readSource(rel);
      expect(source, `${rel} imports snippet`).toContain("buildRelaySanitizeSnippet");
      expect(source, `${rel} calls sanitize`).toContain("sanitizeRelayHeaders(");
    }
    const cf = readSource(routes[1]);
    expect(cf).toContain("sanitizeRelayHeaders(forwardHeaders)");
    const deno = readSource(routes[2]);
    expect(deno).toContain("sanitizeRelayHeaders(newHeaders)");
    const vercel = readSource(routes[0]);
    expect(vercel).toContain("sanitizeRelayHeaders(headers)");
  });

  it("snippet is syntactically valid and strips like the module", () => {
    const snippet = buildRelaySanitizeSnippet();
    const sandbox = vm.runInNewContext(
      `${snippet}; const __h = new Headers({
        "user-agent": "opencode",
        "x-opencode-session": "ses_abc",
        "x-forwarded-for": "203.0.113.7",
        "cf-connecting-ip": "203.0.113.7",
        "x-vercel-id": "iad1::abc",
        "host": "relay.example.com",
        "x-relay-target": "https://opencode.ai"
      }); sanitizeRelayHeaders(__h); __h;`,
      { Headers }
    );
    const out = Object.fromEntries(sandbox.entries());
    expect(out).toMatchObject({ "user-agent": "opencode", "x-opencode-session": "ses_abc" });
    expect("x-forwarded-for" in out).toBe(false);
    expect("host" in out).toBe(false);
  });
});
