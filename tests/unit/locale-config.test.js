import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_NAMES,
  isSupportedLocale,
  normalizeLocale,
} from "../../src/i18n/config.js";
import { LOCALE_FLAGS } from "../../src/shared/constants/locales.js";

const mocks = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: mocks.cookieSet })),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

const { POST } = await import("../../src/app/api/locale/route.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dashboard locale configuration", () => {
  it("exposes only English, Spanish, and Brazilian Portuguese", () => {
    expect(LOCALES).toEqual(["en", "es", "pt-BR"]);
    expect(Object.keys(LOCALE_NAMES)).toEqual(LOCALES);
    expect(Object.keys(LOCALE_FLAGS)).toEqual(LOCALES);
  });

  it("normalizes regional variants to a supported locale", () => {
    expect(normalizeLocale("en-US")).toBe("en");
    expect(normalizeLocale("es-MX")).toBe("es");
    expect(normalizeLocale("pt-PT")).toBe("pt-BR");
    expect(normalizeLocale("pt_BR")).toBe("pt-BR");
  });

  it("falls back to English for removed locales", () => {
    expect(normalizeLocale("fr")).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale("zh-CN")).toBe(DEFAULT_LOCALE);
    expect(isSupportedLocale("fr")).toBe(false);
  });
});

describe("POST /api/locale", () => {
  it("accepts Brazilian Portuguese", async () => {
    const response = await POST(new Request("http://localhost/api/locale", {
      method: "POST",
      body: JSON.stringify({ locale: "pt-BR" }),
    }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, locale: "pt-BR" });
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "locale",
      "pt-BR",
      expect.objectContaining({ path: "/" }),
    );
  });

  it("rejects a removed locale", async () => {
    const response = await POST(new Request("http://localhost/api/locale", {
      method: "POST",
      body: JSON.stringify({ locale: "fr" }),
    }));

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid locale");
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});
