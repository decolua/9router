import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../../src/lib/dataDir.js";
import {
  getAihotLeaderboardCatalog,
  readCachedLeaderboardModels,
} from "../../src/lib/aihot/leaderboardScraper.js";

const CACHE_FILE = path.join(DATA_DIR, "aihot-leaderboard-models.json");

describe("aihot leaderboardScraper", () => {
  it("exports the expected functions", () => {
    expect(typeof getAihotLeaderboardCatalog).toBe("function");
    expect(typeof readCachedLeaderboardModels).toBe("function");
  });

  it("reads from cache when cache file exists and is fresh", async () => {
    // Write mock cache
    const mockData = {
      fetchedAt: new Date().toISOString(),
      count: 2,
      models: [
        { slug: "claude-opus-5-5", name: "Claude Opus 5.5", rawAliases: [], categories: ["coding"] },
        { slug: "gpt-6-astra", name: "GPT-6 Astra", rawAliases: [], categories: ["general"] },
      ],
    };
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(mockData), "utf8");

    const cached = readCachedLeaderboardModels();
    expect(cached).toBeDefined();
    expect(cached.count).toBe(2);

    const catalog = await getAihotLeaderboardCatalog({ force: false });
    expect(catalog.fromCache).toBe(true);
    expect(catalog.models).toHaveLength(2);
    expect(catalog.models[0].slug).toBe("claude-opus-5-5");
  });
});
