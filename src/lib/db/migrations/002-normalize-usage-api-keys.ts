import type { Migration } from "./001-initial.js";
import { normalizeApiKeyUsageId, normalizeUsageDailySummary } from "../helpers/apiKeyUsageId.js";

const m002NormalizeUsageApiKeys: Migration = {
  version: 2,
  name: "normalize usage api keys",
  up(db) {
    const historyRows = db.all(
      `SELECT id, apiKey FROM usageHistory WHERE apiKey IS NOT NULL AND apiKey != ''`,
    ) as { id: number; apiKey: string }[];
    for (const row of historyRows) {
      const normalized = normalizeApiKeyUsageId(row.apiKey);
      if (normalized && normalized !== row.apiKey) {
        db.run(`UPDATE usageHistory SET apiKey = ? WHERE id = ?`, [normalized, row.id]);
      }
    }

    const dailyRows = db.all(`SELECT dateKey, data FROM usageDaily`) as {
      dateKey: string;
      data: string;
    }[];
    for (const row of dailyRows) {
      let day: unknown;
      try { day = JSON.parse(row.data || "{}"); } catch { continue; }
      const next = normalizeUsageDailySummary(day);
      const serialized = JSON.stringify(next);
      if (serialized !== row.data) {
        db.run(`UPDATE usageDaily SET data = ? WHERE dateKey = ?`, [serialized, row.dateKey]);
      }
    }
  },
};
export default m002NormalizeUsageApiKeys;
