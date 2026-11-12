import { defineConfig } from "vitest/config";
import os from "node:os";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ─── host load bound (FED-024) ──────────────────────────────────────────────
//
// Two knobs bound how much of the host this suite can take, both clamped
// 2..16 so a typo can neither serialise the run nor let it storm the box.
//
// 1. TEST_WORKERS — vitest's own worker pool. Left unset it defaults to the
//    host's CPU count, which on the fleet's 16-core boxes means 16 forked
//    workers at ~130 MB each — the single largest concurrency source in a
//    `npm test` run, and the one that competes with whatever else is on the
//    machine. Bounding it caps peak processes AND peak resident memory
//    without changing which test files run or what they assert; the pool only
//    decides how many files are in flight at once.
// 2. TEST_SPAWN_CONCURRENCY — read by test files that hold their own
//    subprocess fan-out (tests/federation/custom-server-boot.test.js), so the
//    budget is one env var rather than a per-file constant.
export const LOAD_BOUND = { min: 2, max: 16 };

export function boundedInt(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(LOAD_BOUND.min, Math.min(LOAD_BOUND.max, Math.trunc(n)));
}

// Never ask for more workers than the host has CPUs: on a 2-core CI runner the
// pool stays at 2 (today's behaviour), and the bound only bites on the big
// fleet boxes where the default would otherwise be the full core count.
//
// The default 12 was picked by measurement on the fleet's 16-core box, not by
// taste: interleaved A/B against the unbounded (16) pool showed the same wall
// clock (~17-18s) with peak concurrent children 17 instead of 22-27, and tree
// CPU ~117s instead of ~126-134s. Below ~10 the peak keeps falling but the wall
// clock starts climbing; above ~14 the peak comes back without buying time.
const hostCpus = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
const requestedWorkers = boundedInt(process.env.TEST_WORKERS, 12);
const workerCount = Math.max(1, Math.min(hostCpus, requestedWorkers));

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.js"],
    // Don't scan into git worktrees nested under .claude/ — they carry their
    // own copies of the test files but lack an installed node_modules (open-sse,
    // etc.), which makes provider imports fail during collection.
    exclude: ["**/node_modules/**", "**/.claude/**", "**/dist/**"],
    // Allow many it.concurrent cases (real provider smoke runs ~50 providers in parallel)
    maxConcurrency: 60,
    // FED-024: bound the forked worker pool (see LOAD_BOUND above). Override
    // with TEST_WORKERS (2-16) when a host can afford more.
    maxWorkers: workerCount,
    // Suppress noisy console output from handlers under test
    silent: false,
  },
  resolve: {
    // Use array form so subpath aliases (e.g. "@/lib/db/index.js") resolve correctly.
    alias: [
      { find: /^open-sse\//, replacement: resolve(__dirname, "../open-sse") + "/" },
      { find: "open-sse", replacement: resolve(__dirname, "../open-sse") },
      { find: /^@\//, replacement: resolve(__dirname, "../src") + "/" },
    ],
  },
});
