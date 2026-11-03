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
  const file = process.env.PII_GUARD_EVENTS || join(homedir(), ".9router/pii-guard/events.jsonl");
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

export async function observeRequest(body, meta = {}) {
  if (!process.env.PII_GUARD_MODULE) return;
  try {
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
    if (!await loading) return;
    reload();
    if (!detector) return;
    const start = performance.now();
    const result = library.scanBody(body, detector);
    const scanMs = performance.now() - start;
    requests++;
    // ponytail: Keep the latest 10,000 timings; use a histogram if exact long-window percentiles are needed.
    if (samples.length === 10_000) samples.shift();
    samples.push(scanMs);
    maxScanMs = Math.max(maxScanMs, scanMs);
    if (!result.findings.length) return;
    withFindings++;
    const counts = Object.create(null), fresh = [];
    for (const f of result.findings) {
      const source = safeSource(f.source);
      const key = `${f.hash}|${f.source}`;
      counts[f.name || f.rule] = (counts[f.name || f.rule] || 0) + 1;
      if (!seen.has(key)) fresh.push({ rule: f.rule, name: f.name, kind: f.kind, hash: f.hash, source });
      else seen.delete(key);
      seen.add(key);
      if (seen.size > 50_000) seen.delete(seen.values().next().value);
    }
    append({ ts: new Date().toISOString(), endpoint: meta.endpoint, model: meta.model, ua: (meta.userAgent || "").split(" ")[0], chars: result.chars, images: result.images, imageBytes: result.imageBytes, unscanned: result.unscanned, scanMs, counts, new: fresh });
  } catch { warn(); }
}
