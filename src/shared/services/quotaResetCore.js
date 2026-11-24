// Pure logic for quota-reset notifications: classify a quota window, detect that
// it reset between two looks, render the message and shape each target's payload.
// No I/O here — quotaResetNotifier.js owns scheduling, fetching and sending.

export const WINDOW_FIVE_HOUR = "fiveHour";
export const WINDOW_WEEKLY = "weekly";
export const WINDOW_LABELS = { [WINDOW_FIVE_HOUR]: "5시간", [WINDOW_WEEKLY]: "주간" };

export const TARGET_TYPES = ["slack", "discord", "telegram", "generic"];
export const MAX_TARGETS = 10;
export const MAX_TEMPLATE_LENGTH = 500;

export const DEFAULT_TITLE_TEMPLATE = "{provider} {window} 한도 리셋";
export const DEFAULT_BODY_TEMPLATE =
  "{account} 계정의 {window} 한도({quota})가 리셋되었어요.\n지난 창 사용률 {usedPercent}% · 다음 리셋 {nextResetAt}";

// Same clock-skew allowance the reset cache in quotaAutoPing uses: a provider that
// still reports the old resetAt (within a minute) has not rolled the window yet.
const SAME_RESET_TOLERANCE_MS = 60000;

/**
 * Map a provider's quota key to a window class. Weekly is checked first because a
 * key like "weekly sonnet (7d)" must not fall into the 5h bucket.
 * @param {string} quotaKey
 * @returns {"fiveHour"|"weekly"|null}
 */
export function classifyWindow(quotaKey) {
  const key = String(quotaKey || "").toLowerCase();
  if (/week|7d/.test(key)) return WINDOW_WEEKLY;
  if (/session|5h/.test(key)) return WINDOW_FIVE_HOUR;
  return null;
}

function toMs(value) {
  if (value == null || value === "") return null;
  const ms = typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function usedPercentOf(quota) {
  if (!quota || quota.unlimited === true) return null;
  const total = Number(quota.total);
  const used = Number(quota.used);
  if (Number.isFinite(total) && total > 0 && Number.isFinite(used)) {
    return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
  }
  const remainingPct = Number(quota.remainingPercentage);
  if (Number.isFinite(remainingPct)) return Math.max(0, Math.min(100, Math.round(100 - remainingPct)));
  return null;
}

/**
 * Compare a connection's last remembered windows with what the provider reports now.
 *
 * A window has reset when its remembered resetAt has passed AND the provider no
 * longer reports that same resetAt — either it moved forward, went null (Claude
 * leaves a 5h window unopened until the next message) or the key vanished.
 * Sliding windows (resetAt keeps moving ahead of now) never trip this.
 *
 * Returns new objects; `prev` is not mutated.
 *
 * @param {Record<string,{resetAt:number|null,usedPercent:number|null}>} prev
 * @param {Record<string,object>|undefined} quotas
 * @param {number} now epoch ms
 * @returns {{events: Array, next: Record<string,object>}}
 */
export function detectResets(prev, quotas, now) {
  const previous = prev || {};
  const current = quotas || {};
  const events = [];
  const next = {};

  for (const [quotaKey, quota] of Object.entries(current)) {
    const window = classifyWindow(quotaKey);
    if (!window || !quota || quota.unlimited === true) continue;

    const resetAt = toMs(quota.resetAt);
    const usedPercent = usedPercentOf(quota);
    const before = previous[quotaKey];

    if (before && before.resetAt != null && now >= before.resetAt) {
      const stale = resetAt != null && Math.abs(resetAt - before.resetAt) <= SAME_RESET_TOLERANCE_MS;
      if (stale) {
        next[quotaKey] = before; // provider still shows the old window — look again next tick
        continue;
      }
      events.push({
        quotaKey, window,
        previousResetAt: before.resetAt,
        previousUsedPercent: before.usedPercent ?? null,
        nextResetAt: resetAt,
      });
    }
    next[quotaKey] = { resetAt, usedPercent, window };
  }

  // A key that disappeared after its window ended is a reset too; one that vanished
  // mid-window is a transient provider answer, so keep what we knew.
  for (const [quotaKey, before] of Object.entries(previous)) {
    if (quotaKey in current) continue;
    if (before?.resetAt != null && now >= before.resetAt) {
      events.push({
        quotaKey, window: before.window || classifyWindow(quotaKey),
        previousResetAt: before.resetAt,
        previousUsedPercent: before.usedPercent ?? null,
        nextResetAt: null,
      });
    } else {
      next[quotaKey] = before;
    }
  }

  return { events, next };
}

/**
 * Whether this account wants this window. Per-account overrides beat the defaults.
 */
export function isWindowEnabled(config, connectionId, window) {
  const override = config?.connections?.[connectionId];
  if (override && typeof override[window] === "boolean") return override[window];
  return config?.defaults?.[window] === true;
}

const TEMPLATE_TOKEN = /\{(\w+)\}/g;

/**
 * Fill {placeholders}. Unknown placeholders are kept verbatim so a typo is visible
 * in the message instead of silently vanishing.
 */
export function renderTemplate(template, vars) {
  return String(template ?? "").replace(TEMPLATE_TOKEN, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match);
}

function formatTime(ms, timeZone) {
  if (ms == null) return "-";
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: timeZone || undefined,
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

/**
 * Template variables for one reset event.
 * @param {{provider:string, account:string, event:object, now:number, timeZone?:string}} input
 */
export function buildVars({ provider, account, event, now, timeZone }) {
  return {
    provider,
    account,
    window: WINDOW_LABELS[event.window] || event.window,
    quota: event.quotaKey,
    usedPercent: event.previousUsedPercent ?? "-",
    previousResetAt: formatTime(event.previousResetAt, timeZone),
    nextResetAt: event.nextResetAt == null ? "다음 요청 시 시작" : formatTime(event.nextResetAt, timeZone),
    time: formatTime(now, timeZone),
  };
}

/**
 * Build the HTTP request for one target. Returns {url, body} where body is the
 * JSON-serialisable payload. Secrets (webhook url, bot token) are read here only.
 *
 * `generic` sends exactly {title, text, level} — the shape the Bot notify webhook
 * accepts — and nothing else, so a strict receiver does not reject extra fields.
 */
export function buildRequest(target, { title, text }) {
  switch (target.type) {
    case "slack":
      return { url: target.url, body: { text: `*${title}*\n${text}` } };
    case "discord":
      return { url: target.url, body: { content: `**${title}**\n${text}`.slice(0, 2000) } };
    case "telegram":
      return {
        url: `https://api.telegram.org/bot${target.botToken}/sendMessage`,
        body: { chat_id: target.chatId, text: `${title}\n${text}`.slice(0, 4096) },
      };
    case "generic":
    default:
      return { url: target.url, body: { title, text, level: "info" } };
  }
}
