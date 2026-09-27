import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Whether requests are recorded for the Request Details tab.
 *
 * The tab was reported empty on a real install. The setting was on — stored and
 * read back as `enableObservability: true` — and nothing was being recorded,
 * because `.env.example` shipped two variables for the same switch with
 * opposite values:
 *
 *     ENABLE_REQUEST_LOGS=false
 *     OBSERVABILITY_ENABLED=true
 *
 * The first is checked first and returns immediately, so the second line and
 * the dashboard's own switch were both dead. Every install that copied the
 * example inherited it.
 *
 * The precedence is deliberately left as it was — flipping it would turn
 * payload recording on for every existing install without anyone asking — so
 * these pin it instead, and the example no longer ships the contradiction.
 */

const ENV_KEYS = ["ENABLE_REQUEST_LOGS", "OBSERVABILITY_ENABLED"];
let saved;

async function freshGate() {
  // The config is cached per module instance, so each case needs its own.
  vi.resetModules();
  const repo = await import("@/lib/db/repos/requestDetailsRepo.js");
  return repo.isObservabilityRecording();
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("observability gate", () => {
  it("is off when nothing says otherwise", async () => {
    // The stored default; a fresh install records nothing until asked to.
    expect(await freshGate()).toBe(false);
  });

  it("is turned on by OBSERVABILITY_ENABLED", async () => {
    process.env.OBSERVABILITY_ENABLED = "true";
    expect(await freshGate()).toBe(true);
  });

  it("is turned off by OBSERVABILITY_ENABLED=false", async () => {
    process.env.OBSERVABILITY_ENABLED = "false";
    expect(await freshGate()).toBe(false);
  });

  it("is turned on by the older ENABLE_REQUEST_LOGS too", async () => {
    process.env.ENABLE_REQUEST_LOGS = "true";
    expect(await freshGate()).toBe(true);
  });

  it("lets the older name win when both are set, which is the trap", async () => {
    // Exactly what .env.example used to ship. Kept as behaviour so no install
    // starts recording payloads because of an upgrade; the example no longer
    // sets both, and the tab now says recording is off instead of looking
    // like a server that has served nothing.
    process.env.ENABLE_REQUEST_LOGS = "false";
    process.env.OBSERVABILITY_ENABLED = "true";
    expect(await freshGate()).toBe(false);
  });

  it("reads a value in any case, so TRUE is not silently off", async () => {
    process.env.OBSERVABILITY_ENABLED = "TRUE";
    expect(await freshGate()).toBe(true);
    process.env.OBSERVABILITY_ENABLED = "FALSE";
    expect(await freshGate()).toBe(false);
  });
});
