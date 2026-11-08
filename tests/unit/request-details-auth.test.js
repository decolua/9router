import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/usageDb", () => ({
  getRequestDetailById: vi.fn(async (id) =>
    id === "detail-1" ? { id, provider: "zcode", request: { messages: [{ role: "user", content: "hi" }] } } : null
  ),
}));

import { GET } from "@/app/api/usage/request-details/[id]/route.js";
import { createDashboardAuthToken } from "@/lib/auth/dashboardSession.js";

describe("request detail endpoint", () => {
  it("requires a dashboard session before returning payloads", async () => {
    const response = await GET(
      { cookies: { get: () => undefined } },
      { params: Promise.resolve({ id: "detail-1" }) }
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "auth_required" });
  });

  it("returns the full payload for a signed-in session", async () => {
    const token = await createDashboardAuthToken();
    const response = await GET(
      { cookies: { get: (name) => (name === "auth_token" ? { value: token } : undefined) } },
      { params: Promise.resolve({ id: "detail-1" }) }
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      detail: { id: "detail-1", request: { messages: [{ role: "user", content: "hi" }] } },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects an empty id", async () => {
    const response = await GET(
      { cookies: { get: () => undefined } },
      { params: Promise.resolve({ id: "   " }) }
    );
    expect(response.status).toBe(400);
  });
});
