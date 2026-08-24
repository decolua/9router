
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const SRC = fs.readFileSync(new URL("../../src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.js", import.meta.url), "utf8");
const OBS = SRC.slice(SRC.indexOf('aria-label="Token Saver aggregate statistics"'));

describe("token-saver observability UI", () => {
  it("loading initial distinct from unavailable (undefined vs null)", () => {
    expect(SRC).toMatch(/useState\s*\(\s*undefined\s*\)/);
    expect(SRC).toMatch(/AbortError/);
    // catch sets unavailable distinctly from initial loading
    expect(SRC).toMatch(/setTsStats\s*\(\s*null\s*\)/);
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
