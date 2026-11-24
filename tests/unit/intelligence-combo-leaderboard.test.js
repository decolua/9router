import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) },
}));
vi.mock("@/lib/services/artificialAnalysis", () => ({
  fetchLeaderboardModels: vi.fn(),
  matchModelsWithLeaderboard: vi.fn(),
}));
vi.mock("@/app/api/v1/models/route", () => ({ buildModelsList: vi.fn() }));

const { GET } = await import("../../src/app/api/combos/leaderboard/route.js");

describe("intelligence leaderboard endpoint", () => {
  it("rejects malformed numeric query parameters before fetching the leaderboard", async () => {
    const response = await GET(new Request("http://localhost/api/combos/leaderboard?minScore=70oops"));

    expect(response).toEqual({
      status: 400,
      body: { success: false, error: "Minimum intelligence score must be a number" },
    });
  });
});
