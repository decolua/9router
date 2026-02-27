import { NextResponse } from "next/server";
import { getRequestDetailsDb } from "@/lib/requestDetailsDb";

// Cache for 30 seconds
export const revalidate = 30;

/**
 * GET /api/usage/model-speed
 * Returns aggregated speed stats (tokens/s) per model, computed from logged request details.
 */
export async function GET() {
  try {
    const db = await getRequestDetailsDb();

    // Fetch all successful requests that have latency + completion tokens
    // Use the prepare helper pattern from requestDetailsDb
    const prepStmt = typeof db.prepare === "function"
      ? db.prepare.bind(db)
      : typeof db.query === "function"
        ? db.query.bind(db)
        : null;

    if (!prepStmt) {
      return NextResponse.json({ models: [] });
    }

    const stmt = prepStmt(
      `SELECT provider, model, latency, tokens, timestamp
       FROM request_details
       WHERE status = 'success'
       ORDER BY timestamp DESC`
    );

    const rows = stmt.all();

    const safeJsonParse = (str, fallback = {}) => {
      try { return JSON.parse(str || "{}"); }
      catch { return fallback; }
    };

    // Aggregate per (provider, model) pair
    const modelMap = {};

    for (const row of rows) {
      const latency = safeJsonParse(row.latency);
      const tokens = safeJsonParse(row.tokens);
      const totalMs = latency?.total || 0;
      // Support both OpenAI (completion_tokens) and Claude (output_tokens) formats
      const completionTokens = tokens?.completion_tokens ?? tokens?.output_tokens ?? 0;

      if (totalMs <= 0 || completionTokens <= 0) continue;

      const speed = completionTokens / (totalMs / 1000); // tokens per second
      const key = `${row.provider}|||${row.model}`;

      if (!modelMap[key]) {
        modelMap[key] = {
          provider: row.provider,
          model: row.model,
          totalSpeed: 0,
          sampleCount: 0,
          minSpeed: Infinity,
          maxSpeed: 0,
          lastUsed: null,
        };
      }

      const entry = modelMap[key];
      entry.totalSpeed += speed;
      entry.sampleCount += 1;
      entry.minSpeed = Math.min(entry.minSpeed, speed);
      entry.maxSpeed = Math.max(entry.maxSpeed, speed);
      if (!entry.lastUsed || new Date(row.timestamp) > new Date(entry.lastUsed)) {
        entry.lastUsed = new Date(row.timestamp).toISOString();
      }
    }

    const models = Object.values(modelMap).map((m) => ({
      provider: m.provider,
      model: m.model,
      avgSpeed: m.sampleCount > 0 ? m.totalSpeed / m.sampleCount : 0,
      minSpeed: m.minSpeed === Infinity ? 0 : m.minSpeed,
      maxSpeed: m.maxSpeed,
      sampleCount: m.sampleCount,
      lastUsed: m.lastUsed,
    }));

    // Sort by avg speed descending
    models.sort((a, b) => b.avgSpeed - a.avgSpeed);

    return NextResponse.json({ models });
  } catch (error) {
    console.error("[API] Failed to get model speed stats:", error);
    return NextResponse.json(
      { models: [], error: "Failed to load model speed data" },
      { status: 500 }
    );
  }
}
