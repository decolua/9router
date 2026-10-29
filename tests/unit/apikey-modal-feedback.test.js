import { describe, it, expect, vi } from "vitest";

// DF-9ROUTER-41 — dashboard API-key feedback frictions from the first full
// UI-driven pass (780x493 bootstrap):
//
//   1. Add-key modal 'Check' gave no visible outcome — the only state was a
//      transient "Checking..." label; nothing rendered valid/invalid, so users
//      re-clicked (double-submit). The check flow must resolve to a renderable
//      per-check result state (valid/invalid + message).
//   2. Create-key (POST /api/keys) had no in-flight guard — a double-click
//      created duplicate keys. The guard must make rapid re-entry a no-op
//      network-wise (exactly ONE POST) and must reset in finally so a failure
//      does not wedge the button.
//
// tests/ has no jsdom/RTL (see status-view.test.js for the precedent), so the
// fetch-driven flows live in src/shared/utils/keyFeedback.js and the components
// (AddApiKeyModal, ConnectionsCard's modal, EndpointPageClient's create modal)
// delegate to them. These tests exercise the REAL module — the same code the
// UI runs — with a mocked fetch, plus a source-contract check that the
// components actually wire the mechanism (guard via useRef, feedback state),
// so a regression that unwires the UI still fails here.
import { runKeyCheck, submitCreateKey } from "../../src/shared/utils/keyFeedback.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = resolve(__dirname, "../../src");

function okFetch(body) {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
}

describe("runKeyCheck — check flow resolves to a renderable result state", () => {
  it("valid key → status 'valid' with a message (renders ✓ Valid, ends Checking)", async () => {
    const fetchImpl = okFetch({ valid: true, error: null });
    const result = await runKeyCheck({ provider: "openai", apiKey: "sk-test", fetchImpl });
    expect(result.status).toBe("valid");
    expect(typeof result.message).toBe("string");
    expect(result.message.length).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/providers/validate");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      provider: "openai",
      apiKey: "sk-test",
      providerSpecificData: undefined,
    });
  });

  it("invalid key → status 'invalid' with the API's error message (renders ✗ <error>)", async () => {
    const fetchImpl = okFetch({ valid: false, error: "Invalid API key" });
    const result = await runKeyCheck({ provider: "openai", apiKey: "sk-bad", fetchImpl });
    expect(result.status).toBe("invalid");
    expect(result.message).toBe("Invalid API key");
  });

  it("non-JSON / unparseable 200 body with valid:false → invalid with fallback message", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => { throw new Error("not json"); },
    }));
    const result = await runKeyCheck({ provider: "openai", apiKey: "sk-x", fetchImpl });
    expect(result.status).toBe("invalid");
    expect(result.message).toBeTruthy();
  });

  it("network rejection → status 'invalid' with a message (never an unhandled throw)", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("network down"); });
    const result = await runKeyCheck({ provider: "openai", apiKey: "sk-x", fetchImpl });
    expect(result.status).toBe("invalid");
    expect(result.message).toBe("network down");
  });
});

describe("submitCreateKey — create-key single-flight guard (double-click → 1 POST)", () => {
  function deferred() {
    let resolveFn;
    const promise = new Promise((r) => { resolveFn = r; });
    return { promise, resolve: resolveFn };
  }

  it("rapid double invocation while first POST is pending → exactly 1 network call", async () => {
    const gate = deferred();
    const fetchImpl = vi.fn(async () => {
      await gate.promise;
      return { ok: true, status: 200, json: async () => ({ key: "nrk_123" }) };
    });
    const guard = { current: false };
    const onCreated = vi.fn();

    const first = submitCreateKey({ guard, name: "Production Key", fetchImpl, onCreated });
    const second = submitCreateKey({ guard, name: "Production Key", fetchImpl, onCreated });

    gate.resolve();
    const [r1, r2] = await Promise.all([first, second]);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    expect(r2.skipped).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith({ key: "nrk_123" });
    // Guard resets so the NEXT (later) click still works.
    expect(guard.current).toBe(false);
  });

  it("a failed create resets the guard — a retry is allowed", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: "name exists" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ key: "nrk_2" }) });
    const guard = { current: false };
    const onError = vi.fn();

    const r1 = await submitCreateKey({ guard, name: "K", fetchImpl, onError });
    expect(r1.ok).toBe(false);
    expect(r1.message).toBe("name exists");
    expect(onError).toHaveBeenCalledWith("name exists");
    expect(guard.current).toBe(false);

    const r2 = await submitCreateKey({ guard, name: "K", fetchImpl, onError });
    expect(r2.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("network failure surfaces an error message and resets the guard", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("boom"); });
    const guard = { current: false };
    const onError = vi.fn();
    const r = await submitCreateKey({ guard, name: "K", fetchImpl, onError });
    expect(r.ok).toBe(false);
    expect(r.message).toBe("boom");
    expect(onError).toHaveBeenCalledWith("boom");
    expect(guard.current).toBe(false);
  });

  it("empty name is skipped without any network call", async () => {
    const fetchImpl = vi.fn();
    const r = await submitCreateKey({ guard: { current: false }, name: "   ", fetchImpl });
    expect(r.skipped).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("component wiring contract (source-level, no DOM in tests/)", () => {
  // These pin that the mechanisms above are actually wired into the dashboard
  // components — a refactor that drops the guard or the feedback state fails
  // even though the pure module still passes.
  const read = (p) => readFileSync(resolve(SRC, p), "utf8");

  it("EndpointPageClient handleCreateKey delegates to submitCreateKey with a useRef guard", () => {
    const src = read("app/(dashboard)/dashboard/endpoint/EndpointPageClient.js");
    expect(src).toContain("submitCreateKey");
    // DF-38's requireApiKeyInFlight pattern must stay intact.
    expect(src).toContain("requireApiKeyInFlight");
    const createFn = src.match(/const handleCreateKey = async \(\) => \{[\s\S]*?\n  \};/);
    expect(createFn).toBeTruthy();
    expect(createFn[0]).toContain("submitCreateKey");
    expect(createFn[0]).toContain("createKeyInFlight");
  });

  it("AddApiKeyModal wires runKeyCheck + a per-check result state + in-flight check guard", () => {
    const src = read("app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js");
    expect(src).toContain("runKeyCheck");
    expect(src).toMatch(/checkResult/);
    expect(src).toMatch(/checkInFlight/);
    // Check button stays disabled while a check is in flight.
    expect(src).toMatch(/disabled=\{[^}]*checkInFlight/);
  });

  it("ConnectionsCard's add-key modal wires runKeyCheck and success/error toasts", () => {
    const src = read("app/(dashboard)/dashboard/providers/components/ConnectionsCard.js");
    expect(src).toContain("runKeyCheck");
    expect(src).toContain("useNotificationStore");
    expect(src).toMatch(/Connection created/);
    expect(src).toMatch(/checkResult/);
  });
});
