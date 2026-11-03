import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  stopHeadroomProxy: vi.fn(),
}));

vi.mock("@/lib/localDb.js", () => ({
  getSettings: mocks.getSettings,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
}));

vi.mock("@/lib/headroom/process.js", () => ({
  stopHeadroomProxy: mocks.stopHeadroomProxy,
}));

vi.mock("@/lib/headroom/process", () => ({
  stopHeadroomProxy: mocks.stopHeadroomProxy,
}));

vi.mock("@/lib/headroom/detect.js", () => ({
  DEFAULT_HEADROOM_URL: "http://localhost:8787",
  isLoopbackHeadroomUrl: vi.fn((url) => {
    try {
      const u = new URL(url);
      return ["localhost", "127.0.0.1", "::1"].includes(u.hostname);
    } catch {
      return false;
    }
  }),
  parsePortFromUrl: vi.fn((url) => {
    try {
      const u = new URL(url);
      return u.port ? parseInt(u.port, 10) : 8787;
    } catch {
      return 8787;
    }
  }),
}));

vi.mock("@/lib/headroom/detect", () => ({
  DEFAULT_HEADROOM_URL: "http://localhost:8787",
  isLoopbackHeadroomUrl: vi.fn((url) => {
    try {
      const u = new URL(url);
      return ["localhost", "127.0.0.1", "::1"].includes(u.hostname);
    } catch {
      return false;
    }
  }),
  parsePortFromUrl: vi.fn((url) => {
    try {
      const u = new URL(url);
      return u.port ? parseInt(u.port, 10) : 8787;
    } catch {
      return 8787;
    }
  }),
}));

import { POST } from "../../src/app/api/headroom/stop/route.js";

describe("POST /api/headroom/stop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects stopping when configured headroom URL is external", async () => {
    mocks.getSettings.mockResolvedValue({ headroomUrl: "https://external.headroom.ai:8787" });

    const res = await POST();
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe("EXTERNAL_PROXY");
    expect(data.error).toContain("External Headroom proxies must be stopped outside 9Router");
    expect(mocks.stopHeadroomProxy).not.toHaveBeenCalled();
  });

  it("calls stopHeadroomProxy when configured URL is loopback", async () => {
    mocks.getSettings.mockResolvedValue({ headroomUrl: "http://127.0.0.1:8787" });
    mocks.stopHeadroomProxy.mockReturnValue({ stopped: true, pid: 12345 });

    const res = await POST();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.stopped).toBe(true);
    expect(mocks.stopHeadroomProxy).toHaveBeenCalledWith({ port: 8787 });
  });
});
