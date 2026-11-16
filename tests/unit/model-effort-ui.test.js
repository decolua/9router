import { describe, it, expect, vi, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";

/**
 * The per-model Effort selector, rendered rather than assumed. ModelRow is a React
 * component in a .js file, which the test runner does not parse as JSX, so it is
 * compiled here (with the shared-components barrel replaced by a stub) and the
 * result rendered to markup.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "../../src/app/(dashboard)/dashboard/providers/[id]/ModelRow.js");
let ModelRow;

beforeAll(async () => {
  const stubbed = fs.readFileSync(source, "utf8")
    .replace(/import \{ CapacityBadges \} from "@\/shared\/components";/, "const CapacityBadges = () => null;");
  const { code } = await transformWithOxc(stubbed, source, { lang: "jsx", jsx: { runtime: "automatic" } });
  const dir = path.resolve(here, "../node_modules/.model-row-test");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "ModelRow.mjs");
  fs.writeFileSync(file, code);
  ModelRow = (await import(pathToFileURL(file).href)).default;
});

const base = { model: { id: "gpt-6-luna", name: "GPT 6.0 Luna" }, fullModel: "cx/gpt-6-luna", copied: null, onCopy: () => {} };
const render = (props) => renderToStaticMarkup(React.createElement(ModelRow, { ...base, ...props }));

describe("ModelRow effort selector", () => {
  it("offers auto plus exactly the levels it was given, with the saved one selected", () => {
    const html = render({ effortLevels: ["low", "medium", "high"], effort: "low", onEffortChange: vi.fn() });
    expect(html).toContain("Effort: auto");
    for (const l of ["low", "medium", "high"]) expect(html).toContain(`Effort: ${l}`);
    expect(html).not.toContain("Effort: xhigh");
    expect(html).toMatch(/<option value="low" selected/);
  });

  it("shows auto when no effort is saved", () => {
    expect(render({ effortLevels: ["low"], onEffortChange: vi.fn() })).toMatch(/<option value="auto" selected/);
  });

  it("is absent for a model with no levels, or without a handler", () => {
    expect(render({ effortLevels: null, onEffortChange: vi.fn() })).not.toContain("Effort:");
    expect(render({ effortLevels: ["low"] })).not.toContain("Effort:");
  });
});
