import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPreferredLocale, savePreferredLocale } from "../../src/i18n/preference.js";
import { getCurrentLocale, initRuntimeI18n, translate } from "../../src/i18n/runtime.js";

describe("dashboard locale preference", () => {
  beforeEach(() => {
    const values = new Map();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
      },
    });
    vi.stubGlobal("document", {
      cookie: "",
      body: {},
      createTreeWalker: () => ({ nextNode: () => null }),
    });
    vi.stubGlobal("NodeFilter", { SHOW_TEXT: 4 });
    vi.stubGlobal("MutationObserver", class { observe() {} });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it("loads the chosen translations when the browser comes back without a locale cookie", async () => {
    fetch.mockResolvedValueOnce(Response.json({ success: true, locale: "zh-CN" }));
    fetch.mockResolvedValueOnce(Response.json({ Settings: "设置" }));

    await savePreferredLocale("zh-CN");
    expect(fetch).toHaveBeenCalledWith("/api/locale", expect.objectContaining({
      method: "POST", body: JSON.stringify({ locale: "zh-CN" }),
    }));
    expect(document.cookie).toBe("");
    await initRuntimeI18n();
    expect(fetch).toHaveBeenLastCalledWith("/i18n/literals/zh-CN.json");
    expect(getCurrentLocale()).toBe("zh-CN");
    expect(translate("Settings")).toBe("设置");
  });

  it("prefers the last saved language when an older cookie remains", async () => {
    document.cookie = "locale=en";
    fetch.mockResolvedValueOnce(Response.json({ success: true, locale: "zh-CN" }));
    await savePreferredLocale("zh-CN");
    expect(getPreferredLocale()).toBe("zh-CN");
  });

  it("keeps the existing cookie preference when no browser preference is saved", () => {
    document.cookie = "other=1; locale=zh-TW";
    expect(getPreferredLocale()).toBe("zh-TW");
  });

  it("uses the cookie when localStorage is blocked", async () => {
    Object.defineProperty(window, "localStorage", { get: () => { throw new Error("Storage is blocked"); } });
    document.cookie = "locale=ko";
    fetch.mockResolvedValueOnce(Response.json({ success: true, locale: "ko" }));
    await expect(savePreferredLocale("ko")).resolves.toBeUndefined();
    expect(getPreferredLocale()).toBe("ko");
  });

  it("does not save a rejected language change", async () => {
    document.cookie = "locale=ko";
    fetch.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(savePreferredLocale("zh-CN")).rejects.toThrow("Locale update failed (500)");
    expect(getPreferredLocale()).toBe("ko");
  });

  it("defaults to English when the cookie is malformed", () => {
    document.cookie = "locale=%ZZ";
    expect(getPreferredLocale()).toBe("en");
  });
});
