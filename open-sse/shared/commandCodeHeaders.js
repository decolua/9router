/**
 * Command Code request identity — mirrors buildCommandAuthHeaders() of the
 * official CLI (command-code@1.88.0). Static headers live in the provider
 * registry; this module adds the per-process / per-session ones:
 *
 *  - x-project-slug: the CLI sends slugify(process.cwd()) (@sindresorhus/slugify).
 *    9router has no client workspace, so it reports its own working dir — the
 *    same value the request body carries as config.workingDir.
 *  - x-session-id: conversation-stable id, shared with the body's threadId.
 */

import { createHash, randomUUID } from "crypto";
import { PROVIDERS } from "../config/providers.js";

// Subset of @sindresorhus/slugify's built-in replacements + the transliterate
// table entries that Unicode NFD decomposition does not cover.
const CHAR_REPLACEMENTS = new Map([
  ["&", " and "], ["🦄", " unicorn "], ["♥", " love "],
  ["ß", "ss"], ["ẞ", "Ss"], ["ä", "ae"], ["Ä", "Ae"], ["ö", "oe"], ["Ö", "Oe"], ["ü", "ue"], ["Ü", "Ue"],
  ["Æ", "AE"], ["æ", "ae"], ["Ø", "O"], ["ø", "o"], ["Œ", "OE"], ["œ", "oe"],
  ["Ð", "D"], ["ð", "d"], ["Đ", "D"], ["đ", "d"], ["Þ", "TH"], ["þ", "th"], ["Ł", "L"], ["ł", "l"], ["ı", "i"],
]);

function transliterate(value) {
  let out = "";
  for (const ch of value) out += CHAR_REPLACEMENTS.get(ch) ?? ch;
  return out.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Same splitting rules as @sindresorhus/slugify's decamelize (default on).
function decamelize(value) {
  return value
    .replace(/([A-Z]{2,})(\d+)/g, "$1 $2")
    .replace(/([a-z\d]+)([A-Z]{2,})/g, "$1 $2")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-rt-z\d]+)/g, "$1 $2");
}

/** slugify(path) with @sindresorhus/slugify defaults: "/home/u/My Project" → "home-u-my-project". */
export function slugifyPath(value) {
  return decamelize(transliterate(String(value ?? "")))
    .toLowerCase()
    .replace(/[^a-z\d]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Deterministic UUID-shaped id, so a stable session keeps the format upstream already accepts. */
export function toCommandCodeSessionUuid(sessionId) {
  if (!sessionId) return randomUUID();
  const h = createHash("sha256").update(String(sessionId)).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const COMMAND_CODE_WORKING_DIR = process.cwd();
export const COMMAND_CODE_PROJECT_SLUG = slugifyPath(COMMAND_CODE_WORKING_DIR);

export function buildCommandCodeHeaders({ apiKey, sessionId, accept } = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(PROVIDERS.commandcode?.headers || {}),
    "x-project-slug": COMMAND_CODE_PROJECT_SLUG,
    "x-session-id": sessionId || randomUUID(),
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  if (accept) headers["Accept"] = accept;
  return headers;
}
