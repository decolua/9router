// v3: Backfill ttft and totalLatency from requestDetails into usageHistory,
// and recompute usageDaily latency sums from the backfilled usageHistory rows.
// requestDetails already stores latency data per request as JSON in the `data`
// column. This migration copies those values into the new columns added by v2,
// keyed by matching (timestamp, provider, model) between the two tables.
// Idempotent: re-run safe — only updates rows where ttft == 0 and a match exists.
export default {
  version: 3,
  name: "backfill-latency-from-request-details",
  up(db) {
    // 1. Copy latency from requestDetails → usageHistory
    const rows = db.all(
      `SELECT DISTINCT uh.id, rd.data
         FROM usageHistory uh
         JOIN requestDetails rd
           ON rd.timestamp = uh.timestamp
          AND rd.provider = uh.provider
          AND rd.model = uh.model
        WHERE uh.ttft = 0
          AND rd.data IS NOT NULL
          AND rd.data != ''`
    );

    let updated = 0;
    for (const row of rows) {
      try {
        const detail = JSON.parse(row.data || "{}");
        const ttft = Number(detail.latency?.ttft) || 0;
        const total = Number(detail.latency?.total) || 0;
        if (ttft > 0 || total > 0) {
          db.run(
            `UPDATE usageHistory SET ttft = ?, totalLatency = ? WHERE id = ?`,
            [ttft, total, row.id]
          );
          updated++;
        }
      } catch {
        // Malformed JSON — skip
      }
    }
    console.log(`[DB][migrate] v3 backfilled ${updated} usageHistory rows with latency`);

    // 2. Recompute usageDaily latency sums from backfilled usageHistory rows,
    //    using the same local-time dateKey as usageRepo.getLocalDateKey.
    const dailyRows = db.all(`SELECT dateKey, data FROM usageDaily WHERE data IS NOT NULL AND data != ''`);
    if (dailyRows.length) {
      const sums = {}; // dateKey -> { ttftSum, totalLatencySum }
      const hist = db.all(`SELECT timestamp, ttft, totalLatency FROM usageHistory WHERE ttft > 0 OR totalLatency > 0`);
      for (const h of hist) {
        const d = new Date(h.timestamp);
        if (Number.isNaN(d.getTime())) continue;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        sums[key] ||= { ttftSum: 0, totalLatencySum: 0 };
        sums[key].ttftSum += h.ttft || 0;
        sums[key].totalLatencySum += h.totalLatency || 0;
      }

      let dailyUpdated = 0;
      for (const dr of dailyRows) {
        try {
          const day = JSON.parse(dr.data || "{}");
          const s = sums[dr.dateKey] || { ttftSum: 0, totalLatencySum: 0 };
          if (day.ttftSum === s.ttftSum && day.totalLatencySum === s.totalLatencySum) continue;
          day.ttftSum = s.ttftSum;
          day.totalLatencySum = s.totalLatencySum;
          db.run(`UPDATE usageDaily SET data = ? WHERE dateKey = ?`, [JSON.stringify(day), dr.dateKey]);
          dailyUpdated++;
        } catch {
          // Malformed JSON — skip
        }
      }
      console.log(`[DB][migrate] v3 backfilled ${dailyUpdated} usageDaily rows with latency sums`);
    }
  },
};