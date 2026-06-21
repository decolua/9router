import { normalizeApiKeyUsageId, normalizeUsageDailySummary } from "../helpers/apiKeyUsageId.js";

export default {
  version: 2,
  name: "normalize usage api keys",
  up(db) {
    const historyRows = db.all(`SELECT id, apiKey FROM usageHistory WHERE apiKey IS NOT NULL AND apiKey != ''`);
    for (const row of historyRows) {
      const normalized = normalizeApiKeyUsageId(row.apiKey);
      if (normalized && normalized !== row.apiKey) {
        db.run(`UPDATE usageHistory SET apiKey = ? WHERE id = ?`, [normalized, row.id]);
      }
    }

    const dailyRows = db.all(`SELECT dateKey, data FROM usageDaily`);
    for (const row of dailyRows) {
      let day;
      try { day = JSON.parse(row.data || "{}"); } catch { continue; }
      const next = normalizeUsageDailySummary(day);
      const serialized = JSON.stringify(next);
      if (serialized !== row.data) {
        db.run(`UPDATE usageDaily SET data = ? WHERE dateKey = ?`, [serialized, row.dateKey]);
      }
    }
  },
};
