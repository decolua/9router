import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({
    status: init?.status || 200,
    body,
  })),
  getSettings: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
}));

const { GET } = await import("../../src/app/api/settings/require-login/route.js");

describe("GET /api/settings/require-login public payload (B4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not leak tunnel/tailscale hostnames on the public allow-listed route", async () => {
    mocks.getSettings.mockResolvedValue({
      requireLogin: true,
      tunnelDashboardAccess: true,
      tunnelUrl: "https://abc-xyz.trycloudflare.com",
      tailscaleUrl: "https://myhost.tailnet.ts.net",
    });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("tunnelUrl");
    expect(res.body).not.toHaveProperty("tailscaleUrl");
    expect(res.body.requireLogin).toBe(true);
    expect(res.body.tunnelDashboardAccess).toBe(true);
  });

  it("keeps the fail-closed default when settings cannot be read", async () => {
    mocks.getSettings.mockRejectedValue(new Error("db down"));

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ requireLogin: true });
  });
});
