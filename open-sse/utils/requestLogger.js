// Check if running in Node.js environment (has fs module)
const isNode = typeof process !== "undefined" && process.versions?.node && typeof window === "undefined";
//
// Upstream gated this file on a module-level `const LOGGING_ENABLED = process.env
// .ENABLE_REQUEST_LOGS === 'true'`, evaluated once at import. That made raw-frame capture
// env-only: the /dashboard/profile toggle and PATCH /api/settings could not switch it on,
// so the highest-value forensic artifact needed a redeploy to enable — during an incident.
//
// It is now resolved per call from the shared gate in src/lib/observability/config.js (the
// same one the SQLite `requestDetails` capture uses, so the two cannot drift):
//   enableObservability (master) AND observabilityFrameLogging (this capture)
// with the resolved value cached for 5s. Disk exposure is bounded by
// src/lib/observability/frameLogs.js: a rolling `observabilityRetentionHours` window, a
// rolling `observabilityMaxLogSizeMb` budget charged on every write, and a free-disk floor.
// When either budget is exhausted, writes are skipped and traffic is served as normal.

let fs = null;
let path = null;
let LOGS_DIR = null;
// src/lib/observability/frameLogs.js — Node-only, absent when open-sse runs standalone.
let frameLogs = null;

// Lazy load Node.js modules (avoid top-level await)
async function ensureNodeModules() {
  if (!isNode || fs) return;
  try {
    fs = await import("fs");
    path = await import("path");
  } catch {
    // Running in non-Node environment (Worker, Browser, etc.)
    return;
  }
  try {
    // frames live under $DATA_DIR/logs/frames (the persistent volume) rather
    // than process.cwd()/logs, which is ephemeral in the container — see frameLogs.js.
    frameLogs = await import("@/lib/observability/frameLogs.js");
    LOGS_DIR = frameLogs.getFrameLogDir();
  } catch {
    // open-sse used outside the app (no @/lib): keep the upstream cwd location, but still
    // in a dedicated sub-directory so nothing else shares it.
    LOGS_DIR = path.join(typeof process !== "undefined" && process.cwd ? process.cwd() : ".", "logs", "frames");
  }
}

// runtime resolve of the observability gate. Returns null when the
// settings layer is unavailable, which fails closed (no capture).
async function resolveObservability() {
  if (!isNode) return null;
  try {
    const { getObservabilityConfig } = await import("@/lib/observability/config.js");
    return await getObservabilityConfig();
  } catch {
    return null;
  }
}

// Format timestamp for folder name: 20251228_143045_123
function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${y}${m}${d}_${h}${min}${s}_${ms}`;
}

// Create log session folder: {sourceFormat}_{targetFormat}_{model}_{timestamp}
async function createLogSession(sourceFormat, targetFormat, model) {
  await ensureNodeModules();
  if (!fs || !LOGS_DIR) return null;
  
  try {
    // ensureFrameLogDir() also writes the marker file that the retention
    // janitor requires before it will delete anything inside this directory.
    if (frameLogs) {
      if (!frameLogs.ensureFrameLogDir(LOGS_DIR)) return null;
    } else if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }

    const timestamp = formatTimestamp();
    const safeModel = (model || "unknown").replace(/[/:]/g, "-");
    const folderName = `${sourceFormat}_${targetFormat}_${safeModel}_${timestamp}`;
    const sessionPath = path.join(LOGS_DIR, folderName);
    
    fs.mkdirSync(sessionPath, { recursive: true });
    
    return sessionPath;
  } catch (err) {
    console.log("[LOG] Failed to create log session:", err.message);
    return null;
  }
}

// every frame write is charged against the size budget in
// frameLogs.js, which returns false once the budget (or the free-disk floor) is exhausted.
// Skipping the write is deliberate — degraded observability beats filling the volume that
// data.sqlite lives on. Suppression is logged once by frameLogs.js, never per request.
function byteLen(chunk) {
  if (chunk == null) return 0;
  if (typeof chunk === "string") return Buffer.byteLength(chunk);
  if (typeof chunk.byteLength === "number") return chunk.byteLength;
  return Buffer.byteLength(String(chunk));
}

function frameWriteAllowed(bytes) {
  if (!frameLogs) return true; // open-sse standalone: no budget tracking available
  try {
    return frameLogs.reserveFrameBytes(bytes, { dir: LOGS_DIR });
  } catch {
    return true; // accounting must never break a request
  }
}

// Write JSON file
function writeJsonFile(sessionPath, filename, data) {
  if (!fs || !sessionPath) return;

  try {
    const payload = JSON.stringify(data, null, 2);
    if (!frameWriteAllowed(byteLen(payload))) return;
    const filePath = path.join(sessionPath, filename);
    fs.writeFileSync(filePath, payload);
  } catch (err) {
    console.log(`[LOG] Failed to write ${filename}:`, err.message);
  }
}

// Credential masking for everything the request logger writes to disk. Provider requests
// carry live credentials (Authorization, x-api-key, x-goog-api-key, cookies), and some
// providers take the key in the URL (e.g. Gemini `?key=`). Without masking, every request
// dump holds a usable credential. Values are replaced keeping only the last 4 characters, so
// an operator can still tell WHICH credential was used without it being recoverable.
const SENSITIVE_HEADER_RE = /authorization|api[-_]?key|cookie|(?:^|[-_])(?:token|secret|password|session)(?:$|[-_])/i;
const SENSITIVE_QUERY_KEYS = "key|api[-_]?key|apikey|access[-_]?token|token|auth|secret|password|signature|sig";
const SENSITIVE_QUERY_RE = new RegExp(`^(?:${SENSITIVE_QUERY_KEYS})$`, "i");

function maskValue(value) {
  const s = String(value ?? "");
  return s.length > 8 ? `***${s.slice(-4)}` : "***";
}

export function maskSensitiveHeaders(headers) {
  if (!headers) return {};
  const entries = typeof headers.entries === "function" ? [...headers.entries()] : Object.entries(headers);
  const masked = {};
  for (const [key, value] of entries) {
    masked[key] = SENSITIVE_HEADER_RE.test(key) ? maskValue(value) : value;
  }
  return masked;
}

export function maskUrlSecrets(url) {
  if (!url || typeof url !== "string") return url;
  try {
    const u = new URL(url);
    let changed = false;
    for (const k of [...u.searchParams.keys()]) {
      if (SENSITIVE_QUERY_RE.test(k)) {
        u.searchParams.set(k, maskValue(u.searchParams.get(k)));
        changed = true;
      }
    }
    return changed ? u.toString() : url;
  } catch {
    // Not an absolute URL: conservative query-string rewrite.
    return url.replace(new RegExp(`([?&](?:${SENSITIVE_QUERY_KEYS})=)[^&#]*`, "gi"), "$1***");
  }
}

// No-op logger when logging is disabled
function createNoOpLogger() {
  return {
    sessionPath: null,
    logClientRawRequest() {},
    logRawRequest() {},
    logOpenAIRequest() {},
    logTargetRequest() {},
    logProviderResponse() {},
    appendProviderChunk() {},
    appendOpenAIChunk() {},
    logConvertedResponse() {},
    appendConvertedChunk() {},
    logError() {}
  };
}

/**
 * Create a new log session and return logger functions
 * @param {string} sourceFormat - Source format from client (claude, openai, etc.)
 * @param {string} targetFormat - Target format to provider (antigravity, gemini-cli, etc.)
 * @param {string} model - Model name
 * @returns {Promise<object>} Promise that resolves to logger object with methods to log each stage
 */
export async function createRequestLogger(sourceFormat, targetFormat, model) {
  // resolve the gate at call time (5s-cached) instead of at import.
  const observability = await resolveObservability();

  // Retention. Kicked off request traffic but never awaited and never blocking: the call is
  // synchronous, throttled to one sweep per 5 minutes, and it also arms an unref'd backstop
  // interval — so frames still expire after frame logging is switched back off.
  if (observability) {
    await ensureNodeModules();
    if (frameLogs) {
      try {
        frameLogs.configureFrameLogBudget({ maxLogSizeBytes: observability.maxLogSizeBytes });
        frameLogs.scheduleFrameLogPrune({ retentionHours: observability.retentionHours });
      } catch {
        // Retention must never break a request.
      }
    }
  }

  // Return no-op logger if logging is disabled
  if (!observability?.frameLogging) {
    return createNoOpLogger();
  }

  // free-disk floor, checked once per session (throttled statfs).
  // Below the floor we stop capturing rather than risk the volume data.sqlite lives on.
  if (frameLogs) {
    try {
      if (!frameLogs.frameDiskHasRoom(LOGS_DIR)) return createNoOpLogger();
    } catch {
      // Guard must never break a request; fall through and let the budget catch it.
    }
  }

  // Wait for session to be created before returning logger
  const sessionPath = await createLogSession(sourceFormat, targetFormat, model);
  
  return {
    get sessionPath() { return sessionPath; },
    
    // 1. Log client raw request (before any conversion)
    logClientRawRequest(endpoint, body, headers = {}) {
      writeJsonFile(sessionPath, "1_req_client.json", {
        timestamp: new Date().toISOString(),
        endpoint,
        headers: maskSensitiveHeaders(headers),
        body
      });
    },
    
    // 2. Log raw request from client (after initial conversion like responsesApi)
    logRawRequest(body, headers = {}) {
      writeJsonFile(sessionPath, "2_req_source.json", {
        timestamp: new Date().toISOString(),
        headers: maskSensitiveHeaders(headers),
        body
      });
    },
    
    // 3. Log OpenAI intermediate format (source → openai)
    logOpenAIRequest(body) {
      writeJsonFile(sessionPath, "3_req_openai.json", {
        timestamp: new Date().toISOString(),
        body
      });
    },
    
    // 4. Log target format request (openai → target)
    logTargetRequest(url, headers, body) {
      writeJsonFile(sessionPath, "4_req_target.json", {
        timestamp: new Date().toISOString(),
        url: maskUrlSecrets(url),
        headers: maskSensitiveHeaders(headers),
        body
      });
    },
    
    // 5. Log provider response (for non-streaming or error)
    logProviderResponse(status, statusText, headers, body) {
      const filename = "5_res_provider.json";
      writeJsonFile(sessionPath, filename, {
        timestamp: new Date().toISOString(),
        status,
        statusText,
        headers: maskSensitiveHeaders(headers),
        body
      });
    },
    
    // 5. Append streaming chunk to provider response
    appendProviderChunk(chunk) {
      if (!fs || !sessionPath) return;
      if (!frameWriteAllowed(byteLen(chunk))) return; // size budget / disk floor
      try {
        const filePath = path.join(sessionPath, "5_res_provider.txt");
        fs.appendFileSync(filePath, chunk);
      } catch (err) {
        // Ignore append errors
      }
    },
    
    // 6. Append OpenAI intermediate chunks (target → openai)
    appendOpenAIChunk(chunk) {
      if (!fs || !sessionPath) return;
      if (!frameWriteAllowed(byteLen(chunk))) return; // size budget / disk floor
      try {
        const filePath = path.join(sessionPath, "6_res_openai.txt");
        fs.appendFileSync(filePath, chunk);
      } catch (err) {
        // Ignore append errors
      }
    },
    
    // 7. Log converted response to client (for non-streaming)
    logConvertedResponse(body) {
      writeJsonFile(sessionPath, "7_res_client.json", {
        timestamp: new Date().toISOString(),
        body
      });
    },
    
    // 7. Append streaming chunk to converted response
    appendConvertedChunk(chunk) {
      if (!fs || !sessionPath) return;
      if (!frameWriteAllowed(byteLen(chunk))) return; // size budget / disk floor
      try {
        const filePath = path.join(sessionPath, "7_res_client.txt");
        fs.appendFileSync(filePath, chunk);
      } catch (err) {
        // Ignore append errors
      }
    },
    
    // 6. Log error
    logError(error, requestBody = null) {
      writeJsonFile(sessionPath, "6_error.json", {
        timestamp: new Date().toISOString(),
        error: error?.message || String(error),
        stack: error?.stack,
        requestBody
      });
    }
  };
}

// Legacy functions for backward compatibility
export function logRequest() {}
export function logResponse() {}
export function logError(provider, { error, url, model, requestBody }) {
  if (!fs || !LOGS_DIR) return;
  
  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
    
    const date = new Date().toISOString().split("T")[0];
    const logPath = path.join(LOGS_DIR, `${provider}-${date}.log`);
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: "error",
      provider,
      model,
      url: maskUrlSecrets(url),
      error: error?.message || String(error),
      stack: error?.stack,
      requestBody
    };
    
    fs.appendFileSync(logPath, JSON.stringify(logEntry) + "\n");
  } catch (err) {
    console.log("[LOG] Failed to write error log:", err.message);
  }
}
