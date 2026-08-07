/**
 * Claude → Antigravity Request Translator (DIRECT route when images present)
 *
 * The generic claude→openai→antigravity pivot drops images in two places:
 *   1. The OpenAI intermediate `role:"tool"` content is a string — image blocks
 *      inside tool_result get stringified, so the model never sees them.
 *   2. wrapInCloudCodeEnvelopeForClaude had no IMAGE branch, silently dropping
 *      pasted images for Claude models.
 *
 * This direct route feeds the Anthropic Messages body straight into the Cloud
 * Code envelope, preserving image blocks as Gemini `inlineData` parts (user
 * message) or `functionResponse.parts[].inlineData` (tool_result) — mirroring
 * how CLIProxyAPI's antigravity/claude translator keeps images intact.
 *
 * Requests WITHOUT images keep the existing double-hop behavior exactly, so
 * text-only traffic is untouched (no regression).
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { claudeToOpenAIRequest } from "./claude-to-openai.js";
import { openaiToAntigravityRequest, wrapInCloudCodeEnvelopeForClaude } from "./openai-to-gemini.js";
import { ROLE, CLAUDE_BLOCK } from "../schema/index.js";

// Does the body carry any image block (direct message or inside tool_result)?
function containsImage(body) {
  if (!body?.messages || !Array.isArray(body.messages)) return false;
  for (const msg of body.messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block?.type === CLAUDE_BLOCK.IMAGE) return true;
      if (block?.type === CLAUDE_BLOCK.TOOL_RESULT && Array.isArray(block.content)) {
        if (block.content.some(c => c?.type === CLAUDE_BLOCK.IMAGE)) return true;
      }
    }
  }
  return false;
}

// Drop the Claude Code attribution system block (Antigravity doesn't need it),
// mirroring openaiToClaudeRequestForAntigravity.
function stripClaudeCodeAttribution(body) {
  if (!body?.system) return body;
  const clean = { ...body };
  if (Array.isArray(body.system)) {
    clean.system = body.system.filter(b => !b?.text || !b.text.includes("You are Claude Code"));
  } else if (typeof body.system === "string") {
    clean.system = body.system.includes("You are Claude Code") ? "" : body.system;
  }
  return clean;
}

export function claudeToAntigravityRequest(model, body, stream, credentials) {
  // Non-image requests keep the existing double-hop (identical output, no regression).
  if (!containsImage(body)) {
    const openaiBody = claudeToOpenAIRequest(model, body, stream);
    return openaiToAntigravityRequest(model, openaiBody, stream, credentials);
  }

  const claudeRequest = stripClaudeCodeAttribution(body);
  return wrapInCloudCodeEnvelopeForClaude(model, claudeRequest, credentials);
}

register(FORMATS.CLAUDE, FORMATS.ANTIGRAVITY, claudeToAntigravityRequest, null);
