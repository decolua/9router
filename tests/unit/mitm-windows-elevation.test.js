import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execSync: vi.fn(),
  getMitmStatus: vi.fn(),
  startServer: vi.fn(),
  stopServer: vi.fn(),
  enableToolDNS: vi.fn(),
  disableToolDNS: vi.fn(),
  trustCert: vi.fn(),
  getCachedPassword: vi.fn(),
  setCachedPassword: vi.fn(),
  loadEncryptedPassword: vi.fn(),
  isSudoPasswordRequired: vi.fn(),
  initDbHooks: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  jsonResponse: vi.fn((body, init) => ({
    status: init?.status || 200,
    body,
  })),
}));

vi.mock("child_process", () => ({
  execSync: mocks.execSync,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: mocks.jsonResponse,
  },
}));

vi.mock("@/mitm/manager", () => ({
  getMitmStatus: mocks.getMitmStatus,
  startServer: mocks.startServer,
  stopServer: mocks.stopServer,
  enableToolDNS: mocks.enableToolDNS,
  disableToolDNS: mocks.disableToolDNS,
  trustCert: mocks.trustCert,
  getCachedPassword: mocks.getCachedPassword,
  setCachedPassword: mocks.setCachedPassword,
  loadEncryptedPassword: mocks.loadEncryptedPassword,
  isSudoPasswordRequired: mocks.isSudoPasswordRequired,
  initDbHooks: mocks.initDbHooks,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}));

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

function setPlatform(value) {
  Object.defineProperty(process, "platform", { value });
}

function requestJson(body) {
  return {
    json: vi.fn().mockResolvedValue(body),
  };
}

describe("MITM Windows elevation route handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    setPlatform("win32");
    mocks.execSync.mockImplementation(() => {
      throw new Error("not elevated");
    });
    mocks.getCachedPassword.mockReturnValue(null);
    mocks.loadEncryptedPassword.mockResolvedValue("");
    mocks.startServer.mockResolvedValue({ running: true, pid: 1234 });
  });

  afterEach(() => {
    if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
  });

  it("does not reject Windows MITM start before UAC-capable helpers can run", async () => {
    const { POST } = await import("../../src/app/api/cli-tools/antigravity-mitm/route.js");

    const response = await POST(requestJson({ apiKey: "sk-test" }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, running: true, pid: 1234 });
    expect(mocks.startServer).toHaveBeenCalledWith("sk-test", "", false);
  });
});
