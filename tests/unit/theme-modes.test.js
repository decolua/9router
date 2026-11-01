/**
 * Theme is strictly locked to 'glass' across the entire application.
 *
 * Both `.dark` and `.glass` stay on <html> (components render from dark-tuned
 * tokens with frosted glass overrides). Switching is disallowed and any attempt
 * to set other themes strictly degrades to 'glass'.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let classes;
let store;

function stubDom() {
  classes = new Set();
  const classList = {
    add: (...cs) => cs.forEach((c) => classes.add(c)),
    remove: (...cs) => cs.forEach((c) => classes.delete(c)),
    toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
    contains: (c) => classes.has(c),
    has: (c) => classes.has(c),
  };
  const mem = {};
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("document", { documentElement: { classList } });
  vi.stubGlobal("localStorage", {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
  });
}

describe("theme mode contract", () => {
  beforeEach(async () => {
    vi.resetModules();
    stubDom();
    const mod = await import("../../src/store/themeStore.js");
    store = mod.default;
    globalThis.__THEME_IDS__ = mod.THEME_IDS;
    globalThis.__applyTheme__ = mod.applyTheme;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("only knows Glass as the active theme ID", () => {
    expect(globalThis.__THEME_IDS__).toEqual(["glass"]);
  });

  it("applies theme strictly as .dark.glass", () => {
    globalThis.__applyTheme__();
    expect(classes.has("dark")).toBe(true);
    expect(classes.has("glass")).toBe(true);
  });

  it("locks theme strictly to glass on setTheme", async () => {
    const setTheme = store.getState().setTheme;

    await setTheme("dark");
    expect(store.getState().theme).toBe("glass");
    expect(classes.has("glass")).toBe(true);
    expect(classes.has("dark")).toBe(true);

    await setTheme("light");
    expect(store.getState().theme).toBe("glass");
    expect(classes.has("glass")).toBe(true);
    expect(classes.has("dark")).toBe(true);
  });

  it("toggleTheme always returns glass and preserves .dark.glass", () => {
    const { toggleTheme } = store.getState();

    expect(store.getState().theme).toBe("glass");

    const result = toggleTheme();
    expect(result).toBe("glass");
    expect(store.getState().theme).toBe("glass");
    expect(classes.has("glass")).toBe(true);
    expect(classes.has("dark")).toBe(true);
  });

  it("setServerTheme ensures glass is active", () => {
    classes.clear();
    store.getState().setServerTheme("dark");

    expect(store.getState().theme).toBe("glass");
    expect(classes.has("dark")).toBe(true);
    expect(classes.has("glass")).toBe(true);
  });
});
