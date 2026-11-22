/**
 * The entire UI is locked to the neobrutalism design system.
 * The light paper palette and neobrutalist geometry marker are applied before
 * paint and remain active after hydration; prior dark/glass markers are removed.
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

  it("only knows Neobrutalism as the active theme ID", () => {
    expect(globalThis.__THEME_IDS__).toEqual(["neobrutalism"]);
  });

  it("applies neobrutalism and removes the former dark/glass markers", () => {
    classes.add("dark", "glass", "brutalist");
    globalThis.__applyTheme__();
    expect(classes.has("neobrutalism")).toBe(true);
    expect(classes.has("dark")).toBe(false);
    expect(classes.has("brutalist")).toBe(false);
    expect(classes.has("glass")).toBe(false);
  });

  it("locks theme strictly to neobrutalism on setTheme", async () => {
    const setTheme = store.getState().setTheme;

    await setTheme("dark");
    expect(store.getState().theme).toBe("neobrutalism");
    expect(classes.has("neobrutalism")).toBe(true);
    expect(classes.has("glass")).toBe(false);

    await setTheme("light");
    expect(store.getState().theme).toBe("neobrutalism");
    expect(classes.has("neobrutalism")).toBe(true);
    expect(classes.has("glass")).toBe(false);
  });

  it("toggleTheme always returns the locked neobrutalism theme", () => {
    const { toggleTheme } = store.getState();

    expect(store.getState().theme).toBe("neobrutalism");

    const result = toggleTheme();
    expect(result).toBe("neobrutalism");
    expect(store.getState().theme).toBe("neobrutalism");
    expect(classes.has("neobrutalism")).toBe(true);
    expect(classes.has("glass")).toBe(false);
  });

  it("setServerTheme ensures neobrutalism is active", () => {
    classes.clear();
    store.getState().setServerTheme("dark");

    expect(store.getState().theme).toBe("neobrutalism");
    expect(classes.has("neobrutalism")).toBe(true);
    expect(classes.has("dark")).toBe(false);
    expect(classes.has("glass")).toBe(false);
  });
});
