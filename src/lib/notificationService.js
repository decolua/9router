import { getSettings } from "@/lib/localDb";

const isCloud = typeof caches !== "undefined" && typeof caches === "object";

// Throttle map: key -> last notified timestamp
const throttleMap = new Map();

// Cached sender instance
let cachedSender = null;
let cachedUrls = null;

async function getSender(urls) {
  if (!urls || urls.length === 0) return null;

  const urlsKey = JSON.stringify(urls);
  if (cachedSender && cachedUrls === urlsKey) return cachedSender;

  try {
    const { createSender } = await import("@toanalien/ahha");
    cachedSender = createSender(urls, { strategy: "broadcast" });
    cachedUrls = urlsKey;
    return cachedSender;
  } catch (err) {
    console.error("[notificationService] Failed to create sender:", err.message);
    return null;
  }
}

/**
 * Send provider error notification via configured webhooks.
 * Fire-and-forget, throttled per connectionId:statusCode.
 */
export async function notifyProviderError({ provider, model, connectionId, connectionName, statusCode, errorMessage }) {
  if (isCloud) return;

  try {
    const settings = await getSettings();
    if (!settings.webhookEnabled) return;

    const urls = settings.webhookUrls;
    if (!urls || urls.length === 0) return;

    const errorCodes = settings.webhookErrorCodes || [401, 403, 429, 500, 502, 503];
    if (!errorCodes.includes(statusCode)) return;

    // Throttle check
    const throttleMs = settings.webhookThrottleMs || 300000;
    const throttleKey = `${connectionId}:${statusCode}`;
    const lastSent = throttleMap.get(throttleKey) || 0;
    if (Date.now() - lastSent < throttleMs) return;

    const sender = await getSender(urls);
    if (!sender) return;

    const timestamp = new Date().toISOString();
    const message = `[9Router] ${provider}/${model} error ${statusCode} on "${connectionName}": ${errorMessage} (${timestamp})`;

    throttleMap.set(throttleKey, Date.now());
    await sender.send(message);
  } catch (err) {
    console.error("[notificationService] Send failed:", err.message);
  }
}

/**
 * Send a test notification to verify webhook configuration.
 * @param {string[]} urls - ahha-compatible URL strings
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function sendTestNotification(urls) {
  try {
    const { createSender } = await import("@toanalien/ahha");
    const sender = createSender(urls, { strategy: "broadcast" });
    const results = await sender.send("[9Router] Test notification - webhook configured successfully");
    const failed = results.filter(r => !r.success);
    if (failed.length > 0) {
      return { success: false, error: failed.map(r => r.error?.message || "Unknown error").join("; ") };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
