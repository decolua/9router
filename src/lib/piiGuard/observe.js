import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { appendFile, chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { clientOf } from "../spendClient.js";
import { capture as capturePrompts, collect as collectPrompts, stats as promptStats } from "./prompts.js";

const since = new Date().toISOString();
let loading, library, detector, knownMtime, lastCheck = -Infinity, warnedAt = -Infinity;
let requests = 0, withFindings = 0, totalRequests = 0, totalWithFindings = 0, samples = [], healthSamples = [], maxScanMs = 0, healthMaxScanMs = 0, errors = 0, lastError = null;
let knownUpdated = null, seenLoading, seenStore, seenTimer, unscanned = { images: 0, files: 0, opaque: 0 };
export const OCR_CONCURRENCY = 2;
let ocrWorker = null, captureStore = null, sweeperStarted = false, detectorOptions = null;
const errorAppend = new Map(), errorSuppressed = new Map();
const roles = new Set(["-", "system", "developer", "user", "assistant", "tool", "function", "model"]);
const types = new Set(["-", "text", "input_text", "output_text", "tool_result", "tool_use", "function_call", "function_call_output", "thinking", "redacted_thinking", "reasoning", "image", "input_image", "image_url"]);
export function safeSource(source) {
  const [role, type, ocr] = typeof source === "string" ? source.split("/") : [];
  const base = `${roles.has(role) ? role : "-"}/${types.has(type) ? type : "-"}`;
  return ocr === "ocr" ? `${base}/ocr` : base;
}
function warn() {
  if (Date.now() - warnedAt >= 60_000) { warnedAt = Date.now(); console.warn("[pii-guard] Observation failed; requests continue normally."); }
}
function append(event) {
  const file = eventsFile();
  return mkdir(dirname(file), { recursive: true, mode: 0o700 }).then(() => appendFile(file, `${JSON.stringify(event)}\n`, { mode: 0o600 }));
}
function failure(stage) {
  errors++;
  const ts = new Date().toISOString(); lastError = { ts, stage }; warn();
  const now = Date.now();
  // One event per stage per minute; `count` carries the failures folded into it.
  errorSuppressed.set(stage, (errorSuppressed.get(stage) || 0) + 1);
  if (now - (errorAppend.get(stage) || 0) >= 60_000) { errorAppend.set(stage, now); const count = errorSuppressed.get(stage); errorSuppressed.set(stage, 0); void append({ ts, type: "error", stage, count }).catch(() => {}); }
}
function seenFile() { return join(dirname(eventsFile()), "seen.json"); }
async function loadSeen() {
  if (!seenLoading) seenLoading = (async () => {
    try {
      const data = JSON.parse(await readFile(seenFile(), "utf8"));
      if (data.version !== 1 || !data.hashes || typeof data.hashes !== "object" || Array.isArray(data.hashes) || Object.entries(data.hashes).some(([h, ts]) => !/^[0-9a-f]{12}$/i.test(h) || typeof ts !== "string")) throw new Error("Invalid seen store");
      seenStore = new Map(Object.entries(data.hashes).slice(-50_000));
    } catch (error) { if (error.code !== "ENOENT") failure("seen"); seenStore = new Map(); }
  })();
  await seenLoading;
  return seenStore;
}
function scheduleSeenWrite() {
  if (seenTimer) return;
  seenTimer = setTimeout(async () => {
    try {
      const entries = [...seenStore.entries()].slice(-50_000);
      const file = seenFile(), tmp = `${file}.${process.pid}.tmp`;
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(tmp, `${JSON.stringify({ version: 1, hashes: Object.fromEntries(entries) })}\n`, { mode: 0o600 });
      await chmod(tmp, 0o600);
      await rename(tmp, file); // atomic: a crash never leaves a truncated store
    } catch { failure("write"); }
    seenTimer = null; // cleared after the write so writes never overlap
  }, 5000);
  seenTimer.unref();
}
function markSeen(hashes) {
  const now = new Date().toISOString();
  for (const hash of hashes) {
    seenStore.delete(hash); seenStore.set(hash, now);
    if (seenStore.size > 50_000) seenStore.delete(seenStore.keys().next().value);
  }
  if (hashes.length) scheduleSeenWrite();
}
function reload() {
  const now = Date.now();
  if (now - lastCheck < 30_000) return;
  lastCheck = now;
  const file = process.env.PII_GUARD_KNOWN || join(homedir(), ".config/pii-guard/known.json");
  let mtime;
  try { mtime = statSync(file).mtimeMs; } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (detector && mtime === knownMtime) return;
  if (mtime === undefined) {
    // Stable salt so seen and ignored hashes survive restarts without a known list.
    const saltFile = join(dirname(eventsFile()), "salt");
    let salt;
    try { salt = readFileSync(saltFile, "utf8").trim(); } catch (error) { if (error.code !== "ENOENT") throw error; salt = randomBytes(16).toString("hex"); mkdirSync(dirname(saltFile), { recursive: true, mode: 0o700 }); writeFileSync(saltFile, salt, { mode: 0o600 }); }
    detector = library.createDetector({ salt }); knownUpdated = null;
    detectorOptions = { salt };
    console.info("[pii-guard] Known list missing; scanning patterns only.");
  } else {
    const known = JSON.parse(readFileSync(file, "utf8"));
    if (known.version !== 1 || !Array.isArray(known.items) || typeof known.salt !== "string" || !/^(?:[0-9a-f]{2})+$/i.test(known.salt) || known.items.some(item => !item || typeof item.name !== "string" || typeof item.value !== "string")) throw new Error("Invalid known list");
    detector = library.createDetector({ known: known.items, salt: known.salt });
    knownUpdated = new Date(mtime).toISOString();
    detectorOptions = { known: known.items, salt: known.salt };
  }
  knownMtime = mtime;
  if (ocrWorker) {
    closeOcrWorker();
  }
}
function isOcrEnabled() {
  if (process.env.PII_GUARD_OCR !== "1") return false;
  if (!library) return true;
  return typeof library.createOcrWorker === "function";
}
// "enhanced" (library default): ffmpeg cleanup and OCR text repair. "basic": raw Tesseract, for comparison.
function ocrMode(config = {}) {
  const m = config?.ocr?.quality;
  if (m === "basic" || m === "enhanced") return m;
  const envMode = process.env.PII_GUARD_OCR_MODE;
  return envMode === "basic" || envMode === "enhanced" ? envMode : "enhanced";
}
function ocrConfigured(config = {}) {
  return config?.ocr?.mode !== "off" && config?.mode !== "off";
}
function closeOcrWorker() {
  if (!ocrWorker) return;
  const old = ocrWorker;
  ocrWorker = null;
  try { void Promise.resolve(old.close()).catch(() => {}); } catch {}
}

let ocrWorkerQuality;
const OCR_OFF = "off";
const OCR_OBSERVE = "observe";
const OCR_QUALITIES = ["basic", "enhanced"];
const OCR_MODES = [OCR_OFF, OCR_OBSERVE];
const ocrConfig = config => ({ mode: OCR_MODES.includes(config?.ocr?.mode) ? config.ocr.mode : OCR_OBSERVE, quality: OCR_QUALITIES.includes(config?.ocr?.quality) ? config.ocr.quality : ocrMode() });
const ocrAvailable = () => process.env.PII_GUARD_OCR === "1" && typeof library?.createOcrWorker === "function";
const ocrTestable = () => typeof library?.ocrImage === "function";
const ocrEffective = config => ocrAvailable() && ocrConfigured(config);
const testSource = input => input === "image" ? "test/image/ocr" : "test/text";
async function logTest(input, findings, options = {}) {
  const hits = findings.map(f => ({ hash: f.hash, rule: f.rule, ...(f.name && { name: f.name }), kind: f.kind, source: testSource(input), action: f.action }));
  try { await append({ ts: new Date().toISOString(), type: "test", test: true, input, ...(options.where && { where: options.where }), ...(options.sample && { sample: options.sample }), ...(options.mode && { mode: options.mode }), ...(options.ocrMs !== undefined && { ocrMs: options.ocrMs }), ...(options.status && { status: options.status }), hits }); } catch { failure("write"); }
}
function decide(config, ignore) {
  const act = actionFor(config);
  return f => ignore.has(f.hash) ? "ignored" : act(f.rule);
}

function isCaptureEnabled() {
  return isOcrEnabled() && process.env.PII_GUARD_CAPTURE_IMAGES === "1";
}
function getCaptureConfig() {
  const dir = join(dirname(eventsFile()), "images");
  const rawBytes = Number(process.env.PII_GUARD_CAPTURE_MAX_BYTES);
  const maxBytes = Number.isFinite(rawBytes) && rawBytes > 0 ? rawBytes : 2 * 1024 * 1024 * 1024;
  const rawDays = Number(process.env.PII_GUARD_CAPTURE_TTL_DAYS);
  const ttlDays = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 14;
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  return { dir, maxBytes, ttlMs };
}
function initCaptureStore() {
  if (captureStore || !isCaptureEnabled()) return captureStore;
  if (typeof library?.createCaptureStore !== "function") return null;
  try {
    const config = getCaptureConfig();
    captureStore = library.createCaptureStore({
      ...config,
      onError() { failure("capture"); },
    });
    if (typeof captureStore.sweep === "function") {
      void Promise.resolve(captureStore.sweep()).catch(() => {});
    }
    if (!sweeperStarted) {
      sweeperStarted = true;
      if (typeof library.startSweeper === "function") {
        library.startSweeper(captureStore, 3_600_000);
      } else {
        const timer = setInterval(() => { void Promise.resolve(captureStore.sweep()).catch(() => {}); }, 3_600_000);
        timer.unref();
      }
    }
  } catch {
    failure("capture");
  }
  return captureStore;
}
function getOcrWorker(config = {}) {
  if (!ocrEffective(config)) return null;
  const quality = ocrMode(config);
  if (ocrWorker && ocrWorkerQuality !== quality) closeOcrWorker();
  if (ocrWorker) return ocrWorker;
  if (!detectorOptions) return null;
  try {
    const captureConfig = isCaptureEnabled() ? getCaptureConfig() : undefined;
    const store = initCaptureStore();
    const options = {
      detector: detectorOptions,
      mode: quality,
      // 4 vCPU: two Tesseract runs at once keep bursts of resent screenshots from filling the queue.
      concurrency: OCR_CONCURRENCY,
      ...(captureConfig ? { capture: captureConfig } : {}),
    };
    const deps = store ? { captureStore: store } : undefined;
    ocrWorker = library.createOcrWorker(options, deps);
    ocrWorkerQuality = quality;
    return ocrWorker;
  } catch {
    failure("ocr");
    return null;
  }
}
function stats() {
  if (!requests) return;
  const sorted = samples.slice().sort((a, b) => a - b);
  const percentile = p => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : 0;
  void append({ ts: new Date().toISOString(), type: "stats", requests, withFindings, p50ScanMs: percentile(0.5), p95ScanMs: percentile(0.95), maxScanMs }).catch(() => failure("write"));
  requests = withFindings = maxScanMs = 0; samples = [];
}
const ACTIONS = ["off", "observe", "redact", "block"];
// Keep the rows that matter most when an event's hit list is capped.
const RANK = { leaked: 0, block: 1, redact: 2, observe: 3, ignored: 4 };
export function blockMessage(names, chat = true, stuck = false) {
  // A value in signed thinking of the active tool loop cannot be rewritten, so a retry would be blocked again.
  if (stuck && chat) return `pii-guard blocked: ${names.join(", ")}. At least one value sits inside signed thinking, which cannot be redacted, so retrying will not help: run /rewind to drop that turn. Change rules in Dashboard > PII Guard.`;
  return `pii-guard blocked a new value: ${names.join(", ")}. It is now remembered; retry and it will be redacted${chat ? ", or run /rewind to drop that turn" : ""}. Change rules in Dashboard > PII Guard.`;
}
// Where a readonly value sits, for the dashboard.
function where(f) {
  if (/\[key:\d+\]$/.test(f.path)) return "key";
  if (f.path === "") return "body";
  if (/\/(?:redacted_)?thinking$/.test(f.source)) return "assistant/thinking";
  return "number";
}
// Signed thinking can be dropped from earlier assistant turns, but the provider requires it
// on the last assistant turn while a tool loop is running (last message carries a tool_result).
function thinkingBlock(body, f) {
  const m = /^messages\[(\d+)\]\.content\[(\d+)\]/.exec(f.path);
  const messages = body?.messages;
  if (!m || !Array.isArray(messages) || !/\/thinking$/.test(f.source)) return;
  const i = +m[1], j = +m[2], block = messages[i]?.content?.[j];
  if (messages[i]?.role !== "assistant" || block?.type !== "thinking") return;
  // The open turn starts after the last user message that is not only tool results; its thinking must stay.
  const toolOnly = x => Array.isArray(x?.content) && x.content.length && x.content.every(c => c?.type === "tool_result");
  const lastUser = messages.findLastIndex(x => x?.role === "user" && !toolOnly(x));
  return i > lastUser ? undefined : { i, j };
}
export async function ready() {
  if (!process.env.PII_GUARD_MODULE) return false;
  if (!loading) loading = (async () => {
    try {
      const p = process.env.PII_GUARD_MODULE;
      if (!isAbsolute(p)) throw new Error("Module path must be absolute");
      library = await import(/* webpackIgnore: true */ pathToFileURL(p).href);
      if (typeof library.createDetector !== "function" || typeof library.scanBody !== "function") throw new Error("Invalid scanner");
      const timer = setInterval(stats, 600_000); timer.unref();
      return true;
    } catch { failure("load"); console.warn("[pii-guard] Scanner unavailable; observation disabled."); return false; }
  })();
  if (!await loading) return false;
  try { reload(); } catch { failure("known"); return false; }
  return !!detector;
}
const FALLBACK_GROUPS = [
  { id: "api_key", label: "API keys and secrets" },
  { id: "known", label: "Vault values" },
  { id: "gov_id", label: "Government IDs" },
  { id: "financial", label: "Financial" },
  { id: "contact", label: "Contact" },
  { id: "network", label: "Network" },
];

export function groups() {
  const g = library?.GROUPS;
  const out = (Array.isArray(g) && g.length ? g : FALLBACK_GROUPS).map(x => ({ id: x.id, label: x.label }));
  if (!out.some(x => x.id === "known")) out.push({ id: "known", label: "Vault values" });
  return out;
}

export function rules() {
  // Old library builds lack groups: secrets go to api_key, the rest to "other" (shown with its id as label).
  const fallbackGroup = r => (r.kind === "secret" ? "api_key" : "other");
  return [
    { id: "known", kind: "known", group: "known", label: "Vault values", count: detector?.knownCount || 0 },
    ...(library?.RULES || []).map(r => ({
      id: r.id,
      kind: r.kind,
      group: r.group || fallbackGroup(r),
      label: r.label || r.id,
    })),
  ];
}
export function actionFor(config = {}) {
  const mode = ACTIONS.includes(config.mode) ? config.mode : "observe";
  const overrides = config.rules && typeof config.rules === "object" ? config.rules : {};
  return rule => ACTIONS.includes(overrides[rule]) ? overrides[rule] : mode;
}
const label = f => f.name || f.rule;
function replace(text, findings, action, redacted) {
  const spans = findings.filter(f => action(f) === "redact").sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start) || (a.kind === "known" ? -1 : 1));
  if (!spans.length) return text;
  const chosen = [];
  for (let i = 0; i < spans.length;) {
    let end = spans[i].end, j = i + 1, best = spans[i];
    while (j < spans.length && spans[j].start < end) { if (spans[j].end - spans[j].start > best.end - best.start || (spans[j].kind === "known" && best.kind !== "known")) best = spans[j]; end = Math.max(end, spans[j].end); j++; }
    chosen.push({ start: spans[i].start, end, finding: best }); i = j;
  }
  let out = "", at = 0;
  for (const span of chosen) {
    out += text.slice(at, span.start) + detector.placeholder(span.finding); at = span.end;
    redacted[label(span.finding)] = (redacted[label(span.finding)] || 0) + 1;
  }
  return out + text.slice(at);
}
function handleOcrResult(result, requestId, imageIndex, meta, body, config, model, ua) {
  try {
    const act = actionFor(config);
    const ignore = new Set(Array.isArray(config?.ignore) ? config.ignore.filter(h => typeof h === "string" && /^[0-9a-f]{12}$/i.test(h)) : []);
    const counts = {};
    const hitRows = new Map();
    const findings = Array.isArray(result?.findings) ? result.findings : [];

    for (const f of findings) {
      if (!f || typeof f.rule !== "string" || typeof f.hash !== "string") continue;
      const ruleAct = act(f.rule);
      if (ruleAct === "off") continue;

      const isIgnored = ignore.has(f.hash);
      const action = isIgnored ? "ignored" : "observe";
      const lbl = f.name || f.rule;
      if (!isIgnored) counts[lbl] = (counts[lbl] || 0) + 1;

      const source = safeSource(f.source || result?.source || "-/-/ocr");
      const key = `${f.hash}|${source}`;
      if (!hitRows.has(key) || RANK[action] < RANK[hitRows.get(key).action]) {
        hitRows.set(key, {
          hash: f.hash,
          rule: f.rule,
          ...(f.name && { name: f.name }),
          kind: f.kind,
          source,
          action,
        });
      }
    }

    const hits = [...hitRows.values()].sort((a, b) => RANK[a.action] - RANK[b.action]).slice(0, 200);
    const hitsDropped = hitRows.size > hits.length ? hitRows.size - hits.length : undefined;
    const sha256Prefix = typeof result?.sha256 === "string" && result.sha256.length >= 12
      ? result.sha256.slice(0, 12)
      : (typeof result?.sha256 === "string" ? result.sha256 : undefined);

    const event = {
      ts: new Date().toISOString(),
      type: "ocr",
      mode: ocrMode(config),
      requestId,
      imageIndex,
      endpoint: meta?.endpoint,
      model: model || (body?.model ?? meta?.model),
      ua,
      status: result?.status || "empty",
      reason: result?.reason,
      cache: result?.cache || "none",
      ocrMs: typeof result?.ocrMs === "number" ? result.ocrMs : 0,
      queueMs: typeof result?.queueMs === "number" ? result.queueMs : 0,
      sha256Prefix,
      counts,
      hits,
      hitsDropped,
    };

    void append(event).catch(() => failure("write"));
    const summary = Object.entries(counts).map(([k, n]) => `${k}=${n}`).join(", ");
    if (summary) console.warn(`[pii-guard] ${event.model || "-"} ${event.endpoint || "-"} image ${imageIndex} (ocr ${event.mode}, ${event.cache}): ${summary}`);
  } catch {
    failure("ocr");
  }
}

export async function observeRequest(body, meta = {}, config = {}) {
  if (!process.env.PII_GUARD_MODULE || config.mode === "off") return;
  let stage = "load";
  try {
    if (!await ready()) return;
    stage = "known";
    const seen = await loadSeen();
    const act = actionFor(config), ignore = new Set(Array.isArray(config.ignore) ? config.ignore.filter(h => typeof h === "string" && /^[0-9a-f]{12}$/i.test(h)) : []);
    const start = performance.now(); stage = "scan";
    let foundActions = new Map(), redacted = Object.create(null), leaked = Object.create(null);
    // scanBody mutates incrementally; a thrown scan may leave partial redaction, which is safer than retaining exposed values.
    const hasRedact = config.mode === "redact" || config.mode === "block" || Object.values(config.rules || {}).some(a => a === "redact" || a === "block");
    // Block stops only a value never seen before; once remembered it is redacted so the session can continue.
    // A readonly value cannot be redacted, so a block rule keeps blocking it.
    const decide = f => ignore.has(f.hash) ? "ignored" : act(f.rule) === "block" ? (seen.has(f.hash) && !f.readonly ? "redact" : "block") : act(f.rule);

    const requestId = randomUUID();
    // Session ids come from client headers; store a keyed hash so a value in one never reaches disk.
    const sessionKey = typeof meta.sessionId === "string" && meta.sessionId ? createHash("sha256").update(meta.sessionId).digest("hex").slice(0, 24) : null;
    const ua0 = (meta.userAgent || "").split(" ")[0];
    const ua = detector.scan(ua0).length ? "[redacted]" : ua0;
    let model = body?.model ?? meta.model;

    let imageIndex = 0;
    const worker = getOcrWorker(config);
    const onImage = worker ? (image) => {
      const idx = imageIndex++;
      try {
        const enqueued = worker.enqueue(image, (result) => {
          try {
            handleOcrResult(result, requestId, idx, meta, body, config, model, ua);
          } catch {
            failure("ocr");
          }
        });
        if (!enqueued) {
          handleOcrResult({
            status: "skipped",
            reason: "queue_full",
            findings: [],
            cache: "none",
            ocrMs: 0,
            queueMs: 0,
          }, requestId, idx, meta, body, config, model, ua);
        }
      } catch {
        failure("ocr");
      }
    } : undefined;

    // Prompt store: references to the original strings, taken before redaction rewrites the body.
    const promptNodes = process.env.PII_GUARD_PROMPTS !== "off" ? collectPrompts(body) : [];
    const result = library.scanBody(body, detector, onImage, hasRedact ? (text, fs) => replace(text, fs, decide, redacted) : undefined);
    const findings = result.findings;
    // Readonly thinking outside the active tool loop becomes removable, so it is treated like editable text.
    // Inside the active loop it stays: it is the provider's own signed output, so replaying it discloses nothing new.
    // Redact reports it as leaked; only Block stops it (with a /rewind hint).
    const drop = new Map();
    for (const f of findings) if (f.readonly) { const at = thinkingBlock(body, f); if (at) { delete f.readonly; drop.set(f, at); } }
    // meta.model is a pre-scan copy; log the body value, which redaction may have rewritten, and drop it if it held a finding.
    model = findings.some(f => /^\.?model$/.test(f.path)) ? "[redacted]" : body?.model ?? meta.model;
    capturePrompts({ nodes: promptNodes, bodyFindings: findings.map(f => ({ path: f.path, start: f.start, end: f.end, hash: f.hash, rule: f.rule, kind: f.kind })), requestId, sessionId: sessionKey, model, client: clientOf(ua0) }, library, detector);
    for (const f of findings) foundActions.set(f, decide(f));
    const strip = new Map();
    for (const [f, at] of drop) if (foundActions.get(f) === "redact") { strip.set(`${at.i}:${at.j}`, at); redacted[label(f)] = (redacted[label(f)] || 0) + 1; }
    for (const { i, j } of [...strip.values()].sort((a, b) => b.i - a.i || b.j - a.j)) { const c = body.messages[i].content; c.splice(j, 1); if (!c.length) c.push({ type: "text", text: "[thinking removed by pii-guard]" }); }
    const stuck = findings.some(f => f.readonly && foundActions.get(f) === "block" && where(f) === "assistant/thinking");
    const preliminaryBlocked = new Set(findings.filter(f => foundActions.get(f) === "block").map(label));
    for (const f of findings) if (f.readonly && foundActions.get(f) === "redact") leaked[label(f)] = (leaked[label(f)] || 0) + 1;
    const scanMs = performance.now() - start;
    requests++; totalRequests++; if (samples.length === 10_000) samples.shift(); samples.push(scanMs); if (healthSamples.length === 10_000) healthSamples.shift(); healthSamples.push(scanMs); maxScanMs = Math.max(maxScanMs, scanMs); healthMaxScanMs = Math.max(healthMaxScanMs, scanMs);
    for (const k of Object.keys(unscanned)) unscanned[k] += result.unscanned[k] || 0;
    if (!findings.some(f => foundActions.get(f) !== "off")) return;
    const counts = Object.create(null), fresh = [], hitRows = new Map(), newHashes = [];
    for (const f of findings) {
      const action = foundActions.get(f);
      if (action === "off") continue;
      const source = safeSource(f.source), key = `${f.hash}|${source}`;
      if (action !== "ignored") {
        counts[label(f)] = (counts[label(f)] || 0) + 1;
        if (!seen.has(f.hash) && !newHashes.includes(f.hash)) { newHashes.push(f.hash); fresh.push({ rule: f.rule, ...(f.name && { name: f.name }), kind: f.kind, hash: f.hash, source, action }); }
      }
      const hitAction = action === "block" ? "block" : action === "ignored" ? "ignored" : f.readonly && action === "redact" ? "leaked" : action;
      // A leaked or block occurrence must win over a redacted one for the same value and source.
      if (!hitRows.has(key) || RANK[hitAction] < RANK[hitRows.get(key).action]) hitRows.set(key, { hash: f.hash, rule: f.rule, ...(f.name && { name: f.name }), kind: f.kind, source, action: hitAction, ...(f.readonly && { where: where(f) }), ...preview(f) });
    }
    const blocked = [...preliminaryBlocked], hits = [...hitRows.values()].sort((a, b) => RANK[a.action] - RANK[b.action]).slice(0, 200);
    withFindings++; totalWithFindings++;
    const event = { ts: new Date().toISOString(), requestId, ...(sessionKey && { sessionId: sessionKey }), endpoint: meta.endpoint, model: model, ua, chars: result.chars, images: result.images, imageBytes: result.imageBytes, unscanned: result.unscanned, scanMs, counts, new: fresh, hits, ...(hitRows.size > hits.length && { hitsDropped: hitRows.size - hits.length }), ...(blocked.length && { blocked }), ...(Object.keys(redacted).length && { redacted }), ...(Object.keys(leaked).length && { leaked }), ignored: findings.filter(f => foundActions.get(f) === "ignored").length };
    markSeen(newHashes);
    void append(event).catch(() => failure("write"));
    const summary = Object.entries(counts).map(([k, n]) => `${k}=${n}`).join(", ");
    const line = `[pii-guard] ${model || "-"} ${meta.endpoint || "-"}: ${summary}`;
    if (blocked.length) console.error(`${line} BLOCKED: ${blocked.join(", ")}`);
    else if (Object.keys(leaked).length) console.error(`${line} LEAKED (not rewritable): ${Object.entries(leaked).map(([k, n]) => `${k}=${n}`).join(", ")}`);
    else if (Object.keys(redacted).length) console.warn(`${line} redacted: ${Object.entries(redacted).map(([k, n]) => `${k}=${n}`).join(", ")}`);
    else if (fresh.length) console.warn(`${line} (new: ${[...new Set(fresh.map(label))].join(", ")})`);
    else console.info(line);
    if (blocked.length) return { blocked, ...(stuck && { stuck }) };
  } catch { failure(stage); }
}
// The library masks previews; recheck shape here so a raw value can never reach the log from an old library build.
// Edge chars (at most 11, e.g. "sk-svcacct-"), the 5-dot mask, then up to 3 tail chars or an email domain.
const PREVIEW = /^[^•]{0,11}•••••(?:[^•@]{0,3}|@[^•\s@]{1,253})$/u;
function preview(f) {
  if (typeof f.preview !== "string" || !PREVIEW.test(f.preview) || typeof f.context !== "string" || f.context.length > 340 || !f.context.includes(f.preview) || /\d/.test(f.context.replace(f.preview, ""))) return {};
  return { preview: f.preview, context: f.context };
}
const WHERE = {
  user: text => ({ messages: [{ role: "user", content: text }] }),
  system: text => ({ system: text, messages: [] }),
  assistant: text => ({ messages: [{ role: "assistant", content: [{ type: "text", text }] }] }),
  tool_result: text => ({ messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: text }] }] }),
  // Active tool loop: the signed thinking must be replayed unchanged.
  thinking: text => ({ messages: [{ role: "assistant", content: [{ type: "thinking", thinking: text, signature: "preview" }, { type: "tool_use", id: "t", name: "x", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "" }] }] }),
};
const READ = { user: b => b.messages[0].content, system: b => b.system, assistant: b => b.messages[0].content[0].text, tool_result: b => b.messages[0].content[0].content, thinking: b => b.messages[0].content[0].thinking };
export async function testText(text, config, at = "user") {
  if (!await ready()) return null;
  if (!Object.hasOwn(WHERE, at)) at = "user";
  const act = actionFor(config), body = WHERE[at](text), redacted = Object.create(null);
  const ignore = new Set(Array.isArray(config.ignore) ? config.ignore.filter(h => typeof h === "string" && /^[0-9a-f]{12}$/i.test(h)) : []);
  const decide = f => ignore.has(f.hash) ? "ignored" : act(f.rule);
  const result = library.scanBody(body, detector, undefined, (s, fs) => replace(s, fs, decide, redacted));
  const findings = result.findings.filter(f => !/\[key:\d+\]$/.test(f.path)).map(f => {
    const action = decide(f);
    return { rule: f.rule, ...(f.name && { name: f.name }), kind: f.kind, hash: f.hash, action: f.readonly && action === "redact" ? "leaked" : action, match: text.slice(f.start, f.end) };
  });
  await logTest("text", findings, { where: at, mode: config?.mode });
  return { findings, before: text, redacted: READ[at](body), blocked: findings.filter(f => f.action === "block").map(f => f.name || f.rule) };
}
export async function testImage(buffer, config = {}, quality = "enhanced", options = {}) {
  if (!await ready() || typeof library.ocrImage !== "function") return null;
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
  const mode = OCR_QUALITIES.includes(quality) ? quality : ocrMode(config);
  const result = await library.ocrImage(buffer, detector, mode);
  const ignore = new Set(Array.isArray(config.ignore) ? config.ignore.filter(h => typeof h === "string" && /^[0-9a-f]{12}$/i.test(h)) : []);
  const decideHit = decide(config, ignore);
  const findings = (Array.isArray(result.findings) ? result.findings : []).map(f => ({ rule: f.rule, ...(f.name && { name: f.name }), kind: f.kind, hash: f.hash, action: decideHit(f), ...(f.match !== undefined && { match: f.match }) }));
  await logTest("image", findings, { sample: options.sample, mode, ocrMs: result.ocrMs, status: result.status });
  return { ...result, findings };
}
export function health(config = {}) {
  const sorted = healthSamples.slice().sort((a, b) => a - b);
  const normalized = ocrConfig(config);
  const ocr = { concurrency: OCR_CONCURRENCY, queueMax: 32, available: ocrAvailable(), enabled: ocrEffective(config), mode: normalized.quality, quality: normalized.quality, capture: process.env.PII_GUARD_CAPTURE_IMAGES === "1", testable: ocrTestable() };
  return { module: !!process.env.PII_GUARD_MODULE, loaded: !!detector, knownCount: detector?.knownCount || 0, knownUpdated, errors, lastError, since, requests: totalRequests, withFindings: totalWithFindings, p95ScanMs: sorted.length ? sorted[Math.ceil(sorted.length * .95) - 1] : 0, maxScanMs: healthMaxScanMs, unscanned: { ...unscanned }, seen: seenStore?.size || 0, ocr, prompts: { ...promptStats, enabled: process.env.PII_GUARD_PROMPTS !== "off" } };
}
export function eventsFile() { return process.env.PII_GUARD_EVENTS || join(homedir(), ".9router/pii-guard/events.jsonl"); }
