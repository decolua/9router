import { describe, it, expect } from "vitest";
import { buildView } from "../../src/app/(dashboard)/dashboard/pii-guard/view.js";

const ui = { tab: "findings", sub: "values", q: "", fGroup: "", fAction: "", fClient: "", fModel: "", fSource: "", fStatus: "active", sel: {}, limit: 300, testKind: "text", testText: "", imgSel: 0 };
const base = (over = {}) => ({
  health: { module: true, loaded: true }, config: { mode: "off", rules: {} },
  rules: [{ id: "pan", label: "PAN", group: "id" }, { id: "email", label: "Email", group: "contact" }],
  summary: { groups: [], trend: [] }, ...over,
});
const view = (data, u = ui) => buildView({ data, ui: u, set: () => {}, act: () => {}, range: { preset: "24h" }, fit: null, test: {}, events: [], samples: [] });

describe("pii-guard view", () => {
  it("says off only when every rule is off", () => {
    expect(view(base()).status.text).toMatch(/^Off/);
    expect(view(base({ config: { mode: "off", rules: { pan: "observe" } } })).status.text).not.toMatch(/^Off/);
  });
  it("warns when the event read was truncated", () => {
    expect(view(base({ summary: { groups: [], trend: [], truncated: true } })).problems.some((p) => /cut short/.test(p.title))).toBe(true);
  });
});
