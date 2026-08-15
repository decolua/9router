import fs from "fs";
import path from "path";

// OpenCode Zen free-tier egress switch (MANUAL only — no automatic rotation).
//
// The Zen gateway rate-limits anonymous ("-free") models PER EGRESS IP
// (ipRateLimiter.ts: rawIp = headers x-real-ip as stamped by cloudflare from
// the real TCP peer; client-supplied values are stripped). Every IP has a
// daily request budget (reset at UTC midnight). When the current egress IP
// budget is exhausted the gateway answers 429 FreeUsageLimitError and it
// stays exhausted until midnight — so the only way to "get more quota" is
// to send the next requests from a DIFFERENT real egress IP. The user picks
// the egress manually (Clash node in the UI, or oc-egress.mjs switch/flip);
// the executor never switches on its own.
//
// This module gives the OpenCodeExecutor two real egresses:
//   proxy  — outbound proxy (settings outboundProxyUrl, e.g. Clash): requests
//            leave from the proxy node IP. Default.
//   direct — bypass proxy for opencode.ai (NO_PROXY): requests leave from the
//            machine's own public IP.
// Mode is persisted in <APPDATA>/9router/oc-egress.json so it survives
// restarts and can be toggled manually at any time.
const EGRESS_FILE = "oc-egress.json";
const HOST = "opencode.ai";
const FLIP_COOLDOWN_MS = 60_000;

function egressFile() {
  const base = process.env.APPDATA || process.env.HOME || process.cwd();
  return path.join(base, "9router", EGRESS_FILE);
}

export function readOcEgress() {
  const defaults = { mode: "proxy", lastFlipAt: 0, flips: 0 };
  try {
    const j = JSON.parse(fs.readFileSync(egressFile(), "utf8"));
    return {
      mode: j.mode === "direct" ? "direct" : "proxy",
      lastFlipAt: j.lastFlipAt || 0,
      flips: j.flips || 0,
    };
  } catch {
    return defaults;
  }
}

// Make proxyAwareFetch honor the current mode. proxyAwareFetch reads
// process.env.NO_PROXY per request, so updating it takes effect immediately
// for subsequent requests without touching the settings/DB.
export function applyOcEgress() {
  const { mode } = readOcEgress();
  const current = (process.env.NO_PROXY || process.env.no_proxy || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const hasHost = current.includes(HOST);
  if (mode === "direct" && !hasHost) {
    process.env.NO_PROXY = [...current, HOST].join(",");
  } else if (mode !== "direct" && hasHost) {
    process.env.NO_PROXY = current.filter((h) => h !== HOST).join(",");
  }
}

// Toggle mode (utility for tooling/CLI). Cooldown prevents rapid flapping
// between the two egresses. Returns false when flipped too recently or
// persistence failed.
export function flipOcEgress() {
  const st = readOcEgress();
  if (Date.now() - st.lastFlipAt < FLIP_COOLDOWN_MS) return false;
  const next = {
    ...st,
    mode: st.mode === "direct" ? "proxy" : "direct",
    lastFlipAt: Date.now(),
    flips: st.flips + 1,
  };
  try {
    fs.mkdirSync(path.dirname(egressFile()), { recursive: true });
    fs.writeFileSync(egressFile(), JSON.stringify(next, null, 2));
  } catch (e) {
    console.warn(`[ocEgress] failed to persist mode: ${e.message}`);
    return false;
  }
  applyOcEgress();
  return true;
}
