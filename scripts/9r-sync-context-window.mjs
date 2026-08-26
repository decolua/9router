#!/usr/bin/env node
/**
 * Keep Claude Code's context window in step with the combo that is actually
 * serving it. Installed as a Stop hook, so it runs after every assistant turn.
 *
 * THE PROBLEM IT EXISTS FOR. Claude Code reads its window once, from a static
 * setting, and compacts at 80% of it. A 9router combo is not one model: its head
 * changes as quota moves, and its members range from 128K to 1M. Any fixed
 * number is therefore wrong in both directions, and both were observed on this
 * box in one evening — 838860 meant "the window is 838K", so it compacted at
 * 671K of a 1M model; 200000 (set to silence a warning) compacted at 160K, which
 * the HUD rendered as 15% and the operator read, correctly, as broken.
 *
 * WHAT IT WRITES. `autoCompactWindow` in settings.json — a real setting, capped
 * by its schema at 1,000,000 — plus the matching env var for older builds. The
 * value is `clientWindow` from /api/context-window, which is the router's own
 * compaction ceiling divided by its 80%, so the client's trigger lands exactly
 * where the router would otherwise have forced a 413. That division is what
 * encodes the operator's rule:
 *
 *     "if it will hit rotate and the next model cant handle the context, it
 *      should compact. if it can handle the context, then compact at 80%."
 *
 * Ordinary case: the fallback is roomy, clientWindow is the head's own window,
 * and the client compacts at 80% of it. Narrow-fallback case: clientWindow drops
 * so the client compacts as soon as the conversation outgrows the member we
 * would rotate into.
 *
 * WHY IT ONLY WRITES ON A CHANGE. Claude Code watches settings.json. Rewriting
 * an unchanged value every turn would churn the watcher for nothing.
 *
 * FAIL-OPEN, ALWAYS. A hook that breaks the turn is worse than a stale window.
 * Every failure path exits 0 and leaves settings untouched.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SETTINGS = process.env.NINEROUTER_HOOK_SETTINGS || path.join(os.homedir(), ".claude", "settings.json");
const BASE = process.env.ANTHROPIC_BASE_URL || "http://127.0.0.1:20128";
const TIMEOUT_MS = 4000;

// The schema caps autoCompactWindow at 1,000,000, so a genuine 1,048,576-token
// model has to be clamped. Losing 48K of headroom is invisible; writing an
// out-of-range value would make Claude Code reject the whole settings file and
// silently drop every other setting in it.
const MAX_SETTING = 1_000_000;
const MIN_SETTING = 100_000;

function log(msg) {
  process.stderr.write(`[9r-context-window] ${msg}\n`);
}

/** The combo this session routes to. Every tier is the same combo in practice,
 *  but read them in the order Claude Code resolves so an override is honoured. */
function comboName() {
  return (
    process.env.NINEROUTER_HOOK_COMBO ||
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL ||
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ||
    process.env.ANTHROPIC_MODEL ||
    ""
  )
    // Claude Code appends [1m] to model ids; the router does not know that name.
    .replace(/\[1m\]$/, "")
    .trim();
}

async function main() {
  const combo = comboName();
  if (!combo) return log("no combo in env, nothing to sync");

  let data;
  try {
    const res = await fetch(`${BASE}/api/context-window?combo=${encodeURIComponent(combo)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return log(`router said ${res.status} for ${combo}`);
    data = await res.json();
  } catch (e) {
    return log(`router unreachable at ${BASE}: ${e.message}`);
  }

  const want = Number(data.clientWindow);
  if (!Number.isFinite(want) || want <= 0) return log(`no usable window for ${combo}`);
  const clamped = Math.max(MIN_SETTING, Math.min(MAX_SETTING, want));

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
  } catch (e) {
    return log(`cannot read ${SETTINGS}: ${e.message}`);
  }

  const current = Number(settings.autoCompactWindow);
  if (current === clamped) return; // no churn on the watcher

  settings.autoCompactWindow = clamped;
  settings.env = settings.env || {};
  settings.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(clamped);

  // Write through a temp file in the same directory: a half-written
  // settings.json is not a degraded config, it is no config at all, and the
  // watcher would read it mid-write.
  const tmp = `${SETTINGS}.9r-tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
    fs.renameSync(tmp, SETTINGS);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean up */ }
    return log(`cannot write ${SETTINGS}: ${e.message}`);
  }

  log(
    `${combo}: head=${data.head} next=${data.next || "none"} -> window ${current ?? "unset"} to ${clamped} ` +
    `(compacts at ~${Math.floor(clamped * (data.headroomRatio || 0.8))})`
  );
}

main().catch((e) => log(`unexpected: ${e.message}`));
