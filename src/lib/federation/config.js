// Federation configuration (FED-001). Pure module — no side effects on import.
//
// All env vars are OPTIONAL (spec §4). FEDERATION_MODE defaults to
// "standalone" and every knob has a documented default, so standalone
// deployments see zero behavior change.
import { createRequire } from "node:module";
import { ENV_DEFAULTS } from "./constants.js";

const require = createRequire(import.meta.url);

export const MODES = Object.freeze(["standalone", "central", "edge"]);

let _edgeId = null;

function readMode() {
  const raw = process.env.FEDERATION_MODE;
  if (raw === undefined || raw === null || raw === "") return ENV_DEFAULTS.MODE;
  const mode = String(raw).trim().toLowerCase();
  if (!MODES.includes(mode)) {
    throw new Error(
      `[federation] invalid FEDERATION_MODE '${raw}' (expected one of: ${MODES.join(", ")}). ` +
        `Fix the env var — refusing to silently fall back to 'standalone'.`
    );
  }
  return mode;
}

// Parsed once at import; env is read at process start in every real deployment.
const _mode = readMode();

export function getMode() {
  return _mode;
}

export function isStandalone() {
  return _mode === "standalone";
}

export function isEdge() {
  return _mode === "edge";
}

export function isCentral() {
  return _mode === "central";
}

// ─── Spec §4 env knobs (all optional, all with defaults) ────────────────

export function getCentralUrl() {
  return process.env.FEDERATION_CENTRAL_URL || null;
}

export function getToken() {
  return process.env.FEDERATION_TOKEN || null;
}

export function getEdgeId() {
  // Default: node-machine-id (spec §4). Lazy + cached so tests can set env
  // between calls; node-machine-id is only loaded when actually needed.
  if (process.env.FEDERATION_EDGE_ID) return process.env.FEDERATION_EDGE_ID;
  if (!_edgeId) {
    try {
      const { machineIdSync } = require("node-machine-id");
      _edgeId = machineIdSync();
    } catch {
      _edgeId = "unknown-edge";
    }
  }
  return _edgeId;
}

export function getSyncIntervalMs() {
  return intEnv("FEDERATION_SYNC_INTERVAL_MS", ENV_DEFAULTS.SYNC_INTERVAL_MS);
}

export function getHeartbeatIntervalMs() {
  return intEnv("FEDERATION_HEARTBEAT_INTERVAL_MS", ENV_DEFAULTS.HEARTBEAT_INTERVAL_MS);
}

export function getOutageThresholdMs() {
  return intEnv("FEDERATION_OUTAGE_THRESHOLD_MS", ENV_DEFAULTS.OUTAGE_THRESHOLD_MS);
}

export function getQueueMax() {
  return intEnv("FEDERATION_QUEUE_MAX", ENV_DEFAULTS.QUEUE_MAX);
}

export function getReplayBatchSize() {
  return intEnv("FEDERATION_REPLAY_BATCH_SIZE", ENV_DEFAULTS.REPLAY_BATCH_SIZE);
}

export function getRedactFields() {
  const raw = process.env.FEDERATION_REDACT_FIELDS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`[federation] invalid ${name}='${raw}' (expected a non-negative integer)`);
  }
  return Math.floor(n);
}
