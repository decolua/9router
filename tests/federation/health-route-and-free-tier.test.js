// FED-GAP-04 — the two REAL application-route boundaries the dogfood run
// (DF-9ROUTER-15 B6 / DF-9ROUTER-20 C2+C5) could only show by hand, asserted
// from a fresh, network-free run:
//
//   1. `GET /api/health` — the tracked route module
//      (src/app/api/health/route.js), its 200 `{"ok":true}` body, its CORS
//      headers and its OPTIONS preflight. Nothing in tests/ imported that
//      module before this file, so the route's real body was asserted nowhere
//      and the dogfood's "the published package served health" rested on a
//      stub child (tests/unit/cli-port-resolution.test.js).
//   2. a completion for the app's credentialless FREE-TIER provider,
//      travelling the real `/v1/chat/completions` route (API-key gate →
//      free-tier virtual credential → provider selection → translation → SSE
//      with the terminal `[DONE]`), with only the provider's OUTBOUND
//      transport answered by tests/federation/free-tier-fixture.mjs.
//
// The free-tier model is not hardcoded: it is derived from the app's own
// catalog (category "free", noAuth, not vendor-client-only), so this file
// fails loudly if the classification changes.
//
// The integration-level copies of these checks (three instances, edge→central
// relay, degraded-edge serving, plus the mutation red-proof) live in
// tests/federation/e2e.mjs — run `npm run test:e2e`.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  FIXTURE_TEXT,
  joinDeltaContent,
  resolveFreeTierTarget,
  installFreeTierFixture,
} from "./free-tier-fixture.mjs";

// Native fetch, captured before any app module loads: the fixture must pass
// unrelated requests through to it (the app's own proxy layer adopts the
// fixture as its "inner" fetch — see installFreeTierFixture).
const NATIVE_FETCH = globalThis.fetch;

// ─── 1. the real health route ───────────────────────────────────────────

describe("real GET /api/health route (src/app/api/health/route.js)", () => {
  it("answers 200 with exactly {ok:true} and the module's CORS headers", async () => {
    // Imported as the app ships it — the REAL NextResponse, no next/server mock.
    const route = await import("../../src/app/api/health/route.js");
    const res = await route.GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    // Exact shape: the harness-only body this replaced carried
    // {ok, role, edgeId, state} and must fail here.
    expect(body).toEqual({ ok: true });
    expect(Object.keys(body)).toEqual(["ok"]);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers the OPTIONS preflight with 204 + CORS", async () => {
    const route = await import("../../src/app/api/health/route.js");
    const res = await route.OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
    expect(res.headers.get("access-control-allow-methods")).toContain("OPTIONS");
  });
});

// ─── 2. a real free-tier completion ─────────────────────────────────────

describe("real /v1/chat/completions free-tier completion (network-free)", () => {
  let tempDir;
  let savedDataDir;
  let fixture;
  let model;
  let providerId;
  let apiKey;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-fed04-"));
    savedDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tempDir;
    delete global._dbAdapter;

    const target = await resolveFreeTierTarget();
    model = target.model;
    providerId = target.providerId;
    fixture = installFreeTierFixture(target, { passthrough: NATIVE_FETCH });

    // A real API key: the route's gate is `settings.requireApiKey` (default
    // true), so the completion must present one to get past it.
    const { createApiKey } = await import("../../src/lib/db/repos/apiKeysRepo.js");
    apiKey = (await createApiKey("fed-gap-04", "fed-gap-04-machine")).key;
  }, 120000);

  afterAll(() => {
    try {
      fixture?.uninstall();
    } catch {
      /* noop */
    }
    try {
      global._dbAdapter?.instance?.close?.();
    } catch {}
    delete global._dbAdapter;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (savedDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = savedDataDir;
  });

  async function complete(token) {
    const route = await import("../../src/app/api/v1/chat/completions/route.js");
    const res = await route.POST(
      new Request("http://127.0.0.1/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ model, stream: true, messages: [{ role: "user", content: "dogfood-ok?" }] }),
      })
    );
    return { status: res.status, contentType: res.headers.get("content-type") || "", text: await res.text() };
  }

  it("derives the model from the app's credentialless free-tier catalog", async () => {
    const { FREE_PROVIDERS } = await import("../../src/shared/constants/providers.js");
    expect(FREE_PROVIDERS[providerId]?.noAuth).toBe(true);
    expect(FREE_PROVIDERS[providerId]?.requiresVendorClient).toBeUndefined();
    expect(model).toBe(`${FREE_PROVIDERS[providerId].alias}/${model.split("/")[1]}`);
  });

  it("streams the completion to a terminal [DONE] and drives the provider's transport", async () => {
    const res = await complete(apiKey);
    expect(res.status).toBe(200);
    expect(res.contentType).toContain("text/event-stream");
    const frames = res.text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice("data:".length).trim());
    expect(frames[frames.length - 1]).toBe("[DONE]");
    // Every frame survived the pipeline: the fixture splits its text across
    // two deltas, so the joined content is the whole string.
    expect(joinDeltaContent(res.text)).toBe(FIXTURE_TEXT);

    // The provider's own executor really ran: it bootstrapped a credential and
    // POSTed the translated body to the provider's declared chat endpoint, with
    // the anti-abuse system marker its transformRequest injects — all answered
    // locally, so nothing reached a live host.
    expect(fixture.state.bootstrapRequests).toBeGreaterThanOrEqual(1);
    expect(fixture.state.chatRequests).toBe(1);
    expect(fixture.state.offTargetBlocked).toBe(0);
    expect(fixture.state.lastChatRequest).toMatchObject({
      model: model.split("/")[1],
      stream: true,
      systemMessages: 1,
    });
  }, 120000);

  it("rejects an invalid API key (401) without touching the provider", async () => {
    const before = fixture.state.chatRequests;
    const res = await complete("sk-not-a-valid-key");
    expect(res.status).toBe(401);
    expect(res.text).toMatch(/invalid api key/i);
    expect(fixture.state.chatRequests).toBe(before);
  }, 120000);
});
