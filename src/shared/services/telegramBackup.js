// Automatic-backup scheduler: exports the full DB (same payload as the manual
// Download Backup) and delivers it to the configured channel: a Telegram bot
// chat or a GitHub repository commit. Schedule state (lastSentAt) persists in
// the autoBackup KV scope, so restarts never re-send a backup that already
// went out.
import "open-sse/index.js";

import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { exportDb } from "@/lib/db/index.js";
import { getAutoBackupConfig, getAutoBackupStatus, setAutoBackupStatus } from "@/lib/db/repos/autoBackupRepo.js";
import { getAppVersion } from "@/lib/db/version.js";
import { AUTO_BACKUP_CONFIG } from "@/shared/constants/config";

const C = AUTO_BACKUP_CONFIG;

// Survive Next.js hot reload and keep one scheduler per server process.
const g = (global.__telegramBackup ??= {
  timer: null,
  running: false,
  nextRunAt: null,
});

const HOUR_MS = 3600000;
const GITHUB_API = "https://api.github.com";
const BACKUP_FOLDER = "9router-backups";

function formatStamp(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function formatMb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function intervalMsOf(config) {
  return Math.max(C.minIntervalHours, Number(config.intervalHours) || C.minIntervalHours) * HOUR_MS;
}

function schedule(delayMs) {
  const delay = Math.max(0, delayMs);
  g.nextRunAt = Date.now() + delay;
  if (g.timer) clearTimeout(g.timer);
  g.timer = setTimeout(() => {
    g.timer = null;
    g.nextRunAt = null;
    runTelegramBackupTick().catch(() => {});
  }, delay);
  if (g.timer.unref) g.timer.unref();
}

async function recordStatus(patch) {
  try {
    await setAutoBackupStatus({ ...(await getAutoBackupStatus()), ...patch });
  } catch (e) {
    console.warn("[AutoBackup] failed to store status:", e.message);
  }
}

async function buildBackupBuffer() {
  const payload = await exportDb();
  const buf = Buffer.from(JSON.stringify(payload, null, 2));
  if (buf.length > C.maxBytes) {
    throw new Error(`Backup too large (${formatMb(buf.length)} MB > ${formatMb(C.maxBytes)} MB). use Download Backup instead`);
  }
  return buf;
}

// --- channels ---------------------------------------------------------------

async function sendViaTelegram({ tgBotToken, tgChatId }, buf, stamp) {
  const form = new FormData();
  form.append("chat_id", tgChatId);
  form.append("document", new Blob([buf], { type: "application/json" }), `9router-backup-${stamp}.json`);
  form.append("caption", `9Router auto backup v${getAppVersion()}. ${formatMb(buf.length)} MB`);

  // Respects the outbound-proxy env applied by applyOutboundProxyEnv().
  const res = await proxyAwareFetch(`https://api.telegram.org/bot${tgBotToken}/sendDocument`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120000),
  }, null);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.description || `Telegram API ${res.status}`);
  }
}

async function ghApi(token, path, init = {}) {
  const res = await proxyAwareFetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(60000),
  }, null);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message?.errors?.[0]?.message || data?.message || `GitHub API ${res.status} on ${path}`);
  }
  return data;
}

// Commits the backup to owner/repo under 9router-backups/, also updating
// latest.json so restores always know the newest file. Auto-creates the repo's
// default branch ref when the repository is still empty.
async function sendViaGitHub({ ghToken, ghRepo }, buf, stamp) {
  const repo = (ghRepo || "").trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("GitHub repo must be in owner/repo format");

  const info = await ghApi(ghToken, `/repos/${repo}`);
  const branch = info?.default_branch || "main";
  let baseSha = null;
  try {
    baseSha = (await ghApi(ghToken, `/repos/${repo}/git/ref/heads/${branch}`)).object?.sha || null;
  } catch {
    baseSha = null; // empty repository. the first commit creates the branch
  }

  const blob = await ghApi(ghToken, `/repos/${repo}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content: buf.toString("base64") }),
  });
  const tree = [
    { path: `${BACKUP_FOLDER}/9router-backup-${stamp}.json`, mode: "100644", type: "blob", sha: blob.sha },
    { path: `${BACKUP_FOLDER}/latest.json`, mode: "100644", type: "blob", sha: blob.sha },
  ];
  const newTree = await ghApi(ghToken, `/repos/${repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseSha || undefined, tree }),
  });
  const commitMsg = `chore(backup): 9router auto backup ${stamp} (${formatMb(buf.length)} MB)`;
  const commit = await ghApi(ghToken, `/repos/${repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message: commitMsg, tree: newTree.sha, parents: baseSha ? [baseSha] : [] }),
  });
  if (baseSha) {
    await ghApi(ghToken, `/repos/${repo}/git/refs/heads/${branch}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
  } else {
    await ghApi(ghToken, `/repos/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
    });
  }
}

// --- scheduler --------------------------------------------------------------

function configuredChannels(config) {
  if (config.channel === "github") return config.ghToken && config.ghRepo ? ["github"] : [];
  return config.tgBotToken && config.tgChatId ? ["telegram"] : [];
}

function hasSender(config) {
  return configuredChannels(config).length > 0;
}

// Builds the backup and delivers it to the configured channel, recording
// status either way. Shared by the scheduler tick and "Send Test Backup".
export async function sendTelegramBackupNow() {
  if (g.running) throw new Error("A backup is already being sent");
  const config = await getAutoBackupConfig();
  if (!hasSender(config)) {
    throw new Error(config.channel === "github"
      ? "GitHub backup not configured (token / owner/repo)"
      : "Telegram backup not configured (bot token / chat id)");
  }
  g.running = true;
  try {
    const stamp = formatStamp(new Date());
    const buf = await buildBackupBuffer();
    const sizeBytes = buf.length;
    try {
      if (config.channel === "github") await sendViaGitHub(config, buf, stamp);
      else await sendViaTelegram(config, buf, stamp);
    } finally {
      buf.fill(0); // release the copy of the secret-bearing payload ASAP
    }
    await recordStatus({ lastSentAt: new Date().toISOString(), lastStatus: "ok", lastError: null, lastChannel: config.channel, lastSizeBytes: sizeBytes });
    if (config.enabled) schedule(intervalMsOf(config));
    console.log(`[AutoBackup] sent via ${config.channel} (${formatMb(sizeBytes)} MB)`);
    return { ok: true, sizeBytes, channel: config.channel };
  } catch (e) {
    await recordStatus({ lastStatus: "error", lastError: e.message, lastChannel: config.channel });
    throw e;
  } finally {
    g.running = false;
  }
}

// Runs one scheduler tick. It only reads the schedule here and hands the send
// to sendTelegramBackupNow, which owns the in-flight lock: holding that lock
// across the call would make every scheduled send reject itself.
export async function runTelegramBackupTick() {
  if (g.running) {
    schedule(60000); // a manual send is in flight. re-check in a minute
    return;
  }
  const config = await getAutoBackupConfig();
  if (!config.enabled || !hasSender(config)) {
    stopTelegramBackup();
    return;
  }
  const status = await getAutoBackupStatus();
  const intervalMs = intervalMsOf(config);
  const lastSentMs = status?.lastSentAt ? new Date(status.lastSentAt).getTime() : 0;
  const remaining = lastSentMs ? lastSentMs + intervalMs - Date.now() : 0;
  if (remaining > 0) {
    schedule(remaining);
    return;
  }
  try {
    await sendTelegramBackupNow();
  } catch (e) {
    console.warn("[AutoBackup] send failed:", e.message);
    schedule(C.retryDelayMs);
  }
}

// Schedule the next tick from the persisted lastSentAt. A fresh setup (never
// sent) fires immediately; otherwise only the remainder of the interval waits.
function scheduleFirstRun() {
  Promise.all([getAutoBackupStatus(), getAutoBackupConfig()])
    .then(([status, config]) => {
      const lastSentMs = status?.lastSentAt ? new Date(status.lastSentAt).getTime() : 0;
      schedule(lastSentMs ? lastSentMs + intervalMsOf(config) - Date.now() : 0);
    })
    .catch(() => {});
}

export function startTelegramBackup() {
  if (g.timer) return;
  console.log("[AutoBackup] scheduler started");
  scheduleFirstRun();
}

export function stopTelegramBackup() {
  if (!g.timer) return;
  clearTimeout(g.timer);
  g.timer = null;
  g.nextRunAt = null;
  console.log("[AutoBackup] scheduler stopped");
}

// Where the scheduler stands right now, for the dashboard countdown. nextRunAt
// is only meaningful while a tick is pending; otherwise the UI falls back to
// lastSentAt + interval from the persisted status.
export function getTelegramBackupState() {
  return { schedulerActive: Boolean(g.timer), nextRunAt: g.timer ? g.nextRunAt : null };
}

// Hot-reload entry (config save / startup): applies the currently stored config.
export async function configureTelegramBackup() {
  const config = await getAutoBackupConfig();
  if (!config.enabled || !hasSender(config)) {
    stopTelegramBackup();
    return;
  }
  if (g.timer) clearTimeout(g.timer); // reschedule against the (possibly new) interval
  g.timer = null;
  startTelegramBackup();
}
