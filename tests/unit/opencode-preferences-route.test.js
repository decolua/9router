import { beforeEach, describe, expect, it, vi } from "vitest";

const getOpenCodePreferences = vi.fn();
const updateOpenCodePreferences = vi.fn();

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

vi.mock("@/models", () => ({
  getOpenCodePreferences,
  updateOpenCodePreferences,
}));

vi.mock("@/lib/opencodeSync/schema.js", async () => {
  const actual = await vi.importActual("../../src/lib/opencodeSync/schema.js");
  return actual;
});

let GET;
let PATCH;

describe("/api/opencode/preferences", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../src/app/api/opencode/preferences/route.js");
    GET = mod.GET;
    PATCH = mod.PATCH;
  });

  it("redacts secret env vars on GET", async () => {
    getOpenCodePreferences.mockResolvedValue({
      variant: "openagent",
      envVars: [
        { key: "PUBLIC_FLAG", value: "enabled", secret: false },
        { key: "API_KEY", value: "super-secret", secret: true },
      ],
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.preferences.envVars).toEqual([
      { key: "API_KEY", value: "********", secret: true },
      { key: "PUBLIC_FLAG", value: "enabled", secret: false },
    ]);
  });

  it("rejects invalid PATCH payloads with 400", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/opencode/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(["not-an-object"]),
      })
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid preferences payload" });
    expect(updateOpenCodePreferences).not.toHaveBeenCalled();
  });

  it("returns validation errors from persisted partial updates", async () => {
    updateOpenCodePreferences.mockRejectedValue(new Error("Invalid OpenCode variant"));

    const response = await PATCH(
      new Request("http://localhost/api/opencode/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ variant: "bad" }),
      })
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid OpenCode variant" });
  });

  it("persists valid partial PATCH payloads and returns sanitized preferences", async () => {
    const partialPayload = {
      envVars: [
        { key: "PUBLIC_FLAG", value: "enabled", secret: false },
        { key: "API_KEY", value: "super-secret", secret: true },
      ],
    };

    updateOpenCodePreferences.mockResolvedValue({
      variant: "openagent",
      ...partialPayload,
    });

    const response = await PATCH(
      new Request("http://localhost/api/opencode/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(partialPayload),
      })
    );

    expect(response.status).toBe(200);
    expect(updateOpenCodePreferences).toHaveBeenCalledWith(partialPayload);
    expect(response.body.preferences.variant).toBe("openagent");
    expect(response.body.preferences.envVars).toEqual([
      { key: "API_KEY", value: "********", secret: true },
      { key: "PUBLIC_FLAG", value: "enabled", secret: false },
    ]);
  });

  it("redacts nested sensitive override values on PATCH responses", async () => {
    updateOpenCodePreferences.mockResolvedValue({
      variant: "custom",
      customTemplate: "minimal",
      advancedOverrides: {
        custom: {
          headers: {
            Authorization: "Bearer secret",
          },
        },
      },
    });

    const response = await PATCH(
      new Request("http://localhost/api/opencode/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ advancedOverrides: { custom: { headers: { Authorization: "Bearer secret" } } } }),
      })
    );

    expect(response.status).toBe(200);
    expect(response.body.preferences.advancedOverrides.custom.headers.Authorization).toBe("********");
  });
});
