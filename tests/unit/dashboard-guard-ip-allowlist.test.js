import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(() => ({ type: "next", status: 200 })),
    json: vi.fn((body, init) => ({
      type: "json",
      status: init?.status || 200,
      body,
    })),
    redirect: vi.fn((url) => ({
      type: "redirect",
      status: 307,
      location: String(url),
    })),
  },
}));

vi.mock("jose", () => ({
  jwtVerify: vi.fn(async () => ({ payload: {} })),
}));

describe("dashboardGuard IP allowlist", () => {
  const originalEnabled = process.env.IP_ALLOWLIST_ENABLED;
  const originalAllowlist = process.env.IP_ALLOWLIST;

  beforeEach(() => {
    process.env.IP_ALLOWLIST_ENABLED = "true";
    process.env.IP_ALLOWLIST = "203.0.113.10";
  });

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.IP_ALLOWLIST_ENABLED;
    else process.env.IP_ALLOWLIST_ENABLED = originalEnabled;

    if (originalAllowlist === undefined) delete process.env.IP_ALLOWLIST;
    else process.env.IP_ALLOWLIST = originalAllowlist;
  });

  it("blocks non-allowlisted requests before they reach app routes", async () => {
    const { proxy } = await import("../../src/dashboardGuard.js");

    const response = await proxy({
      headers: new Headers({
        host: "app.example.com",
        "x-forwarded-for": "198.51.100.20",
      }),
      nextUrl: {
        pathname: "/v1/responses",
        origin: "https://app.example.com",
      },
      cookies: { get: () => undefined },
      url: "https://app.example.com/v1/responses",
    });

    expect(response).toEqual({
      type: "json",
      status: 403,
      body: { error: "Forbidden" },
    });
  });

  it("lets allowlisted requests continue to the target route", async () => {
    const { proxy } = await import("../../src/dashboardGuard.js");

    const response = await proxy({
      headers: new Headers({
        host: "app.example.com",
        "x-forwarded-for": "203.0.113.10",
      }),
      nextUrl: {
        pathname: "/v1/responses",
        origin: "https://app.example.com",
      },
      cookies: { get: () => undefined },
      url: "https://app.example.com/v1/responses",
    });

    expect(response).toEqual({
      type: "next",
      status: 200,
    });
  });
});
