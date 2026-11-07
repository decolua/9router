import { describe, it, expect } from "vitest";
import { buildView, PAGE } from "../../src/app/(dashboard)/dashboard/pii-guard/view.js";

const ui = { tab: "findings", sub: "values", q: "", fGroup: "", fAction: "", fClient: "", fModel: "", fSource: "", fStatus: "active", sel: {}, page: 0, leakPage: 0, testKind: "text", testText: "", imgSel: 0 };
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
  it("pages values with unique, non-empty keys and skips the work on other tabs", () => {
    const g = (i) => ({ hash: `h${i}`, rule: i % 2 ? "pan" : "email", sources: ["user/text"], actions: ["redact"], action: "redact", firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(), turns: 1, ignored: false });
    const data = base({ summary: { groups: Array.from({ length: PAGE + 5 }, (_, i) => g(i)), trend: [] } });
    const first = view(data), second = view(data, { ...ui, page: 1 });
    expect(first.values).toHaveLength(PAGE);
    expect(second.values).toHaveLength(5);
    const keys = first.values.map((v) => v.key);
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
    expect(first.nextValues).toBeTypeOf("function");
    expect(second.nextValues).toBeNull();
    expect(view(data, { ...ui, tab: "overview" }).values).toHaveLength(0);
  });
});
