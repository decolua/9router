import { NextResponse } from "next/server";
import { poolFitnessSnapshot } from "../../../../../open-sse/services/proxyPoolFitness.js";

const MAX_REASON_LENGTH = 256;
const URL_PATTERN = /(?:https?|ftp):\/\/[^\s"'<>]+/gi;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;

function sanitizeReason(reason) {
  return reason
    .replace(URL_PATTERN, "[REDACTED_URL]")
    .replace(BEARER_PATTERN, "[REDACTED_BEARER]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, MAX_REASON_LENGTH);
}

function publicFitnessSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return {};

  const pools = {};
  for (const [poolId, scopes] of Object.entries(snapshot)) {
    if (!scopes || typeof scopes !== "object" || Array.isArray(scopes)) continue;

    for (const [scope, entry] of Object.entries(scopes)) {
      if (
        !entry ||
        typeof entry !== "object" ||
        Array.isArray(entry) ||
        !Number.isFinite(entry.until) ||
        typeof entry.reason !== "string"
      ) continue;

      const pool = pools[poolId] || (pools[poolId] = {});
      pool[scope] = { until: entry.until, reason: sanitizeReason(entry.reason) };
    }
  }

  return pools;
}

// GET /api/proxy-pools/fitness
// Snapshot is automatically pruned during read
export async function GET() {
  try {
    const snapshot = await poolFitnessSnapshot();
    return NextResponse.json({ pools: publicFitnessSnapshot(snapshot) });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to read proxy fitness" },
      { status: 500 }
    );
  }
}
