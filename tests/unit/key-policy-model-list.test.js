// @vitest-environment jsdom
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import PropTypes from "prop-types";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, beforeAll, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parseSearchQuery, matchesSearch } from "@/shared/utils/modelSearchFilter.js";
import {
  sameEntry,
  addPolicyModelEntry,
  removePolicyModelEntry,
  applyPolicyModelSelect,
  applyPolicyModelDeselect,
} from "@/shared/utils/policyModelList.js";

// Computed once via fileURLToPath instead of `new URL(relative, import.meta.url)`
// at each call site -- under @vitest-environment jsdom, import.meta.url-relative
// URL resolution in this file throws ERR_INVALID_URL_SCHEME, so source files are
// addressed by plain filesystem path instead.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoSrcDir = path.resolve(__dirname, "../../src");
const testsRoot = path.resolve(__dirname, "..");

/**
 * ModelSelectModal's "Select All" / "Deselect All" call onSelect/onDeselect once
 * per item inside a synchronous forEach when no batch handler is passed
 * (ModelSelectModal.js handleSelectAllVisible / handleDeselectAllVisible).
 * React batches those calls, so the handlers must read the latest state through
 * a functional updater instead of a render-time snapshot.
 */

// Applies the real updaters sequentially the way React does: each call sees the
// state produced by the previous one, never the render-time snapshot.
function applyAll(state, updater, values) {
  let current = state;
  for (const value of values) current = updater(current, value);
  return current;
}

describe("policy allow list: synchronous per-item updates", () => {
  it("adds both entries from two synchronous onSelect calls", () => {
    const next = applyAll({ accessAllow: [] }, applyPolicyModelSelect, [
      "openai/gpt-4o",
      "anthropic/claude-sonnet",
    ]);
    expect(next.accessAllow).toEqual(["openai/gpt-4o", "anthropic/claude-sonnet"]);
  });

  it("removes both entries from two synchronous onDeselect calls", () => {
    const next = applyAll(
      { accessAllow: ["openai/gpt-4o", "anthropic/claude-sonnet", "glm/glm-4.7"] },
      applyPolicyModelDeselect,
      ["openai/gpt-4o", "glm/glm-4.7"],
    );
    expect(next.accessAllow).toEqual(["anthropic/claude-sonnet"]);
  });

  it("loses an entry under the pre-fix snapshot form but keeps both with the updater", () => {
    // The pre-fix shape: every handler closed over the same editForm, so the
    // second write overwrote the first. This is the regression being guarded.
    const snapshot = { accessAllow: [] };
    const staleWrite = (value) => ({ ...snapshot, accessAllow: [...snapshot.accessAllow, value] });
    expect(staleWrite("a/b") && staleWrite("c/d")).toEqual({ accessAllow: ["c/d"] });

    const fixed = applyAll(snapshot, applyPolicyModelSelect, ["a/b", "c/d"]);
    expect(fixed.accessAllow).toEqual(["a/b", "c/d"]);
  });

  it("drops duplicates added synchronously and keeps the first spelling", () => {
    const next = applyAll({ accessAllow: [] }, applyPolicyModelSelect, [
      "OpenAI/GPT-4o",
      "openai/gpt-4o",
    ]);
    expect(next.accessAllow).toEqual(["OpenAI/GPT-4o"]);
  });

  it("ignores an empty model value and preserves the previous state object", () => {
    const prev = { accessAllow: ["a/b"] };
    expect(applyPolicyModelSelect(prev, undefined)).toBe(prev);
    expect(applyPolicyModelSelect(prev, "")).toBe(prev);
  });

  it("preserves unrelated edit-form fields when updating accessAllow", () => {
    const prev = { accessAllow: [], expiresAt: "2026-01-01", accessRestricted: true };
    const next = applyPolicyModelSelect(prev, "a/b");
    expect(next).toEqual({ ...prev, accessAllow: ["a/b"] });
  });

  it("matches case-insensitively on both add and remove", () => {
    expect(sameEntry("OpenAI/GPT-4o", "openai/gpt-4o")).toBe(true);
    const added = addPolicyModelEntry(["openai/gpt-4o"], "OpenAI/GPT-4o");
    expect(added).toEqual(["openai/gpt-4o"]);
    expect(removePolicyModelEntry(["openai/gpt-4o"], "OpenAI/GPT-4o")).toEqual([]);
  });

  it("returns the input array itself when nothing changes", () => {
    const list = ["a/b"];
    expect(addPolicyModelEntry(list, "a/b")).toBe(list);
    expect(removePolicyModelEntry(list, "c/d")).toBe(list);
    expect(addPolicyModelEntry(undefined, "a/b")).toEqual(["a/b"]);
    expect(removePolicyModelEntry(undefined, "a/b")).toEqual([]);
  });

  it("handles a missing accessAllow without producing an undefined list", () => {
    expect(applyPolicyModelSelect({}, "a/b")).toEqual({ accessAllow: ["a/b"] });
    expect(applyPolicyModelDeselect({}, "a/b")).toEqual({});
    expect(applyPolicyModelSelect(undefined, "a/b")).toEqual({ accessAllow: ["a/b"] });
    expect(applyPolicyModelDeselect(undefined, "a/b")).toEqual({});
  });
});

function extractBraceBlock(src, anchorRegex) {
  const anchor = anchorRegex.exec(src);
  if (!anchor) return null;
  const start = src.indexOf("{", anchor.index + anchor[0].length - 1);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

describe("EndpointPageClient policy picker contract", () => {
  let code;
  beforeAll(() => {
    const filePath = path.join(repoSrcDir, "app/(dashboard)/dashboard/endpoint/EndpointPageClient.js");
    code = fs
      .readFileSync(filePath, "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
  });

  it("routes onSelect through a functional state updater", () => {
    const block = extractBraceBlock(code, /onSelect\s*=\s*\{\s*\(/);
    expect(block).not.toBeNull();
    expect(block).toMatch(/setEditForm\(\s*\(\s*prev\s*\)\s*=>/);
    expect(block).toMatch(/applyPolicyModelSelect\(\s*prev\s*,/);
    expect(block).not.toMatch(/editForm\.accessAllow/);
  });

  it("routes onDeselect through a functional state updater", () => {
    const block = extractBraceBlock(code, /onDeselect\s*=\s*\{\s*\(/);
    expect(block).not.toBeNull();
    expect(block).toMatch(/setEditForm\(\s*\(\s*prev\s*\)\s*=>/);
    expect(block).toMatch(/applyPolicyModelDeselect\(\s*prev\s*,/);
    expect(block).not.toMatch(/editForm\.accessAllow/);
  });

  it("feeds addedModelValues from the current edit form", () => {
    expect(code).toMatch(/addedModelValues\s*=\s*\{\s*editForm\.accessAllow\s*\|\|\s*\[\]\s*\}/);
  });

  it("opts the policy picker into case-insensitive added-value matching", () => {
    expect(code).toMatch(/addedModelValuesCaseInsensitive/);
  });
});

describe("ModelSelectModal policy picker membership contract", () => {
  let code;
  beforeAll(() => {
    const filePath = path.join(repoSrcDir, "shared/components/ModelSelectModal.js");
    code = fs.readFileSync(filePath, "utf-8");
  });

  it("uses the opt-in comparison for selection, highlighting, and bulk deselection", () => {
    expect(code).toMatch(/addedModelValuesCaseInsensitive\s*=\s*false/);
    expect(code).toMatch(/String\(addedValue\)\.toLowerCase\(\)\s*===\s*String\(value\)\.toLowerCase\(\)/);
    expect(code).toMatch(/visibleAdded.*isAddedModelValue/);
    expect(code).toMatch(/const isAdded = isAddedModelValue\(value\)/);
    expect(code).toMatch(/isAddedModelValue\(model\.value\)/);
  });
});

const catalog = {
  "llm-provider": [
    { id: "match-new", name: "Match new" },
    { id: "match-old", name: "Match old" },
    { id: "other", name: "Other" },
  ],
  "media-provider": [{ id: "match-media", name: "Match media", kind: "embedding" }],
};

function compileJsxInChildProcess(source) {
  // esbuild's native binary asserts `new TextEncoder().encode("") instanceof
  // Uint8Array` at module-load time, and under @vitest-environment jsdom that
  // check fails -- jsdom's Uint8Array is a different realm's constructor than
  // the one esbuild's encoder produces, so no amount of swapping globalThis's
  // TextEncoder/TextDecoder in *this* process fixes it. Running esbuild inside
  // a plain `node -e` child process sidesteps jsdom's realm entirely.
  return execFileSync(
    process.execPath,
    [
      "--input-type=commonjs",
      "-e",
      `
        const { transformSync } = require("esbuild");
        const source = require("node:fs").readFileSync(0, "utf8");
        const result = transformSync(source, { loader: "jsx", format: "cjs", jsx: "automatic" });
        process.stdout.write(result.code);
      `,
    ],
    { cwd: testsRoot, input: source, encoding: "utf8", timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
  );
}

function loadModalFromSource() {
  const filePath = path.join(repoSrcDir, "shared/components/ModelSelectModal.js");
  const source = fs.readFileSync(filePath, "utf-8");
  const compiled = compileJsxInChildProcess(source);
  const providers = {
    OAUTH_PROVIDERS: {},
    APIKEY_PROVIDERS: {
      "llm-provider": { name: "LLM provider", color: "#000" },
      "media-provider": { name: "Media provider", color: "#000", serviceKinds: ["embedding"] },
    },
    FREE_PROVIDERS: {},
    FREE_TIER_PROVIDERS: {},
    AI_PROVIDERS: { "llm-provider": { serviceKinds: ["llm"] }, "media-provider": { serviceKinds: ["embedding"] } },
    isOpenAICompatibleProvider: () => false,
    isAnthropicCompatibleProvider: () => false,
    isCustomEmbeddingProvider: () => false,
    getProviderAlias: (id) => id,
    MEDIA_PROVIDER_KINDS: [{ id: "embedding", label: "Embedding", icon: "extension" }],
  };
  const dependencies = {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "prop-types": PropTypes,
    // esbuild's CJS __toESM interop sets `.default` to the *whole* required
    // module when it isn't already `__esModule`, then copies the module's own
    // enumerable props over it -- so wrapping these in `{ default: Component }`
    // made `.default` resolve to that wrapper object, not Component itself
    // ("Element type is invalid ... got: object"). Mocking a bare default
    // export as the module value itself matches plain `module.exports = X`.
    "./Modal": ({ children }) => React.createElement("div", null, children),
    "./ProviderIcon": () => null,
    "./CapacityBadges": () => null,
    "@/shared/hooks/useModelCaps": { useModelCaps: () => ({ getCaps: () => ({}) }) },
    "@/shared/constants/models": { getModelsByProviderId: (id) => catalog[id] || [], getModelKind: (model) => model.kind || null },
    "@/shared/constants/providers": providers,
    "@/shared/utils/modelSearchFilter": { parseSearchQuery, matchesSearch },
    "@/shared/utils/connectionStatus": { getDeactivatedProviderIds: () => new Set() },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)((id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected ModelSelectModal import: ${id}`);
    return dependencies[id];
  }, module, module.exports);
  return module.exports.default;
}

const activeProviders = [
  { id: "llm-connection", provider: "llm-provider" },
  { id: "media-connection", provider: "media-provider" },
];

function mockCatalogRequests(comboName = "Main") {
  vi.stubGlobal("fetch", vi.fn(async (url) => ({
    ok: true,
    json: async () => {
      if (url === "/api/providers") return { connections: activeProviders };
      if (url === "/api/combos") return { combos: [{ id: "combo-1", name: comboName }] };
      if (url === "/api/provider-nodes") return { nodes: [] };
      if (url === "/api/models/custom") return { models: [] };
      if (url === "/api/models/disabled") return { disabled: {} };
      throw new Error(`Unexpected catalog request: ${url}`);
    },
  })));
}

describe("ModelSelectModal interactive policy picker", () => {
  const ModelSelectModal = loadModalFromSource();

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("highlights, checks, and removes a combo with differently cased stored spelling", async () => {
    mockCatalogRequests();
    const onSelect = vi.fn();
    const onDeselect = vi.fn();
    render(React.createElement(ModelSelectModal, {
      isOpen: true, onClose: vi.fn(), onSelect, onDeselect,
      addedModelValues: ["MAIN"], addedModelValuesCaseInsensitive: true,
      closeOnSelect: false, activeProviders: [],
    }));

    const combo = await screen.findByRole("button", { name: /Main/ });
    expect(combo.className).toContain("bg-primary border-primary text-white");
    expect(within(combo).getByText("check")).toBeTruthy();
    fireEvent.click(combo);
    expect(onDeselect).toHaveBeenCalledTimes(1);
    expect(onDeselect).toHaveBeenCalledWith({ id: "Main", name: "Main", value: "Main" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("selects and deselects only filtered main models, leaving combos and media untouched", async () => {
    mockCatalogRequests("Match combo");
    const onSelectBatch = vi.fn();
    const onDeselectBatch = vi.fn();
    render(React.createElement(ModelSelectModal, {
      isOpen: true, onClose: vi.fn(), onSelect: vi.fn(), onDeselect: vi.fn(),
      onSelectBatch, onDeselectBatch, closeOnSelect: false,
      includeMediaKinds: true, activeProviders,
      addedModelValues: ["llm-provider/match-old", "Match combo", "media-provider/match-media"],
    }));

    await screen.findByRole("button", { name: /Match combo/ });
    await screen.findByRole("button", { name: /Match media/ });
    fireEvent.change(screen.getByPlaceholderText(/Search models/), { target: { value: "match" } });
    expect(screen.getByRole("button", { name: /Match combo/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Match media/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Other/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Select All (1)" }));
    expect(onSelectBatch).toHaveBeenCalledTimes(1);
    expect(onSelectBatch).toHaveBeenCalledWith([
      { id: "match-new", name: "Match new", value: "llm-provider/match-new", kind: null },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Deselect All (1)" }));
    expect(onDeselectBatch).toHaveBeenCalledTimes(1);
    expect(onDeselectBatch).toHaveBeenCalledWith([
      { id: "match-old", name: "Match old", value: "llm-provider/match-old", kind: null },
    ]);
  });
});
