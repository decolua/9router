import { describe, it, expect, vi } from "vitest";
import { runWithModelFallback, getModelFallback, isDeterministicPayloadError } from "../../open-sse/services/modelFallback.js";

// Minimal Response stub: status + clone().text()
function makeResponse(status, body = "", json = null) {
  const text = async () => body;
  const jsonAsync = json ? async () => json : async () => ({});
  const make = () => ({
    status,
    ok: status >= 200 && status < 300,
    clone: make,
    text,
    json: jsonAsync,
  });
  return make();
}

const noopLog = { warn: () => {}, info: () => {}, debug: () => {} };

describe("getModelFallback", () => {
  it("returns null for missing entry", () => {
    expect(getModelFallback("A", {})).toBeNull();
  });

  it("returns null when disabled", () => {
    expect(getModelFallback("A", { A: { fallback: "B", enabled: false } })).toBeNull();
  });

  it("returns null for self-fallback", () => {
    expect(getModelFallback("A", { A: { fallback: "A", enabled: true } })).toBeNull();
  });

  it("returns the fallback string when configured", () => {
    expect(getModelFallback("A", { A: { fallback: "B", enabled: true } })).toBe("B");
  });

  it("returns null for non-object map", () => {
    expect(getModelFallback("A", null)).toBeNull();
    expect(getModelFallback("A", "nope")).toBeNull();
  });
});

describe("isDeterministicPayloadError", () => {
  it("returns true for 400 with context-length phrases", () => {
    expect(isDeterministicPayloadError(400, "input is too long")).toBe(true);
    expect(isDeterministicPayloadError(400, "context length exceeded")).toBe(true);
    expect(isDeterministicPayloadError(400, "maximum context reached")).toBe(true);
    expect(isDeterministicPayloadError(400, "too many tokens")).toBe(true);
    expect(isDeterministicPayloadError(400, "content_length_exceeds_threshold")).toBe(true);
  });

  it("returns false for non-400", () => {
    expect(isDeterministicPayloadError(429, "rate limited")).toBe(false);
    expect(isDeterministicPayloadError(500, "boom")).toBe(false);
  });

  it("returns false for 400 without context-length phrase", () => {
    expect(isDeterministicPayloadError(400, "Invalid model format")).toBe(false);
    expect(isDeterministicPayloadError(400, "missing required field")).toBe(false);
  });
});

describe("runWithModelFallback", () => {
  it("1. No fallback configured → returns primary, runner called once", async () => {
    const runner = vi.fn(async (m) => makeResponse(200, `ok-${m}`));
    const res = await runWithModelFallback("A", {}, runner, noopLog);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0][0]).toBe("A");
    expect(res.status).toBe(200);
    expect(await res.clone().text()).toBe("ok-A");
  });

  it("2. Primary 2xx with fallback configured → returns primary, runner called once", async () => {
    const fallbacks = { A: { fallback: "B", enabled: true } };
    const runner = vi.fn(async (m) => makeResponse(200, `ok-${m}`));
    const res = await runWithModelFallback("A", fallbacks, runner, noopLog);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(await res.clone().text()).toBe("ok-A");
  });

  it("3. Primary 429 + eligible → runner called twice; first=A, second=fallback; returns fallback response", async () => {
    const fallbacks = { A: { fallback: "B", enabled: true } };
    const seen = [];
    const runner = vi.fn(async (m) => {
      seen.push(m);
      if (m === "A") return makeResponse(429, '{"error":"rate limit"}');
      return makeResponse(200, `ok-${m}`);
    });
    const res = await runWithModelFallback("A", fallbacks, runner, noopLog);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(seen[0]).toBe("A");
    expect(seen[1]).toBe("B");
    expect(res.status).toBe(200);
    expect(await res.clone().text()).toBe("ok-B");
  });

  it("4. Primary non-2xx with enabled:false → returns primary, runner called once", async () => {
    const fallbacks = { A: { fallback: "B", enabled: false } };
    const runner = vi.fn(async (m) => makeResponse(500, "boom"));
    const res = await runWithModelFallback("A", fallbacks, runner, noopLog);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(500);
  });

  it("5. Self-fallback → returns primary, runner called once", async () => {
    const fallbacks = { A: { fallback: "A", enabled: true } };
    const runner = vi.fn(async (m) => makeResponse(500, "boom"));
    const res = await runWithModelFallback("A", fallbacks, runner, noopLog);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(500);
  });

  it("6. Deterministic payload error NOT fallen back", async () => {
    const fallbacks = { A: { fallback: "B", enabled: true } };
    const runner = vi.fn(async (m) => {
      if (m === "A") return makeResponse(400, "input is too long for this model");
      return makeResponse(200, "ok-B");
    });
    const res = await runWithModelFallback("A", fallbacks, runner, noopLog);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0][0]).toBe("A");
    expect(res.status).toBe(400);
    expect(await res.clone().text()).toBe("input is too long for this model");
  });

  it("7. Success response body still reads after clone() in fast-path", async () => {
    const fallbacks = { A: { fallback: "B", enabled: true } };
    const runner = vi.fn(async (m) => makeResponse(200, `payload-${m}`));
    const res = await runWithModelFallback("A", fallbacks, runner, noopLog);
    expect(runner).toHaveBeenCalledTimes(1);
    // Body unconsumed: clone() in the wrapper is only called on non-2xx path.
    expect(await res.text()).toBe("payload-A");
  });

  it("8. Non-deterministic 500 → falls back", async () => {
    const fallbacks = { A: { fallback: "B", enabled: true } };
    const runner = vi.fn(async (m) => {
      if (m === "A") return makeResponse(500, '{"error":"upstream boom"}');
      return makeResponse(200, "ok-B");
    });
    const res = await runWithModelFallback("A", fallbacks, runner, noopLog);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
    expect(await res.clone().text()).toBe("ok-B");
  });
});
