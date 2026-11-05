import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { safeSource } from "../../src/lib/piiGuard/observe.js";
import { summarize } from "../../src/lib/piiGuard/summary.js";

describe("real OCR image test", () => {
  it.skipIf(!awaitableTesseract())("scans a fixture with the real library", async () => {
    const { readFile: read, mkdtemp: temp, rm: remove } = await import("node:fs/promises");
    const { tmpdir: tmp } = await import("node:os");
    const { join: pathJoin } = await import("node:path");
    const directory = await temp(pathJoin(tmp(), "pii-real-ocr-"));
    const previous = { module: process.env.PII_GUARD_MODULE, events: process.env.PII_GUARD_EVENTS, known: process.env.PII_GUARD_KNOWN };
    try {
      process.env.PII_GUARD_MODULE = "/home/chetan/Projects/pii-guard/dist/index.js";
      process.env.PII_GUARD_EVENTS = pathJoin(directory, "events.jsonl");
      delete process.env.PII_GUARD_KNOWN;
      vi.resetModules();
      const { testImage } = await import("../../src/lib/piiGuard/observe.js");
      const image = await read("/home/chetan/Projects/9router/public/pii-guard-samples/h02.png");
      const result = await testImage(image, { mode: "observe", ocr: { mode: "observe" } }, "basic", { sample: "h02" });
      expect(result).toMatchObject({ status: expect.any(String), mode: "basic", findings: expect.any(Array) });
      const audit = await read(process.env.PII_GUARD_EVENTS, "utf8");
      expect(audit).toContain('"type":"test"');
      expect(audit).not.toContain(result.text);
    } finally {
      process.env.PII_GUARD_MODULE = previous.module;
      if (previous.events === undefined) delete process.env.PII_GUARD_EVENTS; else process.env.PII_GUARD_EVENTS = previous.events;
      if (previous.known === undefined) delete process.env.PII_GUARD_KNOWN; else process.env.PII_GUARD_KNOWN = previous.known;
      await remove(directory, { recursive: true, force: true });
      vi.resetModules();
    }
  });
});

function awaitableTesseract() {
  return spawnSync("tesseract", ["--version"], { stdio: "ignore" }).status === 0;
}

describe("safeSource", () => {
  it("keeps /ocr suffix while sanitizing role and type", () => {
    expect(safeSource("user/image/ocr")).toBe("user/image/ocr");
    expect(safeSource("assistant/thinking/ocr")).toBe("assistant/thinking/ocr");
    expect(safeSource("-/-/ocr")).toBe("-/-/ocr");
    expect(safeSource("user/image")).toBe("user/image");
    expect(safeSource("system/text")).toBe("system/text");
    expect(safeSource("invalid/foo/ocr")).toBe("-/-/ocr");
    expect(safeSource("invalid/foo")).toBe("-/-");
    expect(safeSource("user/image/ocr/extra")).toBe("user/image/ocr");
    expect(safeSource(undefined)).toBe("-/-");
    expect(safeSource(null)).toBe("-/-");
    expect(safeSource(123)).toBe("-/-");
  });
});

describe("summary OCR integration", () => {
  const now = Date.parse("2026-01-02T12:00:00.000Z");

  it("does not count OCR events as requests", () => {
    const events = [
      { ts: "2026-01-02T10:00:00.000Z", requestId: "req-1", endpoint: "/v1/chat", hits: [{ hash: "h1", rule: "email", source: "user/text", action: "observe" }] },
      { ts: "2026-01-02T10:00:01.000Z", type: "ocr", requestId: "req-1", status: "scanned", cache: "miss", ocrMs: 50, hits: [{ hash: "h2", rule: "email", source: "user/image/ocr", action: "observe" }] },
      { ts: "2026-01-02T10:05:00.000Z", requestId: "req-2", endpoint: "/v1/chat", hits: [] },
      { ts: "2026-01-02T10:05:01.000Z", type: "ocr", requestId: "req-2", status: "empty", cache: "hit", ocrMs: 10, hits: [] },
      { ts: "2026-01-02T10:06:01.000Z", type: "ocr", requestId: "req-2", status: "skipped", cache: "none", ocrMs: 0, hits: [] },
    ];

    const result = summarize(events, { now });
    expect(result.requests).toBe(2);
    expect(result.ocr.totalImages).toBe(3);
    expect(result.ocr.status).toEqual({ scanned: 1, partial: 0, empty: 1, failed: 0, skipped: 1 });
    expect(result.ocr.imagesWithHits).toBe(1);
    expect(result.ocr.cache).toEqual({ hit: 1, miss: 1, coalesced: 0, none: 1, rate: 0.5 });
    expect(result.ocr.cacheHitRate).toBe(0.5);
    expect(result.ocr.p95OcrMs).toBe(50);
  });

  it("merges OCR hits into findings with visible /ocr source without inflating turns", () => {
    const events = [
      { ts: "2026-01-02T10:00:00.000Z", requestId: "req-1", hits: [{ hash: "h1", rule: "pan", name: "pan", kind: "pii", source: "user/text", action: "observe" }] },
      { ts: "2026-01-02T10:00:02.000Z", type: "ocr", requestId: "req-1", hits: [{ hash: "h1", rule: "pan", name: "pan", kind: "pii", source: "user/image/ocr", action: "observe" }] },
    ];

    const result = summarize(events, { now });
    expect(result.requests).toBe(1);
    expect(result.groups).toHaveLength(1);
    const panGroup = result.groups[0];
    expect(panGroup.hash).toBe("h1");
    expect(panGroup.sources).toContain("user/image/ocr");
    expect(panGroup.sources).toContain("user/text");
    expect(panGroup.turns).toBe(1); // Shared turn via requestId!
  });

  it("calculates cache hit rate correctly with coalesced separate", () => {
    const events = [
      { ts: "2026-01-02T10:00:00.000Z", type: "ocr", status: "scanned", cache: "hit", ocrMs: 5, hits: [] },
      { ts: "2026-01-02T10:00:01.000Z", type: "ocr", status: "scanned", cache: "miss", ocrMs: 100, hits: [] },
      { ts: "2026-01-02T10:00:02.000Z", type: "ocr", status: "scanned", cache: "miss", ocrMs: 200, hits: [] },
      { ts: "2026-01-02T10:00:03.000Z", type: "ocr", status: "scanned", cache: "coalesced", ocrMs: 0, hits: [] },
    ];
    const result = summarize(events, { now });
    // hit=1, miss=2, total=3 -> rate = 1/3 ~ 0.333
    expect(result.ocr.cache.hit).toBe(1);
    expect(result.ocr.cache.miss).toBe(2);
    expect(result.ocr.cache.coalesced).toBe(1);
    expect(result.ocr.cacheHitRate).toBeCloseTo(1 / 3);
    expect(result.ocr.p95OcrMs).toBe(200);
  });

  it("summarizes legacy event logs without type identically", () => {
    const legacyEvents = [
      { ts: "2026-01-02T10:00:00.000Z", hits: [{ hash: "val1", rule: "email", source: "user/text", action: "redact" }] },
      { ts: "2026-01-02T10:30:00.000Z", hits: [{ hash: "val2", rule: "pan", source: "assistant/text", action: "observe" }] },
      { ts: "2026-01-02T11:00:00.000Z", type: "error", count: 1 },
    ];

    const result = summarize(legacyEvents, { now });
    expect(result.requests).toBe(2);
    expect(result.errors24h).toBe(1);
    expect(result.unique24h).toBe(2);
    expect(result.ocr.totalImages).toBe(0);
    expect(result.ocr.cacheHitRate).toBe(0);
    expect(result.ocr.p95OcrMs).toBe(0);
    expect(result.ocr.status).toEqual({ scanned: 0, partial: 0, empty: 0, failed: 0, skipped: 0 });
  });
});

describe("observeRequest with OCR", () => {
  let dir, eventsFile, knownFile, mockModuleFile;
  let observeRequest, health;

  async function lines(file, minCount) {
    for (let i = 0; i < 100; i++) {
      try {
        const text = await readFile(file, "utf8");
        const count = text.trim().split("\n").filter(Boolean).length;
        if (count >= minCount) return text.trim().split("\n").map(l => JSON.parse(l));
      } catch {}
      await new Promise(r => setTimeout(r, 15));
    }
    throw new Error(`Timed out waiting for ${minCount} lines in ${file}`);
  }

  beforeEach(async () => {
    vi.resetModules();
    dir = await mkdtemp(join(tmpdir(), "pii-ocr-test-"));
    eventsFile = join(dir, "events.jsonl");
    knownFile = join(dir, "known.json");
    mockModuleFile = join(dir, "mock-scanner.mjs");

    process.env.PII_GUARD_MODULE = mockModuleFile;
    process.env.PII_GUARD_EVENTS = eventsFile;
    process.env.PII_GUARD_KNOWN = knownFile;

    await writeFile(knownFile, JSON.stringify({ version: 1, salt: "abcdef0123456789", items: [] }));
  });

  afterEach(async () => {
    delete process.env.PII_GUARD_MODULE;
    delete process.env.PII_GUARD_EVENTS;
    delete process.env.PII_GUARD_KNOWN;
    delete process.env.PII_GUARD_OCR;
    delete process.env.PII_GUARD_CAPTURE_IMAGES;
    delete process.env.PII_GUARD_CAPTURE_MAX_BYTES;
    delete process.env.PII_GUARD_CAPTURE_TTL_DAYS;
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("does not enable OCR when PII_GUARD_OCR is unset", async () => {
    const mockCode = `
      export function createDetector() { return { scan: () => [], knownCount: 0 }; }
      export function scanBody(body, detector, onImage) {
        if (typeof onImage === "function") throw new Error("onImage should not be passed when OCR is off");
        return { findings: [], chars: 0, images: 1, imageBytes: 100, unscanned: {} };
      }
      export function createOcrWorker() { throw new Error("Should not be called"); }
    `;
    await writeFile(mockModuleFile, mockCode);

    ({ observeRequest, health } = await import("../../src/lib/piiGuard/observe.js"));
    const h = health();
    expect(h.ocr.enabled).toBe(false);
    expect(h.ocr.capture).toBe(false);

    await observeRequest({ messages: [{ role: "user", content: "hello" }] }, { endpoint: "/v1/chat" });
  });

  it("does not enable OCR when library lacks createOcrWorker export", async () => {
    process.env.PII_GUARD_OCR = "1";
    const mockCode = `
      export function createDetector() { return { scan: () => [], knownCount: 0 }; }
      export function scanBody(body, detector, onImage) {
        if (typeof onImage === "function") throw new Error("onImage should not be passed when worker missing");
        return { findings: [], chars: 0, images: 1, imageBytes: 100, unscanned: {} };
      }
    `;
    await writeFile(mockModuleFile, mockCode);

    ({ observeRequest, health } = await import("../../src/lib/piiGuard/observe.js"));
    await observeRequest({ messages: [{ role: "user", content: "hello" }] }, { endpoint: "/v1/chat" });
    const h = health();
    expect(h.ocr.enabled).toBe(false);
  });

  it("wires onImage without awaiting, writes hit and no-hit OCR events", async () => {
    process.env.PII_GUARD_OCR = "1";

    const mockCode = `
      export const queued = [];
      export function createDetector() { return { scan: () => [], knownCount: 0 }; }
      export function scanBody(body, detector, onImage) {
        if (typeof onImage === "function") {
          onImage({ data: "fake-image-1", source: "user/image" });
          onImage({ data: "fake-image-2", source: "user/image" });
        }
        return { findings: [], chars: 0, images: 2, imageBytes: 200, unscanned: {} };
      }
      export function createOcrWorker(options, deps) {
        return {
          enqueue(image, done) {
            queued.push({ image, done });
            return true;
          },
          close() { return Promise.resolve(); }
        };
      }
    `;
    await writeFile(mockModuleFile, mockCode);

    ({ observeRequest, health } = await import("../../src/lib/piiGuard/observe.js"));
    const mockMod = await import(mockModuleFile);

    let requestFinished = false;
    const reqPromise = observeRequest(
      { messages: [{ role: "user", content: "hello with images" }] },
      { endpoint: "/v1/chat/completions", userAgent: "test-ua/1.0", model: "claude-3-haiku" }
    ).then(() => {
      requestFinished = true;
    });

    await reqPromise;
    expect(requestFinished).toBe(true);
    expect(mockMod.queued).toHaveLength(2);

    // Call done asynchronously for image 0 (with a hit)
    mockMod.queued[0].done({
      status: "scanned",
      source: "user/image/ocr",
      cache: "miss",
      ocrMs: 120,
      queueMs: 15,
      sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      findings: [{
        rule: "pan",
        name: "pan",
        kind: "pii",
        hash: "panhash12345",
      }],
    });

    // Call done asynchronously for image 1 (no hits)
    mockMod.queued[1].done({
      status: "empty",
      cache: "miss",
      ocrMs: 80,
      queueMs: 20,
      sha256: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
      findings: [],
    });

    const parsedEvents = await lines(eventsFile, 2);
    expect(parsedEvents).toHaveLength(2);

    const hitEvent = parsedEvents.find(e => e.imageIndex === 0);
    expect(hitEvent).toBeDefined();
    expect(hitEvent.type).toBe("ocr");
    expect(hitEvent.mode).toBe("enhanced");
    expect(hitEvent.imageIndex).toBe(0);
    expect(hitEvent.endpoint).toBe("/v1/chat/completions");
    expect(hitEvent.model).toBe("claude-3-haiku");
    expect(hitEvent.ua).toBe("test-ua/1.0");
    expect(hitEvent.status).toBe("scanned");
    expect(hitEvent.cache).toBe("miss");
    expect(hitEvent.ocrMs).toBe(120);
    expect(hitEvent.queueMs).toBe(15);
    expect(hitEvent.sha256Prefix).toBe("0123456789ab");
    expect(hitEvent.counts).toEqual({ pan: 1 });
    expect(hitEvent.hits).toEqual([{
      hash: "panhash12345",
      rule: "pan",
      name: "pan",
      kind: "pii",
      source: "user/image/ocr",
      action: "observe",
    }]);

    const noHitEvent = parsedEvents.find(e => e.imageIndex === 1);
    expect(noHitEvent).toBeDefined();
    expect(noHitEvent.type).toBe("ocr");
    expect(noHitEvent.imageIndex).toBe(1);
    expect(noHitEvent.status).toBe("empty");
    expect(noHitEvent.counts).toEqual({});
    expect(noHitEvent.hits).toEqual([]);
    expect(noHitEvent.sha256Prefix).toBe("fedcba987654");
  });

  it("writes skipped / queue_full event when enqueue returns false", async () => {
    process.env.PII_GUARD_OCR = "1";

    const mockCode = `
      export function createDetector() { return { scan: () => [], knownCount: 0 }; }
      export function scanBody(body, detector, onImage) {
        if (typeof onImage === "function") {
          onImage({ data: "burst-image", source: "user/image" });
        }
        return { findings: [], chars: 0, images: 1, imageBytes: 100, unscanned: {} };
      }
      export function createOcrWorker() {
        return {
          enqueue(image, done) {
            return false; // Queue full!
          },
          close() { return Promise.resolve(); }
        };
      }
    `;
    await writeFile(mockModuleFile, mockCode);

    ({ observeRequest } = await import("../../src/lib/piiGuard/observe.js"));

    await observeRequest(
      { messages: [{ role: "user", content: "image" }] },
      { endpoint: "/v1/chat" }
    );

    const parsedEvents = await lines(eventsFile, 1);
    expect(parsedEvents).toHaveLength(1);
    expect(parsedEvents[0]).toMatchObject({
      type: "ocr",
      status: "skipped",
      reason: "queue_full",
      counts: {},
      hits: [],
    });
  });

  it("passes capture store and options when PII_GUARD_CAPTURE_IMAGES=1", async () => {
    process.env.PII_GUARD_OCR = "1";
    process.env.PII_GUARD_CAPTURE_IMAGES = "1";
    process.env.PII_GUARD_CAPTURE_MAX_BYTES = "104857600";
    process.env.PII_GUARD_CAPTURE_TTL_DAYS = "7";

    const mockCode = `
      export let capturedOptions = null;
      export let capturedDeps = null;
      export function createDetector() { return { scan: () => [], knownCount: 0 }; }
      export function scanBody(body, detector, onImage) {
        return { findings: [], chars: 0, images: 0, imageBytes: 0, unscanned: {} };
      }
      export function createOcrWorker(options, deps) {
        capturedOptions = options;
        capturedDeps = deps;
        return {
          enqueue: () => true,
          close: () => Promise.resolve(),
        };
      }
      export function createCaptureStore(opts) {
        return { put: () => Promise.resolve(), sweep: () => Promise.resolve() };
      }
      export function startSweeper() {
        return () => {};
      }
    `;
    await writeFile(mockModuleFile, mockCode);

    ({ observeRequest, health } = await import("../../src/lib/piiGuard/observe.js"));
    await (await import("../../src/lib/piiGuard/observe.js")).ready();
    const h = health({ ocr: { mode: "observe" } });
    expect(h.ocr.enabled).toBe(true);
    expect(h.ocr.capture).toBe(true);

    await observeRequest({ messages: [{ role: "user", content: "test" }] }, { endpoint: "/v1/chat" }, { mode: "observe", ocr: { mode: "observe" } });

    const mockMod = await import(mockModuleFile);
    expect(mockMod.capturedOptions.capture).toMatchObject({
      maxBytes: 104857600,
      ttlMs: 7 * 24 * 60 * 60 * 1000,
    });
    expect(mockMod.capturedDeps.captureStore).toBeDefined();
  });

  it("passes PII_GUARD_OCR_MODE to the worker and health, and falls back to enhanced", async () => {
    process.env.PII_GUARD_OCR = "1";
    const mockCode = `
      export let capturedOptions = null;
      export function createDetector() { return { scan: () => [], knownCount: 0 }; }
      export function scanBody() { return { findings: [], chars: 0, images: 0, imageBytes: 0, unscanned: {} }; }
      export function createOcrWorker(options) { capturedOptions = options; return { enqueue: () => true, close: () => Promise.resolve() }; }
    `;
    await writeFile(mockModuleFile, mockCode);
    for (const [env, want] of [["basic", "basic"], ["bogus", "enhanced"]]) {
      vi.resetModules();
      process.env.PII_GUARD_OCR_MODE = env;
      const mod = await import("../../src/lib/piiGuard/observe.js");
      await mod.observeRequest({ messages: [{ role: "user", content: "x" }] }, { endpoint: "/v1/chat" });
      expect(mod.health().ocr.mode).toBe(want);
      expect((await import(mockModuleFile)).capturedOptions.mode).toBe(want);
    }
    delete process.env.PII_GUARD_OCR_MODE;
  });

  it("recreates OCR worker and closes old worker when known file mtime changes", async () => {
    process.env.PII_GUARD_OCR = "1";

    const mockCode = `
      export let workers = [];
      export function createDetector(opts) { return { scan: () => [], knownCount: opts?.known?.length || 0 }; }
      export function scanBody(body, detector, onImage) {
        if (typeof onImage === "function") onImage({ data: "img", source: "user/image" });
        return { findings: [], chars: 0, images: 1, imageBytes: 10, unscanned: {} };
      }
      export function createOcrWorker(options, deps) {
        const worker = {
          options,
          closed: false,
          enqueue: () => true,
          close: () => { worker.closed = true; return Promise.resolve(); }
        };
        workers.push(worker);
        return worker;
      }
    `;
    await writeFile(mockModuleFile, mockCode);

    ({ observeRequest } = await import("../../src/lib/piiGuard/observe.js"));
    const mockMod = await import(mockModuleFile);

    await observeRequest({ messages: [{ role: "user", content: "first" }] }, { endpoint: "/v1/chat" });
    expect(mockMod.workers).toHaveLength(1);
    const worker1 = mockMod.workers[0];
    expect(worker1.closed).toBe(false);

    // Update knownFile and set mtime to future
    const { utimes } = await import("node:fs/promises");
    await writeFile(knownFile, JSON.stringify({ version: 1, salt: "abcdef1234567890", items: [{ name: "item1", value: "val1" }] }));
    const future = new Date(Date.now() + 5000);
    await utimes(knownFile, future, future);

    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 31_000);

    await observeRequest({ messages: [{ role: "user", content: "second" }] }, { endpoint: "/v1/chat" });
    expect(mockMod.workers).toHaveLength(2);
    expect(worker1.closed).toBe(true);
    const worker2 = mockMod.workers[1];
    expect(worker2.closed).toBe(false);
    expect(worker2.options.detector.salt).toBe("abcdef1234567890");
  });
});
