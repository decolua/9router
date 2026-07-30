import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  key: { id: "key-1", tokenLimit: 100, tokensUsed: 40, allowedModels: ["ag/gemini-3-flash-agent"] },
  get: vi.fn(),
  update: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status || 200 }),
  },
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeyById: (...args) => db.get(...args),
  updateApiKey: (...args) => db.update(...args),
  deleteApiKey: vi.fn(),
}));

const { PUT } = await import("@/app/api/keys/[id]/route.js");
const context = { params: Promise.resolve({ id: "key-1" }) };

describe("API key edit route", () => {
  beforeEach(() => {
    db.get.mockResolvedValue(db.key);
    db.update.mockResolvedValue({ ...db.key, tokenLimit: 150, expiresAt: "2026-12-01T00:00:00.000Z", allowedModels: ["ag/gemini-3-flash-agent", "zd/claude-sonnet-4.6"] });
    db.update.mockClear();
  });

  it("passes expiry, models, and a token top-up without accepting client usage changes", async () => {
    const response = await PUT(new Request("http://router.test/api/keys/key-1", {
      method: "PUT",
      body: JSON.stringify({
        expiresAt: "2026-12-01T00:00:00Z",
        allowedModels: ["ag/gemini-3-flash-agent", "zd/claude-sonnet-4.6"],
        tokenLimitIncrement: 50,
        tokensUsed: 0,
      }),
    }), context);
    expect(response.status).toBe(200);
    expect(db.update).toHaveBeenCalledWith("key-1", {
      expiresAt: "2026-12-01T00:00:00Z",
      allowedModels: ["ag/gemini-3-flash-agent", "zd/claude-sonnet-4.6"],
      tokenLimitIncrement: 50,
    });
  });

  it("returns 400 when adding tokens to an unlimited key is rejected", async () => {
    db.update.mockRejectedValueOnce(new Error("Cannot add tokens to an unlimited key; set a token limit first"));
    const response = await PUT(new Request("http://router.test/api/keys/key-1", {
      method: "PUT", body: JSON.stringify({ tokenLimitIncrement: 50 }),
    }), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Cannot add tokens to an unlimited key; set a token limit first" });
  });
});
