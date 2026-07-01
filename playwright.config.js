import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 0,
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:20128",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    // Production server. Dev mode (next dev) compiles routes on demand, so
    // the first hit to a route in a fresh server can take 5–20s while
    // webpack/turbopack compiles it — this dominates test runtime when
    // each test navigates the same set of routes. Running against the
    // pre-built production bundle removes that cost (~2–3s per test vs
    // 60–80s in dev).
    //
    // Requires `npm run build:bun` to have been run at least once. Rebuild
    // when the source code under test changes; otherwise the cached build
    // is reused. `bun --bun` keeps the bun:sqlite adapter active (the
    // default node runtime would fall back to better-sqlite3 instead).
    command: "bun --bun next start --port 20128",
    url: "http://127.0.0.1:20128",
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: "20128",
    },
  },
});
