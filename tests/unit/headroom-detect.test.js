import { describe, it, expect, vi, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  execSync: vi.fn(() => { throw new Error("not found"); }),
}));

vi.mock("child_process", () => ({
  execSync: mocks.execSync,
}));

import { getHeadroomStatus, isLoopbackHeadroomUrl } from "../../src/lib/headroom/detect.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("headroom detect", () => {
  it("treats a reachable external proxy as running without local CLI", async () => {
    global.fetch = vi.fn(async () => new Response("ok", { status: 200 }));

    const status = await getHeadroomStatus("http://headroom:8787");

    expect(status.installed).toBe(false);
    expect(status.running).toBe(true);
    expect(status.localUrl).toBe(false);
    expect(status.canStart).toBe(false);
    expect(global.fetch).toHaveBeenCalledWith("http://headroom:8787/health", expect.any(Object));
  });

  it("recognizes loopback URLs for managed local mode", () => {
    expect(isLoopbackHeadroomUrl("http://localhost:8787")).toBe(true);
    expect(isLoopbackHeadroomUrl("http://127.0.0.1:8787")).toBe(true);
    expect(isLoopbackHeadroomUrl("http://headroom:8787")).toBe(false);
    expect(isLoopbackHeadroomUrl("not-a-url")).toBe(false);
  });
});
