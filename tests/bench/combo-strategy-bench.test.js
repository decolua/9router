// Combo strategy benchmark: weighted (random by weight) vs fallback (try in order).
// Measures model-selection distribution + token amplification under failure.
// Run with:  npx vitest run bench/combo-strategy-bench.test.js   (from tests/)
// Not wired into `npm test` — informational, prints tables, no failing assertions.
import { describe, it } from "vitest";
import { getRotatedModels } from "../../open-sse/services/combo.js";

const MODEL_BODY_BYTES = 120000; // ~120KB body per hop (matches user's real workload)

const COMBO_MODELS = [
  "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8",
];

// Weight profiles (8 members)
const PROFILES = {
  uniform: COMBO_MODELS.map((id) => ({ id, weight: 1 })),
  skewed: [
    { id: "m1", weight: 8 },
    { id: "m2", weight: 1 }, { id: "m3", weight: 1 }, { id: "m4", weight: 1 },
    { id: "m5", weight: 1 }, { id: "m6", weight: 1 }, { id: "m7", weight: 1 }, { id: "m8", weight: 1 },
  ],
  balanced: [
    { id: "m1", weight: 4 }, { id: "m2", weight: 3 },
    { id: "m3", weight: 2 }, { id: "m4", weight: 2 },
    { id: "m5", weight: 1 }, { id: "m6", weight: 1 }, { id: "m7", weight: 1 }, { id: "m8", weight: 1 },
  ],
};

// Per-model failure probability by scenario
const FAILURE_MODELS = {
  "all-healthy": (i) => 0,
  "first-tired": (i) => i === 0 ? 0.8 : 0,
  "random-fail": () => 0.15,
  "down-bottom": (i) => i >= 4 ? 0.6 : 0,
};

function pickByWeight(members) {
  // Exact weighted sampling (not the shuffle) to measure intended distribution:
  // P(pick m) = weight / sum(weights)
  const sum = members.reduce((s, m) => s + m.weight, 0);
  let r = Math.random() * sum;
  for (const m of members) { r -= m.weight; if (r <= 0) return m.id; }
  return members[members.length - 1].id;
}

function runStrategy(strategy, members, failureFn, N = 10000) {
  const picks = {}; // first-model selection counts
  let totalHops = 0;
  let worstHops = 0;
  let totalBytes = 0;
  let requestsFailed = 0;
  let exhaustedRequests = 0;

  for (let n = 0; n < N; n++) {
    let hops = 0;
    let succeeded = false;

    // Simulate the combo's ordered attempt list: weighted shuffles by weight,
    // fallback keeps declared order (getRotatedModels returns declared order for fallback).
    let order;
    if (strategy === "weighted") {
      order = getRotatedModels(COMBO_MODELS, "combo_primary", "weighted", 1, members);
    } else {
      order = COMBO_MODELS; // fallback => declared order, deterministic
    }

    for (const modelId of order) {
      hops++;
      const idx = COMBO_MODELS.indexOf(modelId);
      const failP = failureFn(idx);
      if (Math.random() < failP) continue;
      succeeded = true;
      break;
    }

    const first = order[0];
    picks[first] = (picks[first] || 0) + 1;
    totalHops += hops;
    if (hops > worstHops) worstHops = hops;
    totalBytes += hops * MODEL_BODY_BYTES;
    if (!succeeded) {
      requestsFailed++;
      if (hops >= COMBO_MODELS.length) exhaustedRequests++;
    }
  }

  return { picks, totalHops, worstHops, totalBytes, avgHops: totalHops / N, requestsFailed, exhaustedRequests };
}

function fmtPct(x, total) { return ((x / total) * 100).toFixed(1) + "%"; }

describe("combo strategy bench", () => {
  it("prints weighted vs fallback comparison", () => {
    const STRATEGIES = ["fallback", "weighted"];
    const N = 10000;

    for (const [profileName, members] of Object.entries(PROFILES)) {
      console.log(`\n===== PROFILE: ${profileName.toUpperCase()} (weights: ${members.map((m) => m.id + ":" + m.weight).join(", ")}) =====`);
      for (const [failName, failureFn] of Object.entries(FAILURE_MODELS)) {
        console.log(`\n--- Failure: ${failName} ---`);
        console.log("strategy".padEnd(10) + "avgHops".padEnd(9) + "worst".padEnd(7) + "bytesSent".padEnd(14) + "reqFail%".padEnd(9) + "exhaust%".padEnd(9));
        for (const strat of STRATEGIES) {
          const r = runStrategy(strat, members, failureFn, N);
          console.log(
            strat.padEnd(10) +
            r.avgHops.toFixed(2).padEnd(9) +
            String(r.worstHops).padEnd(7) +
            (r.totalBytes / (1024 * 1024)).toFixed(1) + "MB".padEnd(11) +
            (Math.round(r.requestsFailed / N * 100)).toFixed(1) + "%".padEnd(6) +
            (Math.round(r.exhaustedRequests / N * 100)).toFixed(1) + "%".padEnd(6)
          );
        }
        // Selection distribution (first pick) — weighted should be ~weight-proportional
        console.log("\n  first-pick distribution:");
        for (const strat of STRATEGIES) {
          const r = runStrategy(strat, members, failureFn, N);
          const parts = COMBO_MODELS.map((id) => `${id}:${fmtPct(r.picks[id] || 0, N)}`).join("  ");
          console.log(`  ${strat.padEnd(9)} ${parts}`);
        }
      }
    }

    console.log("\n\n### Expected pattern");
    console.log("Weighted skewed: m1 (weight 8) should be picked first ~53% of requests.");
    console.log("Weighted uniform: ~12.5% each.");
    console.log("Fallback: always m1 first (100%) — unless marked unavailable, the same tired/bottom model is re-hit first every request, inflating avgHops when m1 is flaky.");
  });
});
