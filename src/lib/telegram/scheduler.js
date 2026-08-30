// Digest scheduler for the Telegram bot.
// Runs a lightweight interval (every 15 min) that checks which chats
// are due for their daily digest and sends it.
//
// Survives Next.js hot-reload via global singleton.
// Does NOT use node-cron or any heavy deps — just setInterval.

import { getEnabledDigestChats, sendDigest } from "@/lib/telegram/digest.js";

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // check every 15 minutes
const SEND_WINDOW_MIN = 15; // send if within 15 min of scheduled hour

// Global singleton to survive Next.js hot-reload
if (!global.__digestScheduler) {
  global.__digestScheduler = {
    interval: null,
    lastSent: new Map(), // chatId → date string (YYYY-MM-DD) of last sent digest
    started: false,
  };
}

const state = global.__digestScheduler;

export function startDigestScheduler() {
  if (state.started) return;
  state.started = true;

  console.log("[DigestScheduler] Starting (check every 15 min)");

  // Run immediately on startup (catches missed digests after restart)
  checkAndSend().catch((e) => console.warn("[DigestScheduler] initial check error:", e.message));

  state.interval = setInterval(() => {
    checkAndSend().catch((e) => console.warn("[DigestScheduler] tick error:", e.message));
  }, CHECK_INTERVAL_MS);

  // Don't block Node.js exit
  if (state.interval.unref) state.interval.unref();
}

export function stopDigestScheduler() {
  if (state.interval) {
    clearInterval(state.interval);
    state.interval = null;
  }
  state.started = false;
}

async function checkAndSend() {
  const chats = await getEnabledDigestChats();
  if (chats.length === 0) return;

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  for (const { chatId, config } of chats) {
    // Skip if already sent today
    if (state.lastSent.get(chatId) === todayStr) continue;

    // Check if current UTC hour matches the scheduled hour (with timezone offset)
    const scheduledHourUTC = ((config.hour || 7) - (config.timezone || 0) + 24) % 24;
    const currentHourUTC = now.getUTCHours();
    const currentMinUTC = now.getUTCMinutes();

    // Is it within the send window?
    const totalMinNow = currentHourUTC * 60 + currentMinUTC;
    const totalMinScheduled = scheduledHourUTC * 60;
    const diff = totalMinNow - totalMinScheduled;

    // Send if we're 0-15 min past the scheduled time (inclusive)
    // Also handle wrap-around (e.g. scheduled at 23:45, now is 00:05)
    const inWindow = (diff >= 0 && diff < SEND_WINDOW_MIN) ||
                     (diff + 1440 >= 0 && diff + 1440 < SEND_WINDOW_MIN);

    if (!inWindow) continue;

    // Send the digest
    try {
      await sendDigest(chatId, config);
      state.lastSent.set(chatId, todayStr);
      console.log(`[DigestScheduler] Sent digest to chat ${chatId}`);
    } catch (e) {
      console.error(`[DigestScheduler] Failed to send to ${chatId}:`, e.message);
    }
  }
}

// Manual trigger (for /digest now command)
export async function triggerDigestNow(chatId, config) {
  await sendDigest(chatId, config);
}
