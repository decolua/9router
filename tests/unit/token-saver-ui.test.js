
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const SRC = fs.readFileSync(new URL("../../src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.js", import.meta.url), "utf8");
const OBS = SRC.slice(SRC.indexOf('aria-label="Token Saver aggregate statistics"'));

describe("token-saver observability UI", () => {
  it("loading initial distinct from unavailable (undefined vs null)", () => {
    expect(SRC).toMatch(/useState\s*\(\s*undefined\s*\)/);
    expect(SRC).toMatch(/AbortError/);
    // catch marks unavailable distinctly from initial loading via functional updater
    expect(SRC).toMatch(
      /setTsStats\s*\(\s*\(\s*current\s*\)\s*=>\s*current\s*===\s*undefined/
    );
    expect(SRC).not.toMatch(/catch\s*\{\s*if\s*\(alive\)\s*setTsStats\(null\)/);
  });
  it("renders distinct Loading and Statistics unavailable branches", () => {
    expect(SRC).toMatch(/Loading…/);
    expect(SRC).toMatch(/Statistics unavailable/);
    // tied to equality checks against the two states
    expect(SRC).toMatch(/tsStats\s*===\s*undefined/);
    expect(SRC).toMatch(/tsStats\s*===\s*null/);
  });
  it("fetch/response-ok/json failures transition to unavailable", () => {
    expect(SRC).toMatch(/if\s*\(\s*!res\.ok\s*\)\s*throw/);
    expect(SRC).toMatch(/await\s+res\.json\(\)/);
  });
  it("daily 4-col table wrapped in overflow-x-auto, retains semantics", () => {
    expect(OBS).toMatch(/className="overflow-x-auto"[\s\S]*<table/);
    expect(OBS).toMatch(/<table[^>]*className="w-full text-sm"/);
    expect(OBS).toMatch(/<caption[^>]*className="sr-only"[^>]*>Daily token-saver aggregates by unit<\/caption>/);
    expect(OBS).toMatch(/<th[^>]*scope="col"[^>]*>Day \(UTC\)<\/th>/);
    expect(OBS).toMatch(/<th[^>]*scope="col"[^>]*>RTK chars<\/th>/);
    expect(OBS).toMatch(/<th[^>]*scope="col"[^>]*>Headroom tokens<\/th>/);
    expect(OBS).toMatch(/<th[^>]*scope="col"[^>]*>PXPIPE est\. tokens<\/th>/);
    expect(OBS).not.toMatch(/<canvas|recharts|chart\.js|victory/i);
  });
});

describe("token-saver stats polling (30s) and Headroom state branches", () => {
  // Extract the stats effect body (from its useState anchor to the next return).
  const EFFECT = SRC.slice(
    SRC.indexOf('useState(undefined); // undefined=loading, null=unavailable'),
    SRC.indexOf("return (\n    <div")
  );

  it("declares module constants REFRESH_MS = 30_000 and TIMEOUT_MS = 10_000", () => {
    expect(SRC).toMatch(
      /const\s+TOKEN_SAVER_STATS_REFRESH_MS\s*=\s*30_000/
    );
    // hanging fetch must not starve polling forever
    expect(SRC).toMatch(
      /const\s+TOKEN_SAVER_STATS_TIMEOUT_MS\s*=\s*10_000/
    );
  });

  it("effect-local alive flag: let alive = true, success guarded, cleanup clears it", () => {
    expect(EFFECT).toMatch(/let\s+alive\s*=\s*true/);
    expect(EFFECT).toMatch(/if\s*\(\s*alive\s*\)\s*setTsStats\(data\)/);
    expect(EFFECT).toMatch(/alive\s*=\s*false/);
    // no ref-based last-payload sentinel — effect-local design only
    expect(EFFECT).not.toMatch(/tsStatsRef|inFlightRef|statsAcRef/);
  });

  it("effect-local inFlight guard: let inFlight = false, entry gate, reset in finally", () => {
    expect(EFFECT).toMatch(/let\s+inFlight\s*=\s*false/);
    expect(EFFECT).toMatch(/if\s*\(\s*inFlight\s*\)\s*return/);
    expect(EFFECT).toMatch(/finally\s*\{[\s\S]*?inFlight\s*=\s*false/);
  });

  it("per-request AbortController tracked via activeController; timeout aborts hung fetch", () => {
    // one controller slot per effect (StrictMode-fresh), reassigned per request
    expect(EFFECT).toMatch(/let\s+activeController\s*=\s*null/);
    // each refresh creates its own controller and registers it
    expect(EFFECT).toMatch(
      /const\s+requestController\s*=\s*new AbortController\(\)[\s\S]*?activeController\s*=\s*requestController/
    );
    // fetch uses the per-request signal, not a shared ac
    expect(EFFECT).toMatch(/signal:\s*requestController\.signal/);
    expect(EFFECT).not.toMatch(/signal:\s*ac\.signal/);
    // timeout aborts the request after TOKEN_SAVER_STATS_TIMEOUT_MS; finally clears it
    expect(EFFECT).toMatch(
      /setTimeout\s*\(\s*\(\s*\)\s*=>\s*requestController\.abort\(\),\s*TOKEN_SAVER_STATS_TIMEOUT_MS\s*\)/
    );
    expect(EFFECT).toMatch(/clearTimeout\(timeoutId\)|clearTimeout\(timeout\)/);
    // cleanup aborts whichever request is still active
    expect(EFFECT).toMatch(/activeController\?\.abort\(\)/);
  });

  it("immediate refresh then setInterval every TOKEN_SAVER_STATS_REFRESH_MS; cleanup clears interval", () => {
    expect(EFFECT).toMatch(/refresh\(\)/);
    expect(EFFECT).toMatch(
      /setInterval\s*\(\s*refresh\s*,\s*TOKEN_SAVER_STATS_REFRESH_MS\s*\)/
    );
    expect(EFFECT).toMatch(
      /clearInterval\s*\(\s*timer\s*\)[\s\S]*?activeController\?\.abort\(\)/
    );
  });

  it("transient failure preserves payload via functional updater; initial failure -> null", () => {
    // catch: functional updater keeps previous success, only undefined (never loaded) becomes null
    expect(EFFECT).toMatch(
      /setTsStats\s*\(\s*\(\s*current\s*\)\s*=>\s*current\s*===\s*undefined\s*\?\s*null\s*:\s*current\s*\)/
    );
    // unmount-abort never updates state (no alive guard needed for the updater path)
    expect(EFFECT).toMatch(
      /if\s*\(\s*e\?\.name\s*===\s*"AbortError"\s*\)\s*\{[\s\S]*?if\s*\(\s*!alive\s*\)\s*return/
    );
    // timeout abort while alive falls through to the same transient-failure updater
    // no bare literal-null write anywhere in the stats effect
    expect(EFFECT).not.toMatch(/setTsStats\s*\(\s*null\s*\)/);
  });

  it("stats fetch sends cache: no-store (native cache bypass)", () => {
    expect(EFFECT).toMatch(
      /fetch\("\/api\/token-saver\/stats",\s*\{[\s\S]*?cache:\s*"no-store"/
    );
  });

  it("Headroom render: ok metrics / idle neutral copy / unavailable+unknown warning copy", () => {
    expect(SRC).toMatch(/sources\?\.headroom\?\.state\s*===\s*"ok"/);
    expect(SRC).toMatch(
      /state\s*===\s*"idle"\s*\?\s*[\s\S]{0,200}?No compression data yet/
    );
    expect(SRC).toContain("No compression data yet");
    expect(SRC).toContain("Headroom statistics unavailable");
    // ok branch still renders truthful per-unit metrics
    expect(SRC).toContain("proxyTokensSaved");
    expect(SRC).toContain("bodyBytesReduced");
  });
});
