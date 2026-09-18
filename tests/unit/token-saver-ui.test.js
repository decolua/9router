import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const file = resolve(here, "../../src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.js");

describe("token-saver pxpipe ui", () => {
  it("PXPIPE card/controls/link are no longer gated behind {false && ...}", () => {
    const src = readFileSync(file, "utf8");
    const pxpipeStart = src.indexOf("Compress prompts as images");
    const preceding = src.slice(Math.max(0, pxpipeStart - 2000), pxpipeStart);
    expect(pxpipeStart).toBeGreaterThan(-1);
    expect(preceding).not.toContain("false &&");
  });

  it("Modal isOpen is bound to showPxpipeModal, not hard-coded false", () => {
    const src = readFileSync(file, "utf8");
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
    const src = readFileSync(file, "utf8");
    expect(src).toContain("pxpipeEnabled");
    expect(src).toContain("pxpipeStatus");
    expect(src).toContain("showPxpipeModal");
    expect(src).toContain("handlePxpipeEnabled");
    expect(src).toContain("pxpipeAction(");
    expect(src).toContain("handlePxpipeMinCharsBlur");
    expect(src).toContain('href="/dashboard/pxpipe"');
  });
});
