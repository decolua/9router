"use client";

// Client helpers for the persisted last-test status of routed models
// ("alias/modelId"). Backed by /api/models/test-results (kv scope modelTestResults).

export async function fetchModelTestResults() {
  try {
    const res = await fetch("/api/models/test-results", { cache: "no-store" });
    if (!res.ok) return {};
    const data = await res.json();
    return data.results || {};
  } catch {
    return {};
  }
}

// Fire-and-forget upsert — the UI never blocks on persistence.
export function saveModelTestResults(results) {
  if (!results || Object.keys(results).length === 0) return;
  fetch("/api/models/test-results", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ results }),
  }).catch(() => {});
}

export function clearModelTestResults(models) {
  if (!Array.isArray(models) || models.length === 0) return;
  fetch("/api/models/test-results", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ models }),
  }).catch(() => {});
}
