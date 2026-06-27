// Auth gates for the Telegram webhook. Two layers:
//   1. Telegram signs each webhook with the secret_token we set during setWebhook.
//      Reject any request missing/mismatching the X-Telegram-Bot-Api-Secret-Token header.
//   2. Inside the handler, message.from.id must match an allowed chat_id.

export function checkSecret(request) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) return false; // refuse to operate without a secret configured
  const got = request.headers.get("x-telegram-bot-api-secret-token");
  return got === expected;
}

function parseAllowedIds() {
  const raw = process.env.TELEGRAM_OWNER_CHAT_ID || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

export function isAllowed(userId) {
  const allowed = parseAllowedIds();
  if (allowed.length === 0) return false;
  return allowed.includes(Number(userId));
}
