// Validation, defaults and masking for the `quotaResetNotify` setting.
//
// Webhook URLs and bot tokens are credentials (a Slack/Discord URL *is* the
// token). They are accepted on write, never returned on read: maskConfig hands
// the dashboard only "is it set" and the host, and normalizeConfig treats a blank
// secret as "keep the stored one" so editing a target does not require re-pasting it.

import { randomUUID } from "node:crypto";
import {
  TARGET_TYPES, MAX_TARGETS, MAX_TEMPLATE_LENGTH,
  DEFAULT_TITLE_TEMPLATE, DEFAULT_BODY_TEMPLATE,
} from "./quotaResetCore.js";

const MAX_CONNECTION_OVERRIDES = 500;
const MAX_NAME_LENGTH = 60;
const TELEGRAM_TOKEN = /^\d{3,}:[A-Za-z0-9_-]{10,}$/;
const TELEGRAM_CHAT = /^(-?\d{1,20}|@[A-Za-z0-9_]{3,64})$/;

export function defaultConfig() {
  return {
    enabled: false,
    defaults: { fiveHour: true, weekly: true },
    connections: {},
    titleTemplate: DEFAULT_TITLE_TEMPLATE,
    bodyTemplate: DEFAULT_BODY_TEMPLATE,
    targets: [],
  };
}

/** Read a stored value back into a complete config, tolerating anything old or partial. */
export function readConfig(raw) {
  const base = defaultConfig();
  if (!raw || typeof raw !== "object") return base;
  return {
    enabled: raw.enabled === true,
    defaults: {
      fiveHour: raw.defaults?.fiveHour !== false,
      weekly: raw.defaults?.weekly !== false,
    },
    connections: raw.connections && typeof raw.connections === "object" ? raw.connections : {},
    titleTemplate: typeof raw.titleTemplate === "string" && raw.titleTemplate ? raw.titleTemplate : base.titleTemplate,
    bodyTemplate: typeof raw.bodyTemplate === "string" && raw.bodyTemplate ? raw.bodyTemplate : base.bodyTemplate,
    targets: Array.isArray(raw.targets) ? raw.targets : [],
  };
}

function fail(message) {
  throw new Error(message);
}

function cleanUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(String(value).trim());
  } catch {
    fail(`${label}: 올바른 URL이 아닙니다`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    fail(`${label}: http 또는 https URL만 사용할 수 있습니다`);
  }
  return parsed.toString();
}

function cleanTemplate(value, fallback, label) {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") fail(`${label}: 문자열이어야 합니다`);
  if (value.length > MAX_TEMPLATE_LENGTH) fail(`${label}: ${MAX_TEMPLATE_LENGTH}자 이하여야 합니다`);
  return value;
}

function cleanTarget(input, existingById) {
  if (!input || typeof input !== "object") fail("대상 형식이 올바르지 않습니다");
  const type = String(input.type || "");
  if (!TARGET_TYPES.includes(type)) fail(`지원하지 않는 대상 종류: ${type || "(없음)"}`);

  const id = typeof input.id === "string" && /^[\w-]{1,64}$/.test(input.id) ? input.id : randomUUID();
  const name = String(input.name || "").trim().slice(0, MAX_NAME_LENGTH) || type;
  const stored = existingById.get(id);
  const label = `대상 "${name}"`;
  const target = { id, name, type, enabled: input.enabled !== false };

  if (type === "telegram") {
    const token = String(input.botToken || "").trim() || (stored?.type === "telegram" ? stored.botToken : "");
    if (!TELEGRAM_TOKEN.test(token || "")) fail(`${label}: 봇 토큰 형식이 올바르지 않습니다`);
    const chatId = String(input.chatId ?? stored?.chatId ?? "").trim();
    if (!TELEGRAM_CHAT.test(chatId)) fail(`${label}: chat id 형식이 올바르지 않습니다`);
    return { ...target, botToken: token, chatId };
  }

  const rawUrl = String(input.url || "").trim() || (stored && stored.type !== "telegram" ? stored.url : "");
  if (!rawUrl) fail(`${label}: 웹훅 URL이 필요합니다`);
  return { ...target, url: cleanUrl(rawUrl, label) };
}

function cleanConnections(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const [id, value] of Object.entries(input).slice(0, MAX_CONNECTION_OVERRIDES)) {
    if (!value || typeof value !== "object" || !/^[\w-]{1,64}$/.test(id)) continue;
    const entry = {};
    if (typeof value.fiveHour === "boolean") entry.fiveHour = value.fiveHour;
    if (typeof value.weekly === "boolean") entry.weekly = value.weekly;
    if (Object.keys(entry).length) out[id] = entry;
  }
  return out;
}

/**
 * Validate a config coming from the dashboard and merge it over what is stored.
 * Throws an Error with a user-facing message on invalid input.
 * @param {object} input request body
 * @param {object} [existing] currently stored config (for keeping blank secrets)
 */
export function normalizeConfig(input, existing) {
  if (!input || typeof input !== "object") fail("설정 형식이 올바르지 않습니다");
  const stored = readConfig(existing);
  const existingById = new Map(stored.targets.map((t) => [t?.id, t]));

  const rawTargets = Array.isArray(input.targets) ? input.targets : stored.targets;
  if (rawTargets.length > MAX_TARGETS) fail(`대상은 최대 ${MAX_TARGETS}개까지 등록할 수 있습니다`);

  return {
    enabled: input.enabled === true,
    defaults: {
      fiveHour: input.defaults ? input.defaults.fiveHour !== false : stored.defaults.fiveHour,
      weekly: input.defaults ? input.defaults.weekly !== false : stored.defaults.weekly,
    },
    connections: input.connections !== undefined ? cleanConnections(input.connections) : stored.connections,
    titleTemplate: cleanTemplate(input.titleTemplate, DEFAULT_TITLE_TEMPLATE, "제목 템플릿"),
    bodyTemplate: cleanTemplate(input.bodyTemplate, DEFAULT_BODY_TEMPLATE, "본문 템플릿"),
    targets: rawTargets.map((t) => cleanTarget(t, existingById)),
  };
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** What the dashboard may see: no URL path/query, no bot token. */
export function maskConfig(config) {
  const c = readConfig(config);
  return {
    ...c,
    targets: c.targets.map((t) => ({
      id: t.id, name: t.name, type: t.type, enabled: t.enabled !== false,
      ...(t.type === "telegram"
        ? { chatId: t.chatId, botTokenSet: Boolean(t.botToken) }
        : { urlSet: Boolean(t.url), urlHost: hostOf(t.url) }),
    })),
  };
}
