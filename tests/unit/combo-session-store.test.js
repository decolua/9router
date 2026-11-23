import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_STICKY_SESSIONS, STICKY_SESSION_TTL_MS } from "../../open-sse/config/sessionAffinity.js";
import { getStickyComboRoute, setStickyComboModel, resetStickyComboStore, withComboSessionLock } from "../../open-sse/services/comboSession.js";

beforeEach(() => resetStickyComboStore());
afterEach(() => vi.restoreAllMocks());

describe("Bounded combo session state", () => {
  it("stores the selected member separately from the actual account", () => {
    const target = { provider: "openai", model: "gpt-4o", connectionId: "actual-account" };
    setStickyComboModel("pool", "session", "configured-member", target, "settings");
    expect(getStickyComboRoute("pool", "session", ["configured-member"], "settings")).toMatchObject({ model: "configured-member", target });
  });
  it("extends a two-hour sliding TTL and expires idle sessions", () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    setStickyComboModel("pool", "session", "member");
    now = STICKY_SESSION_TTL_MS - 1;
    expect(getStickyComboRoute("pool", "session", ["member"])).not.toBeNull();
    now = STICKY_SESSION_TTL_MS + 1;
    expect(getStickyComboRoute("pool", "session", ["member"])).not.toBeNull();
    now += STICKY_SESSION_TTL_MS + 1;
    expect(getStickyComboRoute("pool", "session", ["member"])).toBeNull();
  });
  it("invalidates changes to membership or policy", () => {
    setStickyComboModel("pool", "session", "member", null, "old-policy");
    expect(getStickyComboRoute("pool", "session", ["member"], "new-policy")).toBeNull();
    setStickyComboModel("pool", "session", "member");
    expect(getStickyComboRoute("pool", "session", ["replacement"])).toBeNull();
  });
  it("keeps at most 5000 session bindings", () => {
    for (let i = 0; i <= MAX_STICKY_SESSIONS; i++) setStickyComboModel("pool", String(i), "member");
    let count = 0;
    for (let i = 0; i <= MAX_STICKY_SESSIONS; i++) if (getStickyComboRoute("pool", String(i), ["member"])) count++;
    expect(count).toBeLessThanOrEqual(MAX_STICKY_SESSIONS);
    expect(getStickyComboRoute("pool", String(MAX_STICKY_SESSIONS), ["member"])).not.toBeNull();
  });
  it("releases dispatch locks after failure", async () => {
    await expect(withComboSessionLock("pool", "session", async () => { throw new Error("aborted"); })).rejects.toThrow("aborted");
    await expect(withComboSessionLock("pool", "session", async () => "next request")).resolves.toBe("next request");
  });
});
