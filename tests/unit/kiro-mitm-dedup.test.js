import { describe, expect, it, beforeEach, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { Module } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Load the CommonJS MITM handler. The dedup helpers ARE in module.exports now,
// so a plain createRequire against the real source path resolves the whole
// require chain (../logger, ./base, etc.) exactly as in production. If that ever
// fails, fall back to the _compile loader pattern used by
// tests/unit/kiro-mitm-terminal.test.js.
// ─────────────────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const HANDLER_PATH = resolve(__dirname, "../../src/mitm/handlers/kiro.js");

function loadKiroHandler() {
  try {
    const require = createRequire(import.meta.url);
    return require(HANDLER_PATH);
  } catch {
    // Fallback: compile the source under its real filename so relative requires
    // resolve, then read whatever module.exports exposes.
    const source = readFileSync(HANDLER_PATH, "utf8");
    const mod = new Module(HANDLER_PATH, null);
    mod.filename = HANDLER_PATH;
    mod.paths = Module._nodeModulePaths(dirname(HANDLER_PATH));
    mod._compile(source, HANDLER_PATH);
    return mod.exports;
  }
}

const handler = loadKiroHandler();
const {
  isDuplicateRequest,
  fingerprintRequest,
  writeSuppressedDuplicateResponse,
  dedupEnabled,
  dedupWindowMs,
  markInFlight,
  clearInFlight,
  markCompleted,
  _resetDedupCache,
} = handler;

// ─────────────────────────────────────────────────────────────────────────────
// Minimal AWS EventStream frame decoder (mirrors the encoder in kiro.js and the
// decoder in tests/unit/kiro-mitm-terminal.test.js). Pulls :event-type and the
// JSON payload so we can assert the suppressed-duplicate frames precisely.
// ─────────────────────────────────────────────────────────────────────────────
function decodeFrame(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const totalLen = view.getUint32(0, false);
  const headersLen = view.getUint32(4, false);
  let offset = 12; // prelude = totalLen(4) + headersLen(4) + preludeCRC(4)
  const headersEnd = 12 + headersLen;
  const headers = {};
  const decoder = new TextDecoder();

  while (offset < headersEnd) {
    const nameLen = buf[offset];
    offset += 1;
    const name = decoder.decode(buf.subarray(offset, offset + nameLen));
    offset += nameLen;
    const type = buf[offset];
    offset += 1;
    if (type === 7) {
      const valueLen = view.getUint16(offset, false);
      offset += 2;
      const value = decoder.decode(buf.subarray(offset, offset + valueLen));
      offset += valueLen;
      headers[name] = value;
    } else {
      throw new Error(`Unexpected header type ${type} for ${name}`);
    }
  }

  const payloadBytes = buf.subarray(headersEnd, totalLen - 4);
  const payloadText = decoder.decode(payloadBytes);
  let payload = null;
  if (payloadText.length > 0) {
    try {
      payload = JSON.parse(payloadText);
    } catch {
      payload = payloadText;
    }
  }

  return {
    eventType: headers[":event-type"],
    messageType: headers[":message-type"],
    contentType: headers[":content-type"],
    payload,
    byteLength: totalLen,
  };
}

function decodeFrames(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const frames = [];
  let offset = 0;
  while (offset < buf.length) {
    const view = new DataView(buf.buffer, buf.byteOffset + offset, buf.length - offset);
    const totalLen = view.getUint32(0, false);
    frames.push(decodeFrame(buf.subarray(offset, offset + totalLen)));
    offset += totalLen;
  }
  return frames;
}

// ─────────────────────────────────────────────────────────────────────────────
// Env save/restore so per-test tweaks never leak. dedupEnabled/dedupWindowMs
// read process.env at call time, so set env then call.
// ─────────────────────────────────────────────────────────────────────────────
let savedDedup;
let savedWindow;

beforeEach(() => {
  savedDedup = process.env.MITM_KIRO_DEDUP;
  savedWindow = process.env.MITM_KIRO_DEDUP_WINDOW_MS;
  delete process.env.MITM_KIRO_DEDUP;
  delete process.env.MITM_KIRO_DEDUP_WINDOW_MS;
  _resetDedupCache();
});

function restoreEnv() {
  if (savedDedup === undefined) delete process.env.MITM_KIRO_DEDUP;
  else process.env.MITM_KIRO_DEDUP = savedDedup;
  if (savedWindow === undefined) delete process.env.MITM_KIRO_DEDUP_WINDOW_MS;
  else process.env.MITM_KIRO_DEDUP_WINDOW_MS = savedWindow;
}

describe("dedupEnabled()", () => {
  it("is true by default when env is unset", () => {
    expect(dedupEnabled()).toBe(true);
    restoreEnv();
  });

  it("is false for explicit falsy values (case-insensitive, trimmed)", () => {
    for (const v of ["0", "false", "off", "no", "FALSE", " Off ", "  NO  ", "No"]) {
      process.env.MITM_KIRO_DEDUP = v;
      expect(dedupEnabled(), `value=${JSON.stringify(v)}`).toBe(false);
    }
    restoreEnv();
  });

  it("stays true for other/truthy values", () => {
    for (const v of ["1", "true", "on", "yes", "", "anything"]) {
      process.env.MITM_KIRO_DEDUP = v;
      expect(dedupEnabled(), `value=${JSON.stringify(v)}`).toBe(true);
    }
    restoreEnv();
  });
});

describe("dedupWindowMs()", () => {
  it("defaults to 0 (Pure Content Dedup) when unset", () => {
    expect(dedupWindowMs()).toBe(0);
    restoreEnv();
  });

  it("reads a positive number from env", () => {
    process.env.MITM_KIRO_DEDUP_WINDOW_MS = "5000";
    expect(dedupWindowMs()).toBe(5000);
    restoreEnv();
  });

  it("falls back to 0 for invalid / non-positive values", () => {
    for (const v of ["0", "-100", "abc", "", "NaN"]) {
      process.env.MITM_KIRO_DEDUP_WINDOW_MS = v;
      expect(dedupWindowMs(), `value=${JSON.stringify(v)}`).toBe(0);
    }
    restoreEnv();
  });
});

describe("fingerprintRequest()", () => {
  it("produces a stable sha1 hex string", () => {
    const fp = fingerprintRequest(Buffer.from("hello world"));
    expect(fp).toMatch(/^[0-9a-f]{40}$/);
    // sha1("hello world") is a known constant
    expect(fp).toBe("2aae6c35c94fcfb415dbe95f408b9ce91ee846ed");
    restoreEnv();
  });

  it("gives identical fingerprints for identical buffers", () => {
    const a = fingerprintRequest(Buffer.from("same body"));
    const b = fingerprintRequest(Buffer.from("same body"));
    expect(a).toBe(b);
    restoreEnv();
  });

  it("gives different fingerprints for different buffers", () => {
    const a = fingerprintRequest(Buffer.from("body one"));
    const b = fingerprintRequest(Buffer.from("body two"));
    expect(a).not.toBe(b);
    restoreEnv();
  });
});

describe("isDuplicateRequest()", () => {
  it("first call is not a duplicate; identical second call is content_match by default", () => {
    const body = Buffer.from(JSON.stringify({ conversationState: { id: 1 } }));

    const first = isDuplicateRequest(body);
    expect(first.isDup).toBe(false);
    expect(first.fp).toMatch(/^[0-9a-f]{40}$/);

    const second = isDuplicateRequest(Buffer.from(body)); // fresh buffer, same bytes
    expect(second.isDup).toBe(true);
    expect(second.reason).toBe("content_match");
    expect(second.fp).toBe(first.fp);
    restoreEnv();
  });

  it("detects in-flight requests as duplicates", () => {
    const body = Buffer.from("in-flight body");
    const fp = fingerprintRequest(body);

    markInFlight(fp);
    const check = isDuplicateRequest(body);
    expect(check.isDup).toBe(true);
    expect(check.reason).toBe("in_flight");

    clearInFlight(fp);
    markCompleted(fp);

    const checkAfter = isDuplicateRequest(body);
    expect(checkAfter.isDup).toBe(true);
    expect(checkAfter.reason).toBe("content_match");
    restoreEnv();
  });

  it("a different body is not a duplicate", () => {
    isDuplicateRequest(Buffer.from("body A"));
    const other = isDuplicateRequest(Buffer.from("body B"));
    expect(other.isDup).toBe(false);
    restoreEnv();
  });

  it("stays duplicate indefinitely under default Pure Content mode (windowMs=0)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1_000_000));
      const body = Buffer.from("permanent body");

      expect(isDuplicateRequest(body).isDup).toBe(false);
      // Advance by 1 hour
      vi.advanceTimersByTime(3600 * 1000);
      const second = isDuplicateRequest(Buffer.from(body));
      expect(second.isDup).toBe(true);
      expect(second.reason).toBe("content_match");
    } finally {
      vi.useRealTimers();
      restoreEnv();
    }
  });

  it("the same body is NOT a duplicate again after window elapses when windowMs > 0", () => {
    process.env.MITM_KIRO_DEDUP_WINDOW_MS = "1";
    const body = Buffer.from("expiring body");

    expect(isDuplicateRequest(body).isDup).toBe(false);

    return new Promise((resolveP) => {
      setTimeout(() => {
        const after = isDuplicateRequest(Buffer.from(body));
        expect(after.isDup).toBe(false); // window elapsed → treated as fresh
        restoreEnv();
        resolveP();
      }, 15);
    });
  });

  it("expiry via fake timers when windowMs > 0", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1_000_000));
      process.env.MITM_KIRO_DEDUP_WINDOW_MS = "1000";
      const body = Buffer.from("timer body");

      expect(isDuplicateRequest(body).isDup).toBe(false);
      // within window
      vi.advanceTimersByTime(500);
      const within = isDuplicateRequest(Buffer.from(body));
      expect(within.isDup).toBe(true);
      expect(within.reason).toBe("window_match");
      // now push past the window relative to last hit
      vi.advanceTimersByTime(1001);
      expect(isDuplicateRequest(Buffer.from(body)).isDup).toBe(false);
    } finally {
      vi.useRealTimers();
      restoreEnv();
    }
  });

  it("_resetDedupCache() clears both in-flight and completed caches", () => {
    const body = Buffer.from("cache reset body");
    expect(isDuplicateRequest(body).isDup).toBe(false);
    expect(isDuplicateRequest(Buffer.from(body)).isDup).toBe(true);
    _resetDedupCache();
    expect(isDuplicateRequest(Buffer.from(body)).isDup).toBe(false);
    restoreEnv();
  });
});

describe("writeSuppressedDuplicateResponse()", () => {
  function makeMockRes() {
    return {
      headWrite: null,
      writes: [],
      ended: false,
      writeHead(code, headers) {
        this.headWrite = { code, headers };
      },
      write(chunk) {
        this.writes.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        return true;
      },
      end() {
        this.ended = true;
      },
    };
  }

  it("writes head 200 with eventstream content-type, 4 binary frames, and calls end()", () => {
    const res = makeMockRes();
    writeSuppressedDuplicateResponse(res);

    expect(res.headWrite.code).toBe(200);
    expect(res.headWrite.headers["Content-Type"]).toBe("application/vnd.amazon.eventstream");

    expect(res.writes).toHaveLength(4);
    for (const w of res.writes) {
      expect(Buffer.isBuffer(w)).toBe(true);
      expect(w.length).toBeGreaterThan(0);
    }

    expect(res.ended).toBe(true);
    restoreEnv();
  });

  it("frames decode to initial-response then metadataEvent (stopReason END_TURN)", () => {
    const res = makeMockRes();
    writeSuppressedDuplicateResponse(res);

    const first = decodeFrames(res.writes[0]);
    const second = decodeFrames(res.writes[1]);
    const third = decodeFrames(res.writes[2]);
    const fourth = decodeFrames(res.writes[3]);

    expect(first).toHaveLength(1);
    expect(first[0].eventType).toBe("initial-response");

    expect(second).toHaveLength(1);
    expect(second[0].eventType).toBe("metadataEvent");
    expect(second[0].payload).toEqual({ stopReason: "END_TURN" });

    expect(third).toHaveLength(1);
    expect(third[0].eventType).toBe("contextUsageEvent");

    expect(fourth).toHaveLength(1);
    expect(fourth[0].eventType).toBe("meteringEvent");
    restoreEnv();
  });
});
