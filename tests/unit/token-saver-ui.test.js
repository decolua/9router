import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const file = resolve(here, "../../src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.js");

const SRC = readFileSync(file, "utf8");
const OBS = SRC.slice(SRC.indexOf('aria-label="Token Saver aggregate statistics"'));

describe("token-saver pxpipe ui", () => {
  it("PXPIPE card/controls/link are no longer gated behind {false && ...}", () => {
    const src = SRC;
    const pxpipeStart = src.indexOf("Compress prompts as images");
    const preceding = src.slice(Math.max(0, pxpipeStart - 2000), pxpipeStart);
    expect(pxpipeStart).toBeGreaterThan(-1);
    expect(preceding).not.toContain("false &&");
  });

  it("Modal isOpen is bound to showPxpipeModal, not hard-coded false", () => {
    const src = SRC;
    const pxpipeTitleRe =
      /title=\{pxpipeStatus\.installed \? "PXPIPE" : "Setup PXPIPE"\}/;
    const pxpipeModalRe = /isOpen=\{showPxpipeModal\}/;
    expect(src).toMatch(pxpipeTitleRe);
    expect(src).toMatch(pxpipeModalRe);
    const idx = src.indexOf('title={pxpipeStatus.installed ? "PXPIPE"');
    expect(idx).toBeGreaterThan(-1);
    // Look only within the PXPIPE Modal open tag, not globally.
    const modalStart = src.lastIndexOf("<Modal", idx) === -1 ? 0 : idx - 120;
    const window_ = src.slice(
      Math.max(0, idx - 120),
      src.indexOf(">", idx) === -1 ? src.length : src.indexOf(">", idx)
    );
    // The PXPIPE modal invocation must not contain isOpen={false}.
    const pxpipeModalTag = src.slice(
      src.lastIndexOf("<Modal", idx) === -1
        ? Math.max(0, idx - 300)
        : src.lastIndexOf("<Modal", idx),
      src.indexOf(">", idx) + 1
    );
    expect(pxpipeModalTag).not.toContain("isOpen={false}");
    expect(pxpipeModalTag).toContain("isOpen={showPxpipeModal}");
  });

  it("preserves PXPIPE state, handlers and modal wiring", () => {
    const src = SRC;
    expect(src).toContain("pxpipeEnabled");
    expect(src).toContain("pxpipeStatus");
    expect(src).toContain("showPxpipeModal");
    expect(src).toContain("handlePxpipeEnabled");
    expect(src).toContain("pxpipeAction(");
    expect(src).toContain("handlePxpipeMinCharsBlur");
    expect(src).toContain('href="/dashboard/pxpipe"');
  });
});

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
