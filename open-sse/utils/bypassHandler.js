import { detectFormat } from "../services/provider.js";
import { SKIP_PATTERNS } from "../config/runtimeConfig.js";
import { createNonStreamingResponse, createStreamingResponse } from "./bypassResponse.js";

/**
 * Check for bypass patterns - return fake response without calling provider
 * Only works for Claude CLI requests
 */
export function handleBypassRequest(body, model, userAgent = "", ccFilterNaming = false) {
  if (!userAgent.includes("claude-cli")) return null;
  if (!body.messages?.length) return null;

  const messages = body.messages;
  const getText = (content) => {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.filter(c => c.type === "text").map(c => c.text).join(" ");
    }
    return "";
  };

  let shouldBypass = false;
  let namingBypass = false;

  // Pattern 1: Title extraction (assistant message = "{")
  const lastMsg = messages[messages.length - 1];
  if (lastMsg?.role === "assistant" && lastMsg.content?.[0]?.text === "{") {
    shouldBypass = true;
  }

  // Pattern 2: Warmup
  if (!shouldBypass) {
    const firstText = getText(messages[0]?.content);
    if (firstText === "Warmup") {
      shouldBypass = true;
    }
  }

  // Pattern 3: Count
  if (!shouldBypass && messages.length === 1 && messages[0]?.role === "user") {
    const firstText = getText(messages[0]?.content);
    if (firstText === "count") {
      shouldBypass = true;
    }
  }

  // Pattern 4: Skip patterns
  if (!shouldBypass && SKIP_PATTERNS?.length) {
    const userMessages = messages.filter(m => m.role === "user");
    const userText = userMessages.map(m => getText(m.content)).join(" ");
    if (SKIP_PATTERNS.some(p => userText.includes(p))) {
      shouldBypass = true;
    }
  }

  // Pattern 5: CC naming request (topic title extraction by Claude Code CLI)
  // Claude format: system is top-level body.system field, not inside messages
  if (!shouldBypass && ccFilterNaming) {
    const systemMsg = messages.find(m => m.role === "system");
    const systemFromMessages = getText(systemMsg?.content);
    const systemFromBody = Array.isArray(body.system)
      ? body.system.filter(s => s.type === "text").map(s => s.text).join(" ")
      : (typeof body.system === "string" ? body.system : "");
    const systemText = systemFromMessages || systemFromBody;
    if (systemText.includes("isNewTopic")) {
      shouldBypass = true;
      namingBypass = true;
    }
  }

  if (!shouldBypass) return null;

  const sourceFormat = detectFormat(body);
  const stream = body.stream !== false;

  // For naming bypass, generate title from user message
  if (namingBypass) {
    const userMsg = messages.find(m => m.role === "user");
    const userText = getText(userMsg?.content);
    const title = userText.trim().split(/\s+/).slice(0, 3).join(" ");
    const namingText = JSON.stringify({ isNewTopic: true, title });
    return stream
      ? createStreamingResponse(sourceFormat, model, namingText)
      : createNonStreamingResponse(sourceFormat, model, namingText);
  }

  return stream 
    ? createStreamingResponse(sourceFormat, model)
    : createNonStreamingResponse(sourceFormat, model);
}

