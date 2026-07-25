import { getAdapter } from "@/lib/db/driver.js";
import { disableModels } from "@/lib/db/repos/disabledModelsRepo.js";

const SCOPE_FAILURES = "modelFailureCount";

// HTTP-коды, которые НЕ считаются «битостью» модели
const EXPECTED_CODES = [401, 403, 429, 402, 451];

function isRealFailure(m) {
  if (m.ok || m.status === "ok" || (m.avgScore != null && m.avgScore > 0)) return false;
  if (!m.error && !m.status) return false;
  const err = (m.error || "").toLowerCase();
  const status = m.status || m.httpStatus || 0;
  // Embedding models that don't support chat — не битые, просто не чат
  if (err.includes("does not support generate") || err.includes("embed")) return false;
  // Известные HTTP-коды — не битые
  if (EXPECTED_CODES.includes(status)) return false;
  if (err.includes("401") || err.includes("unauthorized") || err.includes("auth")) return false;
  if (err.includes("403") || err.includes("forbidden") || err.includes("access denied") || err.includes("subscription")) return false;
  if (err.includes("429") || err.includes("rate limit") || err.includes("too many")) return false;
  if (err.includes("402") || err.includes("payment") || err.includes("quota")) return false;
  if (err.includes("missing api key") || err.includes("no credits")) return false;
  if (err.includes("model is disabled")) return false;
  return true;
}

export async function cleanupBrokenModels() {
  const db = await getAdapter();

  // Read latest scan + ping results
  let allModels = [];
  for (const key of ["scanLastResults", "pingLastResults"]) {
    let row = null;
    if (typeof db.get === "function") {
      row = db.get("SELECT value FROM kv WHERE scope=? AND key=?", ["orchestrator", key]);
    }
    if (!row) continue;
    const data = JSON.parse(row.value);
    if (key === "scanLastResults" && data.ranking) {
      allModels = allModels.concat(data.ranking.map(m => ({
        provider: m.provider, model: m.model, ok: m.avgScore > 0, error: m.error,
        status: m.error ? 0 : 200
      })));
    }
    if (key === "pingLastResults" && data.results) {
      allModels = allModels.concat(data.results.map(r => ({
        provider: r.provider, model: r.model, ok: r.success, error: r.error, status: r.statusCode || 0
      })));
    }
  }

  // Read current failure counts
  const failures = {};
  const failureRows = typeof db.all === "function"
    ? db.all("SELECT key, value FROM kv WHERE scope=?", [SCOPE_FAILURES])
    : [];
  for (const r of failureRows) {
    failures[r.key] = JSON.parse(r.value);
  }

  const toDisable = [];

  for (const m of allModels) {
    const key = `${m.provider}:${m.model}`;
    if (isRealFailure(m)) {
      failures[key] = (failures[key] || 0) + 1;
    } else if (m.ok) {
      failures[key] = 0;
    }
  }

  // Collect models with 3+ real failures
  for (const [key, count] of Object.entries(failures)) {
    if (count >= 3) {
      const colonIdx = key.indexOf(":");
      toDisable.push({ provider: key.slice(0, colonIdx), model: key.slice(colonIdx + 1) });
    }
  }

  // Persist updated failure counts
  if (typeof db.run === "function") {
    for (const [key, count] of Object.entries(failures)) {
      if (count > 0) {
        db.run(
          "INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value",
          [SCOPE_FAILURES, key, JSON.stringify(count)]
        );
      } else {
        db.run("DELETE FROM kv WHERE scope=? AND key=?", [SCOPE_FAILURES, key]);
      }
    }
  }

  // Disable models with 3+ failures
  const disabled = [];
  for (const { provider, model } of toDisable) {
    try {
      await disableModels(provider, [model]);
      disabled.push(`${provider}/${model}`);
    } catch (e) {
      console.log(`[cleanup-broken] Failed to disable ${provider}/${model}:`, e.message);
    }
  }

  return { disabled, totalDisabled: disabled.length };
}
