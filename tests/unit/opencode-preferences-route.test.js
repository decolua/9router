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
});
