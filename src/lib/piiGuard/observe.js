import { readFileSync, statSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

let loading, library, detector, knownMtime, lastCheck = -Infinity, warnedAt = -Infinity;
let requests = 0, withFindings = 0, samples = [], maxScanMs = 0;
const seen = new Set();
const roles = new Set(["-", "system", "developer", "user", "assistant", "tool", "function", "model"]);
const types = new Set(["-", "text", "input_text", "output_text", "tool_result", "tool_use", "function_call", "function_call_output", "reasoning", "image", "input_image", "image_url"]);
function safeSource(source) {
  const [role, type] = typeof source === "string" ? source.split("/") : [];
  return `${roles.has(role) ? role : "-"}/${types.has(type) ? type : "-"}`;
}

function warn() {
  if (Date.now() - warnedAt >= 60_000) {
    warnedAt = Date.now();
    console.warn("[pii-guard] Observation failed; requests continue normally.");
  }
}

function append(event) {
  const file = eventsFile();
  void mkdir(dirname(file), { recursive: true, mode: 0o700 })
    .then(() => appendFile(file, `${JSON.stringify(event)}\n`, { mode: 0o600 }))
    .catch(warn);
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
    detector = library.createDetector();
    console.info("[pii-guard] Known list missing; scanning patterns only.");
  } else {
    const known = JSON.parse(readFileSync(file, "utf8"));
    if (known.version !== 1 || !Array.isArray(known.items) || typeof known.salt !== "string" || !/^(?:[0-9a-f]{2})+$/i.test(known.salt) ||
        known.items.some(item => !item || typeof item.name !== "string" || typeof item.value !== "string")) throw new Error("Invalid known list");
    detector = library.createDetector({ known: known.items, salt: known.salt });
  }
  knownMtime = mtime;
}

function stats() {
  if (!requests) return;
  const sorted = samples.slice().sort((a, b) => a - b);
  const percentile = p => sorted[Math.ceil(sorted.length * p) - 1];
  append({ ts: new Date().toISOString(), type: "stats", requests, withFindings, p50ScanMs: percentile(0.5), p95ScanMs: percentile(0.95), maxScanMs });
  requests = withFindings = maxScanMs = 0;
  samples = [];
}

const ACTIONS = ["off", "observe", "redact", "block"];
const IN_SCOPE = new Set(["user", "tool", "function"]), OUT_SCOPE = new Set(["assistant", "system", "developer", "model"]);
const WALK_KEYS = ["messages", "contents", "input", "content", "parts", "text", "output"];

// Load the scanner once. Returns false when it is unavailable.
export async function ready() {
  if (!process.env.PII_GUARD_MODULE) return false;
  if (!loading) {
    loading = (async () => {
      try {
        const p = process.env.PII_GUARD_MODULE;
        if (!isAbsolute(p)) throw new Error("Module path must be absolute");
        library = await import(/* webpackIgnore: true */ pathToFileURL(p).href);
        if (typeof library.createDetector !== "function" || typeof library.scanBody !== "function") throw new Error("Invalid scanner");
        const timer = setInterval(() => { try { stats(); } catch { warn(); } }, 600_000);
        timer.unref();
        return true;
      } catch {
        console.warn("[pii-guard] Scanner unavailable; observation disabled.");
        return false;
      }
    })();
  }
  if (!await loading) return false;
  reload();
  return !!detector;
}

export function rules() {
  return [{ id: "known", kind: "known", count: detector?.knownCount || 0 }, ...(library?.RULES || []).map(r => ({ id: r.id, kind: r.kind }))];
}

export function actionFor(config = {}) {
  const mode = ACTIONS.includes(config.mode) ? config.mode : "observe";
  const overrides = config.rules && typeof config.rules === "object" ? config.rules : {};
  return rule => (ACTIONS.includes(overrides[rule]) ? overrides[rule] : mode);
}

const label = f => f.name || f.rule;

// Replace findings whose action is "redact"; record "block" findings.
function editText(text, act, hits) {
  const spans = [];
  for (const f of detector.scan(text)) {
    const a = act(f.rule);
    if (a === "block") hits.blocked.add(label(f));
    else if (a === "redact") spans.push(f);
  }
  if (!spans.length) return text;
  spans.sort((a, b) => a.start - b.start);
  let out = "", at = 0;
  for (const f of spans) {
    if (f.start < at) continue;
    out += text.slice(at, f.start) + detector.placeholder(f);
    at = f.end;
    hits.redacted[label(f)] = (hits.redacted[label(f)] || 0) + 1;
  }
  return out + text.slice(at);
}

// Scope: user messages and tool results. System prompts and assistant history stay unchanged.
function walkScope(node, scope, edit, depth = 0) {
  if (depth > 100 || !node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => { if (typeof v === "string") { if (scope) node[i] = edit(v); } else walkScope(v, scope, edit, depth + 1); });
    return;
  }
  if (IN_SCOPE.has(node.role) || node.type === "tool_result" || node.type === "function_call_output") scope = true;
  else if (OUT_SCOPE.has(node.role)) scope = false;
  for (const k of WALK_KEYS) {
    if (typeof node[k] === "string") { if (scope && k !== "messages" && k !== "contents") node[k] = edit(node[k]); }
    else walkScope(node[k], scope, edit, depth + 1);
  }
}

// Scans the body. Redacts in place when a rule says so. Returns { blocked: [names] } to stop the request.
// Fails open: a scanner error never blocks or changes the request.
export async function observeRequest(body, meta = {}, config = {}) {
  if (!process.env.PII_GUARD_MODULE || config.mode === "off") return;
  try {
    if (!await ready()) return;
    const act = actionFor(config);
    const start = performance.now();
    const result = library.scanBody(body, detector);
    const findings = result.findings.filter(f => act(f.rule) !== "off");
    // Block looks at every scanned field, not only the redact scope.
    const hits = { blocked: new Set(findings.filter(f => act(f.rule) === "block").map(label)), redacted: Object.create(null) };
    if (!hits.blocked.size && findings.some(f => act(f.rule) === "redact")) {
      if (typeof body.input === "string") body.input = editText(body.input, act, hits);
      walkScope(body, false, text => editText(text, act, hits));
    }
    const scanMs = performance.now() - start;
    requests++;
    // ponytail: Keep the latest 10,000 timings; use a histogram if exact long-window percentiles are needed.
    if (samples.length === 10_000) samples.shift();
    samples.push(scanMs);
    maxScanMs = Math.max(maxScanMs, scanMs);
    if (!findings.length) return;
    withFindings++;
    const counts = Object.create(null), fresh = [];
    for (const f of findings) {
      const source = safeSource(f.source);
      const key = `${f.hash}|${f.source}`;
      counts[label(f)] = (counts[label(f)] || 0) + 1;
      if (!seen.has(key)) fresh.push({ rule: f.rule, name: f.name, kind: f.kind, hash: f.hash, source });
      else seen.delete(key);
      seen.add(key);
      if (seen.size > 50_000) seen.delete(seen.values().next().value);
    }
    const blocked = [...hits.blocked];
    append({ ts: new Date().toISOString(), endpoint: meta.endpoint, model: meta.model, ua: (meta.userAgent || "").split(" ")[0], chars: result.chars, images: result.images, imageBytes: result.imageBytes, unscanned: result.unscanned, scanMs, counts, new: fresh, ...(blocked.length && { blocked }), ...(Object.keys(hits.redacted).length && { redacted: hits.redacted }) });
    // Names and counts only; never log matched values.
    const summary = Object.entries(counts).map(([k, n]) => `${k}=${n}`).join(", ");
    const line = `[pii-guard] ${meta.model || "-"} ${meta.endpoint || "-"}: ${summary}`;
    if (blocked.length) console.error(`${line} BLOCKED: ${blocked.join(", ")}`);
    else if (Object.keys(hits.redacted).length) console.warn(`${line} redacted: ${Object.entries(hits.redacted).map(([k, n]) => `${k}=${n}`).join(", ")}`);
    else if (fresh.length) console.warn(`${line} (new: ${[...new Set(fresh.map(label))].join(", ")})`);
    else console.info(line);
    if (blocked.length) return { blocked };
  } catch { warn(); }
}

// Dashboard test: scan one text. The caller is the authenticated dashboard user, so matches are returned.
export async function testText(text, config) {
  if (!await ready()) return null;
  const act = actionFor(config);
  const hits = { blocked: new Set(), redacted: Object.create(null) };
  const findings = detector.scan(text).map(f => ({ rule: f.rule, name: f.name, kind: f.kind, action: act(f.rule), match: text.slice(f.start, f.end) }));
  return { findings, redacted: editText(text, act, hits), blocked: [...hits.blocked] };
}

export function eventsFile() {
  return process.env.PII_GUARD_EVENTS || join(homedir(), ".9router/pii-guard/events.jsonl");
}
