import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(() => true),
}));

describe("GET /api/9remote/status", () => {
  const originalEnabled = process.env.NINE_REMOTE_ENABLED;
  const originalPublicEnabled = process.env.NEXT_PUBLIC_NINE_REMOTE_ENABLED;

  beforeEach(() => {
    delete process.env.NINE_REMOTE_ENABLED;
    delete process.env.NEXT_PUBLIC_NINE_REMOTE_ENABLED;
  });

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.NINE_REMOTE_ENABLED;
    else process.env.NINE_REMOTE_ENABLED = originalEnabled;

    if (originalPublicEnabled === undefined) delete process.env.NEXT_PUBLIC_NINE_REMOTE_ENABLED;
    else process.env.NEXT_PUBLIC_NINE_REMOTE_ENABLED = originalPublicEnabled;
  });

  it("returns disabled by default", async () => {
    const mod = await import("../../src/app/api/9remote/status/route.js");

    const response = await mod.GET();

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      enabled: false,
      installed: false,
      running: false,
    });
  });
});
