import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getComboById: vi.fn(),
  updateCombo: vi.fn(),
}));
const leaderboard = vi.hoisted(() => ({
  fetchLeaderboardModels: vi.fn(),
  matchModelsWithLeaderboard: vi.fn(),
  validateIntelligenceConfig: vi.fn(),
}));
const models = vi.hoisted(() => ({ buildModelsList: vi.fn() }));

vi.mock("next/server", () => ({
  NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) },
}));
vi.mock("@/lib/db/repos/combosRepo", () => db);
vi.mock("@/lib/services/artificialAnalysis", () => leaderboard);
vi.mock("@/app/api/v1/models/route", () => models);
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: vi.fn() }));

const { POST } = await import("../../src/app/api/combos/[id]/refresh/route.js");

describe("intelligence combo manual refresh", () => {
  it("disables a combo when no configured provider models remain", async () => {
    const combo = {
      id: "combo-1",
      name: "top-models",
      updatedAt: "2026-10-08T00:00:00.000Z",
      config: { type: "intelligence", minScore: 60, maxScore: 70, refreshSchedule: "manual" },
    };
    db.getComboById.mockResolvedValue(combo);
    leaderboard.validateIntelligenceConfig.mockReturnValue(combo.config);
    leaderboard.fetchLeaderboardModels.mockResolvedValue([]);
    models.buildModelsList.mockResolvedValue([]);
    leaderboard.matchModelsWithLeaderboard.mockReturnValue({ models: [], details: [] });
    db.updateCombo.mockResolvedValue({ ...combo, models: [] });

    const response = await POST(new Request("http://localhost"), { params: Promise.resolve({ id: combo.id }) });

    expect(db.updateCombo).toHaveBeenCalledWith(
      combo.id,
      expect.objectContaining({ models: [], config: expect.objectContaining({ matchedDetails: [] }) }),
      { expectedUpdatedAt: combo.updatedAt }
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, disabled: true, newModelsCount: 0 });
  });

  it("does not overwrite a combo edited while the refresh was resolving models", async () => {
    const combo = {
      id: "combo-1",
      name: "top-models",
      updatedAt: "2026-10-08T00:00:00.000Z",
      config: { type: "intelligence", minScore: 60, maxScore: 70, refreshSchedule: "manual" },
    };
    db.getComboById.mockResolvedValue(combo);
    leaderboard.validateIntelligenceConfig.mockReturnValue(combo.config);
    leaderboard.fetchLeaderboardModels.mockResolvedValue([]);
    models.buildModelsList.mockResolvedValue([{ id: "new-model" }]);
    leaderboard.matchModelsWithLeaderboard.mockReturnValue({
      models: ["new-model"],
      details: [{ model: "new-model", score: 65 }],
    });
    db.updateCombo.mockResolvedValue(null);

    const response = await POST(new Request("http://localhost"), { params: Promise.resolve({ id: combo.id }) });

    expect(db.updateCombo).toHaveBeenCalledWith(
      combo.id,
      expect.objectContaining({ models: ["new-model"] }),
      { expectedUpdatedAt: combo.updatedAt }
    );
    expect(response).toEqual({
      status: 409,
      body: { error: "Combo changed while refreshing; retry the refresh" },
    });
  });
});
