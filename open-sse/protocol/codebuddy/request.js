/**
 * Normalize an OpenAI-shaped chat body for CodeBuddy.
 * CodeBuddy CN uses the verified allowlist; broader gateways may preserve
 * unknown top-level fields while sharing reasoning, tools, and stream rules.
 */

import { CHAT_BODY_ALLOWLIST, REASONING_OFF } from "./constants.js";

/**
 * @param {object} body
 * @param {{ preserveUnknownFields?: boolean }} [options]
 * @returns {object}
 */
export function sanitizeChatBody(body, { preserveUnknownFields = false } = {}) {
  if (!body || typeof body !== "object") {
    return { stream: true, messages: [] };
  }

  const out = preserveUnknownFields ? { ...body } : {};
  if (!preserveUnknownFields) {
    for (const key of CHAT_BODY_ALLOWLIST) {
      if (body[key] !== undefined) out[key] = body[key];
    }
  }

  // Gateway rejects non-stream chat (HTTP 400 code 11101).
  out.stream = true;

  const effRaw = out.reasoning_effort;
  const eff =
    typeof effRaw === "string" ? effRaw.trim().toLowerCase() : effRaw == null ? "" : String(effRaw);

  if (!eff || REASONING_OFF.has(eff)) {
    delete out.reasoning_effort;
    delete out.reasoning_summary;
  } else {
    // The gateway surfaces model reasoning when summary is "auto" alongside
    // effort. Only attach it when the client actually requested reasoning.
    if (out.reasoning_summary == null || out.reasoning_summary === "") {
      out.reasoning_summary = "auto";
    }
  }

  // Empty tools array is useless noise; some gateways reject it.
  if (Array.isArray(out.tools) && out.tools.length === 0) delete out.tools;

  return out;
}
