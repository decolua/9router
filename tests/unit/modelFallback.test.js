import { describe, it, expect, vi } from "vitest";
import { runWithModelFallback, getModelFallback, getModelFallbacks, isDeterministicPayloadError } from "../../open-sse/services/modelFallback.js";

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


describe("getModelFallbacks (ordered list)", () => {
  it("returns [] for missing entry", () => {
    expect(getModelFallbacks("A", {})).toEqual([]);
  });

  it("returns [] when disabled", () => {
    expect(getModelFallbacks("A", { A: { fallbacks: ["B", "C"], enabled: false } })).toEqual([]);
  });

  it("returns ordered list when configured", () => {
    expect(getModelFallbacks("A", { A: { fallbacks: ["B", "C", "D"], enabled: true } })).toEqual(["B", "C", "D"]);
  });

  it("reads legacy single-fallback shape", () => {
    expect(getModelFallbacks("A", { A: { fallback: "B", enabled: true } })).toEqual(["B"]);
  });

  it("drops self-references and dupes preserve-order", () => {
    expect(getModelFallbacks("A", { A: { fallbacks: ["A", "B", "B", "C", "B"], enabled: true } })).toEqual(["B", "C"]);
  });

  it("drops blanks and non-strings", () => {
    expect(getModelFallbacks("A", { A: { fallbacks: ["B", "", null, 3, "C"], enabled: true } })).toEqual(["B", "C"]);
  });
  it("mode defaults to ordered when not specified", () => {
    expect(getModelFallbacks("A", { A: { fallbacks: ["B", "C", "D"], enabled: true } })).toEqual(["B", "C", "D"]);
  });

  it("returns shuffled list (same set) in random mode", () => {
    const result = getModelFallbacks("RAND-PRIMARY", { "RAND-PRIMARY": { fallbacks: ["B", "C", "D"], mode: "random", enabled: true } });
    expect(result.length).toBe(3);
    expect([...result].sort()).toEqual(["B", "C", "D"]);
  });

  it("returns rotated list in roundrobin mode (cursor advances per call)", () => {
    const calls = [];
    for (let i = 0; i < 4; i += 1) {
      calls.push(getModelFallbacks("RR-PRIMARY", { "RR-PRIMARY": { fallbacks: ["B", "C", "D"], mode: "roundrobin", enabled: true } }));
    }
    for (const c of calls) expect([...c].sort()).toEqual(["B", "C", "D"]);
    expect(calls[0]).toEqual(["B", "C", "D"]);
    expect(calls[1][0]).not.toBe("B");
  });

  it("roundrobin cursor map does not exceed 500 entries", () => {
    for (let i = 0; i < 600; i += 1) {
      getModelFallbacks(`RR-STRESS-${i}`, {
        [`RR-STRESS-${i}`]: { fallbacks: ["A", "B"], mode: "roundrobin", enabled: true },
      });
    }
    // Re-call an evicted entry; cursor should have reset (starts at 0).
    const first = getModelFallbacks("RR-STRESS-0", {
      "RR-STRESS-0": { fallbacks: ["A", "B"], mode: "roundrobin", enabled: true },
    });
    expect(first).toEqual(["A", "B"]);
  });
});

describe("runWithModelFallback ordered chain", () => {
  it("tries fallbacks in order, returns first 2xx", async () => {
    const calls = [];
    const runner = async (m) => {
      calls.push(m);
      if (m === "A") return makeResponse(429, "rate");
      if (m === "B") return makeResponse(503, "unavail");
      if (m === "C") return makeResponse(200, "ok");
      return makeResponse(500, "err");
    };
    const res = await runWithModelFallback("A", { A: { fallbacks: ["B", "C", "D"], enabled: true } }, runner, noopLog);
    expect(res.status).toBe(200);
    expect(calls).toEqual(["A", "B", "C"]);
  });

  it("returns last fallback result when all fallbacks fail (not stale primary)", async () => {
    const calls = [];
    const runner = async (m) => {
      calls.push(m);
      if (m === "A") return makeResponse(429, "primary-rate");
      if (m === "B") return makeResponse(503, "b-down");
      if (m === "C") return makeResponse(401, "c-auth");
      return makeResponse(500, "err");
    };
    const res = await runWithModelFallback("A", { A: { fallbacks: ["B", "C"], enabled: true } }, runner, noopLog);
    expect(res.status).toBe(401);
    expect(calls).toEqual(["A", "B", "C"]);
  });

  it("swallows runner throw and tries next fallback", async () => {
    const calls = [];
    const runner = async (m) => {
      calls.push(m);
      if (m === "B") throw new Error("network");
      if (m === "C") return makeResponse(200, "ok");
      return makeResponse(429, "rate");
    };
    const res = await runWithModelFallback("A", { A: { fallbacks: ["B", "C"], enabled: true } }, runner, noopLog);
    expect(res.status).toBe(200);
    expect(calls).toEqual(["A", "B", "C"]);
  });

  it("returns primary response when every fallback threw", async () => {
    const runner = async (m) => {
      if (m === "A") return makeResponse(429, "rate");
      throw new Error("network");
    };
    const res = await runWithModelFallback("A", { A: { fallbacks: ["B", "C"], enabled: true } }, runner, noopLog);
    expect(res.status).toBe(429);
  });
  it("stops chain on deterministic payload error from a fallback", async () => {
    const calls = [];
    const runner = async (m) => {
      calls.push(m);
      if (m === "A") return makeResponse(429, "rate");
      if (m === "B") return makeResponse(400, "input is too long");
      if (m === "C") return makeResponse(200, "ok");
      return makeResponse(500, "err");
    };
    const res = await runWithModelFallback("A", { A: { fallbacks: ["B", "C"], enabled: true } }, runner, noopLog);
    expect(res.status).toBe(400);
    expect(calls).toEqual(["A", "B"]); // C never tried — B's payload error stops chain
  });
});