// Pure-Node Sentinel client for chatgpt.com.
//
// The web app solves three layers before a /backend-api call is accepted:
//   1. `chat-requirements/prepare` wants an `OpenAI-Sentinel-Chat-Requirements-
//      Prepare-Token` — `gAAAAAC` + base64 of a 24-slot browser fingerprint.
//   2. `chat-requirements` may demand proof-of-work: brute-force a counter until
//      the FNV-1a hash of `seed + base64(fingerprint)` sorts below `difficulty`.
//   3. It may also demand a Turnstile VM challenge. That layer is NOT solved
//      here — callers fall back to the browser path when it is enforced.
//
// Both token formats are recovered from the web bundle (module "lXE"), not
// guessed, so a format change surfaces as a prepare/requirements error rather
// than a silent mis-hash.

const PREPARE_PREFIX = "gAAAAAC";
const PROOF_PREFIX = "gAAAAAB";
const PROOF_SUFFIX = "~S";
const MAX_POW_ITERATIONS = 500000;

export const SENTINEL_HEADERS = {
  prepare: "OpenAI-Sentinel-Chat-Requirements-Prepare-Token",
  requirements: "OpenAI-Sentinel-Chat-Requirements-Token",
  proof: "OpenAI-Sentinel-Proof-Token",
  turnstile: "OpenAI-Sentinel-Turnstile-Token",
};

/** Sentinel's 32-bit hash: FNV-1a with three avalanche rounds, 8 hex chars. */
export function sentinelHash(input) {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x1000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0).toString(16).padStart(8, "0");
}

const encodeFingerprint = (slots) => Buffer.from(JSON.stringify(slots), "utf8").toString("base64");

// The bundle samples these from the live document; the server only checks the
// shape, so a fixed plausible set is enough and keeps this deterministic.
const SCRIPT_CANDIDATES = [
  "https://chatgpt.com/cdn/assets/685809.dec86dcdc1.js",
  "https://chatgpt.com/cdn/assets/399565.a1117ca8b4.js",
];
const DOCUMENT_KEYS = ["cookie", "domain", "readyState", "title", "URL", "charset", "location"];
const WINDOW_KEYS = ["caches", "crypto", "fetch", "indexedDB", "localStorage", "origin"];
const NAV_PROTOTYPE = ["userAgent", "language", "hardwareConcurrency"];

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** Build the 24-slot fingerprint array the bundle hashes. */
function buildFingerprint(userAgent) {
  const navKey = pick(NAV_PROTOTYPE);
  return [
    1280 + 800, // screen width + height
    new Date().toString(),
    null, // performance.memory.jsHeapSizeLimit — null in non-Chromium
    0, // overwritten by the PoW counter
    userAgent,
    pick(SCRIPT_CANDIDATES),
    null, // document build id
    "en-US",
    "en-US,en",
    0, // overwritten by elapsed ms
    `${navKey}−${userAgent}`, // U+2212 MINUS SIGN, as in the bundle
    pick(DOCUMENT_KEYS),
    pick(WINDOW_KEYS),
    0, // performance.now()
    crypto.randomUUID(),
    "", // search-param keys
    8, // hardwareConcurrency
    0, // performance.timeOrigin
    0, 0, 0, 0, 0, 0, 0, // feature probes ("ai" in window, …)
  ];
}

/** `gAAAAAC…` — the prepare-token header value. */
export function buildPrepareToken(userAgent) {
  const slots = buildFingerprint(userAgent);
  slots[3] = 1;
  slots[9] = 0;
  return `${PREPARE_PREFIX}${encodeFingerprint(slots)}`;
}

/**
 * Solve a proof-of-work challenge.
 * @returns {string} `gAAAAAB<base64>~S`
 */
export function solveProofOfWork({ seed, difficulty, userAgent }) {
  if (!seed || !difficulty) throw new Error("ChatGPT sentinel asked for proof of work without seed/difficulty");
  const started = performance.now();
  const slots = buildFingerprint(userAgent);
  for (let counter = 0; counter < MAX_POW_ITERATIONS; counter++) {
    slots[3] = counter;
    slots[9] = Math.round(performance.now() - started);
    const encoded = encodeFingerprint(slots);
    if (sentinelHash(`${seed}${encoded}`).slice(0, difficulty.length) <= difficulty) {
      return `${PROOF_PREFIX}${encoded}${PROOF_SUFFIX}`;
    }
  }
  throw new Error("ChatGPT sentinel proof of work exhausted its iteration budget");
}

/** Thrown when the server demands the Turnstile VM challenge (browser-only). */
export class TurnstileRequiredError extends Error {
  constructor() {
    super("ChatGPT requires the Turnstile challenge — falling back to the browser path");
    this.name = "TurnstileRequiredError";
    this.code = "TURNSTILE_REQUIRED";
  }
}

async function postJson(url, { headers, body, signal }) {
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw Object.assign(new Error(`ChatGPT ${new URL(url).pathname} failed (HTTP ${res.status}) ${text.slice(0, 200)}`), {
      status: res.status,
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error(`ChatGPT ${new URL(url).pathname} returned invalid JSON`), { status: 502 });
  }
}

/**
 * Run prepare → requirements and return the sentinel headers for a
 * `/backend-api` call.
 *
 * @returns {Promise<Record<string,string>>}
 */
export async function fetchSentinelHeaders({ baseUrl, accessToken, userAgent, signal }) {
  const base = { Authorization: `Bearer ${accessToken}`, "User-Agent": userAgent };
  const prepared = await postJson(`${baseUrl}/backend-api/sentinel/chat-requirements/prepare`, {
    headers: { ...base, [SENTINEL_HEADERS.prepare]: buildPrepareToken(userAgent) },
    signal,
  });
  if (!prepared?.prepare_token) {
    throw Object.assign(new Error("ChatGPT sentinel prepare returned no prepare_token"), { status: 502 });
  }

  const requirements = await postJson(`${baseUrl}/backend-api/sentinel/chat-requirements`, {
    headers: { ...base, [SENTINEL_HEADERS.prepare]: prepared.prepare_token },
    signal,
  });
  // Turnstile runs a VM challenge. The image flow tolerates its absence today,
  // so this is informational rather than fatal.
  const tokens = {};
  if (requirements?.token) tokens[SENTINEL_HEADERS.requirements] = requirements.token;
  if (requirements?.proofofwork?.required) {
    tokens[SENTINEL_HEADERS.proof] = solveProofOfWork({
      seed: requirements.proofofwork.seed,
      difficulty: requirements.proofofwork.difficulty,
      userAgent,
    });
  }
  return tokens;
}
