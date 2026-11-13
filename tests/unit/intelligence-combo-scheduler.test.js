import { afterEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getCombos: vi.fn(async () => []),
  updateCombo: vi.fn(),
}));
const leaderboard = vi.hoisted(() => ({
  fetchLeaderboardModels: vi.fn(),
  matchModelsWithLeaderboard: vi.fn(),
  validateIntelligenceConfig: vi.fn(),
}));
const models = vi.hoisted(() => ({ buildModelsList: vi.fn() }));

vi.mock("@/lib/db/repos/combosRepo.js", () => db);
vi.mock("@/lib/services/artificialAnalysis.js", () => leaderboard);
vi.mock("@/app/api/v1/models/route.js", () => models);
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: vi.fn() }));

const { checkAndRefreshIntelligenceCombos, startComboScheduler, stopComboScheduler } = await import("../../src/lib/services/comboScheduler.js");

afterEach(() => {
  stopComboScheduler();
  vi.clearAllMocks();
});

describe("intelligence combo scheduler", () => {
  it("checks overdue combos as soon as the scheduler starts", async () => {
    startComboScheduler();
    await vi.waitFor(() => expect(db.getCombos).toHaveBeenCalledTimes(1));
  });

  it("disables an overdue combo when no configured provider models remain", async () => {
    const combo = {
      id: "combo-1",
      name: "top-models",
      models: ["old-model"],
      updatedAt: "2026-10-08T00:00:00.000Z",
      config: {
        type: "intelligence",
        minScore: 60,
        maxScore: 70,
        refreshSchedule: "daily",
      },
    };
    db.getCombos.mockResolvedValue([combo]);
    leaderboard.validateIntelligenceConfig.mockReturnValue(combo.config);
    leaderboard.fetchLeaderboardModels.mockResolvedValue([]);
    models.buildModelsList.mockResolvedValue([]);
    leaderboard.matchModelsWithLeaderboard.mockReturnValue({ models: [], details: [] });
    db.updateCombo.mockResolvedValue({ ...combo, models: [] });

    await checkAndRefreshIntelligenceCombos();

    expect(db.updateCombo).toHaveBeenCalledWith(
      combo.id,
      expect.objectContaining({ models: [], config: expect.objectContaining({ matchedDetails: [] }) }),
      { expectedUpdatedAt: combo.updatedAt }
    );
  });

  it("does not overwrite an intelligence combo that changed during refresh", async () => {
    const combo = {
      id: "combo-1",
      name: "top-models",
      models: ["old-model"],
      updatedAt: "2026-10-08T00:00:00.000Z",
      config: {
        type: "intelligence",
        minScore: 60,
        maxScore: 70,
        refreshSchedule: "daily",
      },
    };
    db.getCombos.mockResolvedValue([combo]);
    leaderboard.validateIntelligenceConfig.mockReturnValue(combo.config);
    leaderboard.fetchLeaderboardModels.mockResolvedValue([]);
    models.buildModelsList.mockResolvedValue([{ id: "new-model" }]);
    leaderboard.matchModelsWithLeaderboard.mockReturnValue({
      models: ["new-model"],
      details: [{ model: "new-model", score: 65 }],
    });

    await checkAndRefreshIntelligenceCombos();

    expect(db.updateCombo).toHaveBeenCalledWith(
      combo.id,
      expect.objectContaining({ models: ["new-model"] }),
      { expectedUpdatedAt: combo.updatedAt }
    );
  });
});
