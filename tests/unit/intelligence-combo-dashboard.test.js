import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboardSource = fs.readFileSync(
  path.resolve(here, "../../src/app/(dashboard)/dashboard/combos/page.js"),
  "utf8"
);
const localModalSource = dashboardSource.slice(dashboardSource.indexOf("function ComboFormModal("));

describe("combos dashboard intelligence form", () => {
  it("lets the dashboard's rendered local combo form save an intelligence configuration", () => {
    expect(localModalSource).toContain('const [comboType, setComboType]');
    expect(localModalSource).toContain('type: "intelligence"');
    expect(localModalSource).toContain('comboType === "manual"');
    expect(localModalSource).toContain("refreshSchedule");
  });

  it("offers an exclude-keywords field for intelligence model selection", () => {
    expect(localModalSource).toContain("excludeKeywords");
    expect(localModalSource).toContain("Exclude keywords");
  });
});
