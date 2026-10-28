// The endpoint page documents an adaptive polling design:
//
//   // Adaptive: slow when healthy, fast when degraded; pause when tab hidden.
//
// Two of the three were implemented. "slow when healthy" was not: both effects
// returned before creating any interval once everything was reachable, so the
// page stopped polling altogether rather than slowing down. STATUS_POLL_SLOW_MS
// and CLIENT_PING_SLOW_MS sat unused next to their FAST siblings — the design
// was written down twice, in a comment and in a constant, and never wired.
//
// The consequence is the opposite of what the browser-side probe exists for:
// its own comment says it runs so the UI stays accurate "even when backend DNS
// hiccups", and it shut off exactly when the UI was green — the state in which
// nothing else would notice a tunnel dropping underneath it.
//
// The page is a client component and this repo has no React renderer in its test
// setup, so this is pinned at the source level. A behavioural test is not
// available; a test that only asserted the constants exist would pass against
// the bug, which is how it survived.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const CLIENT = new URL(
  "../../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js",
  import.meta.url,
);
const CONSTANTS = new URL(
  "../../src/app/(dashboard)/dashboard/endpoint/endpointConstants.js",
  import.meta.url,
);

const source = readFileSync(CLIENT, "utf8");
const constants = readFileSync(CONSTANTS, "utf8");

describe("the endpoint page polls slowly when healthy (not never)", () => {
  it("both SLOW constants are declared", () => {
    expect(constants).toMatch(/export const STATUS_POLL_SLOW_MS\s*=/);
    expect(constants).toMatch(/export const CLIENT_PING_SLOW_MS\s*=/);
  });

  it("slow is genuinely slower than fast", () => {
    const value = (name) => {
      const m = constants.match(new RegExp("export const " + name + "\\s*=\\s*(\\d+)"));
      return m ? Number(m[1]) : NaN;
    };
    expect(value("STATUS_POLL_SLOW_MS")).toBeGreaterThan(value("STATUS_POLL_FAST_MS"));
    expect(value("CLIENT_PING_SLOW_MS")).toBeGreaterThan(value("CLIENT_PING_FAST_MS"));
  });

  it("the page imports both of them", () => {
    expect(source).toMatch(/\bSTATUS_POLL_SLOW_MS\b/);
    expect(source).toMatch(/\bCLIENT_PING_SLOW_MS\b/);
  });

  it("the status poll picks its interval from health rather than bailing out", () => {
    expect(source).toMatch(
      /allHealthy\s*\?\s*STATUS_POLL_SLOW_MS\s*:\s*STATUS_POLL_FAST_MS/,
    );
    // The early return is what stopped the timer being created at all.
    expect(source).not.toMatch(/if\s*\(allHealthy\)\s*return\s*\(\)\s*=>/);
  });

  it("the client ping picks its interval from health rather than bailing out", () => {
    expect(source).toMatch(
      /tunnelHealthy\s*&&\s*tsHealthy\s*\?\s*CLIENT_PING_SLOW_MS\s*:\s*CLIENT_PING_FAST_MS/,
    );
    expect(source).not.toMatch(/if\s*\(tunnelHealthy\s*&&\s*tsHealthy\)\s*return;/);
  });

  it("the hidden-tab guards are still in place", () => {
    // "pause when tab hidden" is the part of the comment that was true. Slowing
    // the beat must not turn into a background tab probing every minute forever.
    expect(source).toMatch(/if\s*\(document\.hidden\)\s*return;/);
    expect(source).toMatch(/if\s*\(!document\.hidden\)\s*syncTunnelStatus\(\)/);
  });
});
