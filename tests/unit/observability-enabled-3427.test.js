/**
 * #3427 — request details never reached the `requestDetails` table.
 *
 * `saveRequestDetail` returns early unless observability is enabled, and the
 * enable check could not be satisfied the way the shipped `.env.example`
 * documents:
 *
 *   ENABLE_REQUEST_LOGS=false      <- .env.example line 16
 *   OBSERVABILITY_ENABLED=true     <- .env.example line 17
 *
 * `ENABLE_REQUEST_LOGS` was consulted first and `false` short-circuited the whole
 * resolution, so `OBSERVABILITY_ENABLED` and the dashboard toggle were both
 * ignored. And `OBSERVABILITY_ENABLED` could never apply on its own either:
 * `getSettings()` merges defaults, so `settings.enableObservability` is always a
 * boolean and the guard in front of the env fallback was always taken.
 *
 * Precedence is now OBSERVABILITY_ENABLED → ENABLE_REQUEST_LOGS → the toggle,
 * with an unset variable meaning "no opinion" instead of "off".
 */
import { describe, expect, it } from "vitest";
import { resolveObservabilityEnabled } from "@/lib/db/repos/requestDetailsRepo.js";

const OFF = { enableObservability: false };
const ON = { enableObservability: true };

describe("observability enable resolution (#3427)", () => {
  it("stays off by default, with no env vars and an untouched toggle", () => {
    expect(resolveObservabilityEnabled(OFF, {})).toBe(false);
  });

  it("honours the dashboard toggle when no env var is set", () => {
    expect(resolveObservabilityEnabled(ON, {})).toBe(true);
  });

  it("honours the shipped .env.example combination", () => {
    // The exact pair `.env.example` ships. Previously resolved to false.
    const env = { ENABLE_REQUEST_LOGS: "false", OBSERVABILITY_ENABLED: "true" };
    expect(resolveObservabilityEnabled(OFF, env)).toBe(true);
  });

  it("lets OBSERVABILITY_ENABLED turn details on without touching the toggle", () => {
    expect(resolveObservabilityEnabled(OFF, { OBSERVABILITY_ENABLED: "true" })).toBe(true);
  });

  it("lets OBSERVABILITY_ENABLED turn details off over an enabled toggle", () => {
    expect(resolveObservabilityEnabled(ON, { OBSERVABILITY_ENABLED: "false" })).toBe(false);
  });

  it("keeps ENABLE_REQUEST_LOGS=true as an override, as before", () => {
    expect(resolveObservabilityEnabled(OFF, { ENABLE_REQUEST_LOGS: "true" })).toBe(true);
  });

  it("keeps ENABLE_REQUEST_LOGS=false disabling details when it is the only signal", () => {
    expect(resolveObservabilityEnabled(ON, { ENABLE_REQUEST_LOGS: "false" })).toBe(false);
  });

  it("treats an empty or whitespace value as unset", () => {
    expect(resolveObservabilityEnabled(ON, { OBSERVABILITY_ENABLED: "" })).toBe(true);
    expect(resolveObservabilityEnabled(ON, { OBSERVABILITY_ENABLED: "   " })).toBe(true);
    expect(resolveObservabilityEnabled(OFF, { ENABLE_REQUEST_LOGS: "" })).toBe(false);
  });

  it("accepts the documented casing variants", () => {
    expect(resolveObservabilityEnabled(OFF, { OBSERVABILITY_ENABLED: "TRUE" })).toBe(true);
    expect(resolveObservabilityEnabled(OFF, { OBSERVABILITY_ENABLED: " true " })).toBe(true);
    // Anything that is not "true" stays off, matching the previous parser.
    expect(resolveObservabilityEnabled(ON, { OBSERVABILITY_ENABLED: "1" })).toBe(false);
  });

  it("does not read a missing settings row as enabled", () => {
    expect(resolveObservabilityEnabled(undefined, {})).toBe(false);
    expect(resolveObservabilityEnabled({}, {})).toBe(false);
  });
});
