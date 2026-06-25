import { EventEmitter } from "events";
import { getSettings } from "@/lib/localDb";

if (!global._notificationEmitter) {
  global._notificationEmitter = new EventEmitter();
  global._notificationEmitter.setMaxListeners(100);
}

export const notificationEmitter = global._notificationEmitter;

/**
 * Dispatch an alert notification to Telegram and/or Web Client
 * @param {string} title - Notification title
 * @param {string} message - Main error details or alert message
 * @param {object} metadata - Extra details (provider, model, status, connectionName)
 */
export async function sendNotification(title, message, metadata = {}) {
  const settings = await getSettings();

  const payload = {
    id: Math.random().toString(36).substring(2, 9),
    timestamp: new Date().toISOString(),
    title,
    message,
    metadata,
  };

  // 1. Emit for Web SSE Stream
  if (settings.webNotificationsEnabled) {
    notificationEmitter.emit("notification", payload);
  }

  // 2. Send Telegram Notification
  if (
    settings.telegramNotificationsEnabled &&
    settings.telegramBotToken &&
    settings.telegramChatId
  ) {
    const tgText = `⚠️ *${title}*\n\n` +
      `• *Provider:* \`${metadata.provider || "unknown"}\`\n` +
      `• *Model:* \`${metadata.model || "unknown"}\`\n` +
      `• *Account:* \`${metadata.connectionName || "Public"}\`\n` +
      `• *Status:* \`${metadata.status || "error"}\`\n` +
      `• *Details:* ${message}`;

    try {
      const url = `https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: settings.telegramChatId,
          text: tgText,
          parse_mode: "Markdown",
        }),
      });

      if (!response.ok) {
        const bodyText = await response.text();
        console.error(`[Notifier] Telegram API failed: ${response.status} - ${bodyText}`);
      }
    } catch (err) {
      console.error("[Notifier] Failed to send Telegram notification:", err);
    }
  }
}
