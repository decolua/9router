/**
 * Live repro for issue #1933: MiMo Code Free returns HTTP 502 "MiMo bootstrap failed: 403".
 * Root cause: upstream gates on Chrome-like User-Agent. Without UA → 403 "Illegal access".
 * Hits real endpoints — no mocks. Free provider, safe to call.
 *
 * POLICY — LIVE PROBE, OPT-IN, NOT BASELINED:
 *  - This file is a LIVE probe against third-party endpoints (the issue #1933 repro):
 *    every test calls the real MiMo bootstrap/chat URLs through proxyAwareFetch, so
 *    its outcome depends on upstream availability and upstream UA/anti-abuse behaviour.
 *  - It is OPT-IN via `RUN_REAL=1`, the repo-wide convention for live tests
 *    (see tests/translator/real/*.real.test.js). A default `vitest run` SKIPS it
 *    instead of treating a live endpoint as a deterministic test.
 *      RUN_REAL=1 npx vitest run unit/mimo-free.live.test.js
 *  - It is deliberately ABSENT from tests/__baseline__/known-fails.txt: the
 *    deterministic regression gate must not absorb live-endpoint behaviour. A failure
 *    here is a live signal (upstream or UA/anti-abuse gate changed), not a known
 *    regression of this repo.
 */
import { describe, it, expect } from "vitest";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { __test__ } from "../../open-sse/executors/mimo-free.js";

const { BOOTSTRAP_URL, CHAT_URL, generateFingerprint, MIMO_SYSTEM_MARKER } = __test__;

// Opt-in gate: no RUN_REAL → skip (never fail, never hit the network).
const RUN_REAL = process.env.RUN_REAL === "1";

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function bootstrapWith(ua) {
  const headers = { "Content-Type": "application/json" };
  if (ua) headers["User-Agent"] = ua;
  const r = await proxyAwareFetch(BOOTSTRAP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ client: generateFingerprint() }),
  });
  const data = await r.json();
  return { status: r.status, jwt: data.jwt };
}

async function chatWith(jwt, ua) {
  const headers = {
    "Content-Type": "application/json",
    "X-Mimo-Source": "mimocode-cli-free",
    Authorization: `Bearer ${jwt}`,
    Accept: "application/json",
  };
  if (ua) headers["User-Agent"] = ua;
  const body = {
    model: "mimo-auto",
    messages: [
      { role: "system", content: MIMO_SYSTEM_MARKER },
      { role: "user", content: "hi" },
    ],
    stream: false,
  };
  return proxyAwareFetch(CHAT_URL, { method: "POST", headers, body: JSON.stringify(body) });
}

describe.skipIf(!RUN_REAL)("MiMo Free bootstrap (live)", () => {
  it("bootstrap returns 200 with JWT", async () => {
    const { status, jwt } = await bootstrapWith(CHROME_UA);
    expect(status).toBe(200);
    expect(jwt).toBeTruthy();
  });
});

describe.skipIf(!RUN_REAL)("MiMo Free anti-abuse gate (live)", () => {
  it("chat WITH Chrome User-Agent → 200", async () => {
    const { jwt } = await bootstrapWith(CHROME_UA);
    const r = await chatWith(jwt, CHROME_UA);
    expect(r.status).toBe(200);
  });
});
