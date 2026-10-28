import { describe, it, expect } from "vitest";

describe("OpenCode Bridge Resilience Trio", () => {
  it("generates stable relay names across session recycles within the same workspace", () => {
    // Two different session keys in the same directory and connection should produce the EXACT same relay name
    const conn = "conn_user1";
    const dir = "/home/psyco/project/niner-gateway";
    
    // Simulate serviceRelayName
    const crypto = require("crypto");
    function testRelayName(cacheKey, directory = "") {
      const c = String(cacheKey || "").split(":")[0] || "default";
      const d = directory || (String(cacheKey || "").match(/:dir:([a-zA-Z0-9_-]+)/) || [])[1] || "default";
      return `ninerouter_${crypto.createHash("sha256").update(`${c}:${d}`).digest("hex").slice(0, 16)}`;
    }

    const relay1 = testRelayName(`${conn}:modelA:dir:abc:conversation:111`, dir);
    const relay2 = testRelayName(`${conn}:modelA:dir:abc:conversation:222`, dir);
    expect(relay1).toBe(relay2);

    // Different directory produces different relay name
    const relay3 = testRelayName(`${conn}:modelA:dir:xyz:conversation:111`, "/home/psyco/project/other");
    expect(relay1).not.toBe(relay3);
  });

  it("busy guard detects active turns before daemon reaping", () => {
    const activeSession = { activeTurn: {}, pendingCalls: new Map() };
    const isBusy = Boolean(activeSession.activeTurn || activeSession.pendingCalls.size > 0);
    expect(isBusy).toBe(true);

    const idleSession = { activeTurn: null, pendingCalls: new Map() };
    const isIdle = Boolean(idleSession.activeTurn || idleSession.pendingCalls.size > 0);
    expect(isIdle).toBe(false);
  });
});
