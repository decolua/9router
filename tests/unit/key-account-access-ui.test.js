import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const controls = readFileSync(new URL("../../src/app/(dashboard)/dashboard/endpoint/components/KeyAccessControls.js", import.meta.url), "utf8");
const endpoint = readFileSync(new URL("../../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js", import.meta.url), "utf8");
const modal = readFileSync(new URL("../../src/app/(dashboard)/dashboard/endpoint/components/AccountSelectModal.js", import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const { transformSync } = require("next/dist/build/swc");
function compile(source, filename) {
  return transformSync(source, {
    filename,
    jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "classic" } } },
    module: { type: "commonjs" },
  }).code;
}
const compiled = compile(modal, "AccountSelectModal.js");
const picker = readFileSync(new URL("../../src/shared/components/SelectionPicker.js", import.meta.url), "utf8");
const compiledPicker = compile(picker, "SelectionPicker.js");

function renderModal(overrides = {}, search = "") {
  const createElement = (type, props, ...children) => typeof type === "function"
    ? type({ ...props, children })
    : ({ type, props: { ...props, children } });
  const shared = { exports: {}, React: { createElement } };
  runInNewContext(compiledPicker, shared);
  const context = {
    exports: {},
    React: { createElement },
    require: (id) => {
      if (id.endsWith("/SelectionPicker")) return shared.exports;
      if (id === "react") return { useState: () => [search, () => {}] };
      if (id === "prop-types") return require("prop-types");
      if (id.endsWith("/providers")) return { AI_PROVIDERS: { openai: { name: "OpenAI", color: "#10A37F" }, anthropic: { name: "Anthropic" } } };
      return ({ children }) => ({ type: id, props: { children } });
    },
  };
  runInNewContext(compiled, context);
  const onChange = vi.fn();
  const tree = context.exports.default({
    isOpen: true, onClose: vi.fn(), selectedIds: ["removed", "a"], onChange, loading: false, error: false, onRetry: vi.fn(), saving: false,
    accounts: [{ id: "a", provider: "openai", name: "Work", email: "work@example.org" }, { id: "b", provider: "openai", name: "Home" }, { id: "c", provider: "anthropic", email: "other@example.org" }],
    ...overrides,
  });
  const nodes = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    nodes.push(node);
    walk(node.props.children);
  };
  walk(tree);
  const text = (node) => Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text(node.props.children) : node || "";
  const button = (label) => nodes.find((node) => node.type === "button" && text(node) === label);
  return { tree, nodes, onChange, button, text };
}

describe("API key account access UI contract", () => {
  it("shares presentation without catalog or selection state", () => {
    const models = readFileSync(new URL("../../src/shared/components/ModelSelectModal.js", import.meta.url), "utf8");
    for (const source of [modal, models]) {
      for (const component of ["SelectionToolbar", "SelectionGroup", "SelectionChip", "SelectionAction"]) {
        expect(source).toContain(`<${component}`);
      }
    }
    expect(picker).not.toMatch(/\b(fetch|useState|useEffect|useMemo)\s*\(/);
    const { nodes } = renderModal();
    const search = nodes.find((node) => node.type === "input");
    expect(search.props.type).toBe("search");
    expect(nodes.some((node) => node.type === "span" && node.props.className === "sr-only")).toBe(true);
    expect(nodes.filter((node) => node.props["aria-pressed"] !== undefined).every((node) => node.props.type === "button" && node.props.className.includes("rounded-xl"))).toBe(true);
    expect(nodes.some((node) => node.type === "section" && node.props["aria-label"] === "OpenAI accounts")).toBe(true);
  });

  it("keeps account restrictions independent and feeds model account scope", () => {
    expect(controls).toContain('label="Restrict accounts"');
    expect(controls).toContain("checked={access.accountsRestricted}");
    expect(controls).toContain("onChange({ ...access, accountsRestricted })");
    expect(controls).toContain("onChange({ ...access, restricted: false })");
    expect(controls).toContain("onChange({ ...access, restricted: true, allow })");
    expect(controls).toContain("allowedConnectionIds={access.accountsRestricted ? access.accountIds : null}");
    expect(endpoint).toContain("{ ...key.access, restricted: true, allow: key.access?.allow || [] }");
  });

  it("loads only display fields, exposes badges and preserves missing selected IDs", () => {
    expect(controls).toContain('fetch("/api/providers", { signal: controller.signal })');
    expect(controls).toContain("map(({ id, provider, name, email }) => ({ id, provider, name, email }))");
    expect(controls).not.toContain('type="checkbox"');
    expect(controls).toContain("Add account");
    expect(controls).toContain("selectedIds={access.accountIds}");
    expect(controls).toContain("accountIds: access.accountIds.filter((accountId) => accountId !== id)");
    expect(controls).toContain("return () => controller.abort()");
    expect(controls).not.toContain("accountIds: [] })");
  });

  it("searches names, emails and provider display names", () => {
    for (const query of ["home", "work@example.org", "OpenAI"]) {
      const { nodes } = renderModal({}, query);
      const chips = nodes.filter((node) => node.props["aria-pressed"] !== undefined);
      expect(chips.length).toBe(query === "OpenAI" ? 2 : 1);
    }
    expect(renderModal({}, "missing").button("Select all visible").props.disabled).toBe(true);
  });

  it("selects and deselects only visible accounts with one callback preserving hidden IDs", () => {
    const { button, onChange } = renderModal({}, "OpenAI");
    button("Select all visible").props.onClick();
    expect(onChange).toHaveBeenLastCalledWith(["removed", "a", "b"]);
    expect(onChange).toHaveBeenCalledTimes(1);
    button("Deselect all visible").props.onClick();
    expect(onChange).toHaveBeenLastCalledWith(["removed"]);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("exposes pressed chips, provider metadata and removable unavailable accounts", () => {
    const { nodes, onChange } = renderModal();
    const chips = nodes.filter((node) => node.props["aria-pressed"] !== undefined);
    expect(chips.map((node) => node.props["aria-pressed"])).toEqual([true, false, false]);
    chips[1].props.onClick();
    expect(onChange).toHaveBeenLastCalledWith(["removed", "a", "b"]);
    chips[0].props.onClick();
    expect(onChange).toHaveBeenLastCalledWith(["removed"]);
    expect(nodes.some((node) => node.type === "h3" && node.props.style?.color === "#10A37F")).toBe(true);
    nodes.find((node) => node.props["aria-label"] === "Remove unavailable account removed").props.onClick();
    expect(onChange).toHaveBeenLastCalledWith(["a"]);
  });

  it("shows loading/error/retry and locks policy updates while saving", () => {
    expect(renderModal({ loading: true }).nodes.some((node) => node.props.role === "status")).toBe(true);
    const onRetry = vi.fn();
    const failed = renderModal({ error: true, onRetry });
    expect(failed.nodes.some((node) => node.props.role === "alert")).toBe(true);
    failed.button("Retry").props.onClick();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(failed.button("Select all visible").props.disabled).toBe(true);
    const saving = renderModal({ saving: true });
    expect(saving.nodes.find((node) => node.type === "fieldset").props.disabled).toBe(true);
    saving.button("Select all visible").props.onClick();
    saving.nodes.find((node) => node.props["aria-pressed"] !== undefined).props.onClick();
    expect(saving.onChange).not.toHaveBeenCalled();
    expect(controls).toContain("disabled={saving} aria-busy={saving}");
    expect(controls).toContain("await onSave(nextAccess)");
    expect(controls).toContain("if (savingRef.current) return");
    expect(controls).toContain("savingRef.current = false");
  });
});
