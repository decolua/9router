import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockChromiumLaunch = vi.fn();
const mockFirefoxLaunch = vi.fn();
const mockCloakbrowserLaunch = vi.fn();
const mockInstallPlaywrightOnly = vi.fn();
const mockInstallCloakbrowserOnly = vi.fn();

vi.mock("playwright", () => ({
  chromium: { launch: mockChromiumLaunch },
  firefox: { launch: mockFirefoxLaunch },
}));

vi.mock("playwright-core", () => ({
  firefox: { launch: mockFirefoxLaunch },
}));

vi.mock("cloakbrowser", () => ({
  launch: mockCloakbrowserLaunch,
}));

vi.mock("../../../../cli/hooks/playwrightRuntime", () => ({
  installPlaywrightOnly: mockInstallPlaywrightOnly,
  ensurePlaywrightRuntime: vi.fn(() => ({ ok: true })),
}));

vi.mock("../../../../cli/hooks/cloakbrowserRuntime", () => ({
  installCloakbrowserOnly: mockInstallCloakbrowserOnly,
  ensureCloakbrowserRuntime: vi.fn(() => ({ ok: true })),
  loadCloakbrowserModule: vi.fn(() => ({ launch: mockCloakbrowserLaunch })),
}));

import {
  buildBrowserProxyOption,
  launchBulkImportBrowser,
  normalizeBulkImportEngine,
  resolveRuntimeModuleDir,
  DEFAULT_BULK_IMPORT_ENGINE,
} from "../../src/lib/oauth/services/bulkImportBrowserEngine.js";

beforeEach(() => {
  globalThis.__bulkImportBrowserRuntimeHelpers = {
    playwrightRuntime: {
      installPlaywrightOnly: mockInstallPlaywrightOnly,
      ensurePlaywrightRuntime: vi.fn(() => ({ ok: true })),
      loadPlaywrightModule: vi.fn(() => ({
        chromium: { launch: mockChromiumLaunch },
        firefox: { launch: mockFirefoxLaunch },
      })),
    },
    cloakbrowserRuntime: {
      installCloakbrowserOnly: mockInstallCloakbrowserOnly,
      ensureCloakbrowserRuntime: vi.fn(() => ({ ok: true })),
      loadCloakbrowserModule: vi.fn(() => ({ launch: mockCloakbrowserLaunch })),
    },
  };
});

afterEach(() => {
  delete globalThis.__bulkImportBrowserRuntimeHelpers;
});

describe("normalizeBulkImportEngine", () => {
  it("returns chromium for unknown values", () => {
    expect(normalizeBulkImportEngine("unknown")).toBe("chromium");
    expect(normalizeBulkImportEngine(null)).toBe("chromium");
    expect(normalizeBulkImportEngine(undefined)).toBe("chromium");
  });

  it("returns chromium for 'chromium'", () => {
    expect(normalizeBulkImportEngine("chromium")).toBe("chromium");
    expect(normalizeBulkImportEngine("CHROMIUM")).toBe("chromium");
  });

  it("falls back to chromium for the removed camoufox engine", () => {
    expect(normalizeBulkImportEngine("camoufox")).toBe("chromium");
    expect(normalizeBulkImportEngine("CAMOUFOX")).toBe("chromium");
  });

  it("returns cloakbrowser for 'cloakbrowser'", () => {
    expect(normalizeBulkImportEngine("cloakbrowser")).toBe("cloakbrowser");
    expect(normalizeBulkImportEngine("CLOAKBROWSER")).toBe("cloakbrowser");
  });

  it("DEFAULT_BULK_IMPORT_ENGINE is chromium", () => {
    expect(DEFAULT_BULK_IMPORT_ENGINE).toBe("chromium");
  });
});

describe("resolveRuntimeModuleDir", () => {
  it("falls back when Next standalone exposes a virtual file URL on Windows", () => {
    expect(resolveRuntimeModuleDir("file:///_next/server/chunks/route.js")).toBe(process.cwd());
  });
});

describe("buildBrowserProxyOption", () => {
  it("splits credentials from the browser proxy server URL", () => {
    expect(buildBrowserProxyOption("socks5://user:pa;ss,word@134.209.102.0:10000")).toEqual({
      server: "socks5://134.209.102.0:10000",
      username: "user",
      password: "pa;ss,word",
    });
  });
});

describe("launchBulkImportBrowser — chromium engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: import playwright succeeds → chromium.launch called with headless:true", async () => {
    const mockBrowser = { close: vi.fn() };
    mockChromiumLaunch.mockResolvedValue(mockBrowser);

    const browser = await launchBulkImportBrowser({ engine: "chromium" });
    expect(browser).toBe(mockBrowser);
    expect(mockChromiumLaunch).toHaveBeenCalledWith({ headless: true });
    expect(mockInstallPlaywrightOnly).not.toHaveBeenCalled();
  });

  it("happy path with proxyUrl: proxy option passed to chromium.launch", async () => {
    const mockBrowser = { close: vi.fn() };
    mockChromiumLaunch.mockResolvedValue(mockBrowser);

    await launchBulkImportBrowser({ engine: "chromium", proxyUrl: "http://proxy:8080" });
    expect(mockChromiumLaunch).toHaveBeenCalledWith({
      headless: true,
      proxy: { server: "http://proxy:8080" },
    });
  });

  it("default engine is chromium", async () => {
    const mockBrowser = { close: vi.fn() };
    mockChromiumLaunch.mockResolvedValue(mockBrowser);

    await launchBulkImportBrowser();
    expect(mockChromiumLaunch).toHaveBeenCalled();
  });

  it("installPlaywrightOnly is NOT called when playwright import succeeds", async () => {
    mockChromiumLaunch.mockResolvedValue({ close: vi.fn() });

    await launchBulkImportBrowser({ engine: "chromium" });
    expect(mockInstallPlaywrightOnly).not.toHaveBeenCalled();
  });
});

describe("launchBulkImportBrowser — cloakbrowser engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes headless, args, and proxy options to cloakbrowser.launch", async () => {
    const mockBrowser = { close: vi.fn() };
    mockCloakbrowserLaunch.mockResolvedValue(mockBrowser);

    const browser = await launchBulkImportBrowser({
      engine: "cloakbrowser",
      proxyUrl: "http://proxy:8080",
      args: ["--fingerprint=123"],
    });

    expect(browser).toBe(mockBrowser);
    expect(mockCloakbrowserLaunch).toHaveBeenCalledWith({
      headless: true,
      args: ["--fingerprint=123"],
      proxy: { server: "http://proxy:8080" },
    });
  });
});
