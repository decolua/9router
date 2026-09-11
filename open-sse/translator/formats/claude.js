// Claude helper functions for translator
import { DEFAULT_THINKING_CLAUDE_SIGNATURE } from "../../config/defaultThinkingSignature.js";
import { ROLE, CLAUDE_BLOCK } from "../schema/index.js";
import { adjustMaxTokens } from "./maxTokens.js";
import { applyCloaking } from "../../utils/claudeCloaking.js";
import { resolveSessionId } from "../../utils/sessionManager.js";
import { isValidClaudeSignature } from "../../utils/claudeSignature.js";
import { PROVIDERS } from "../../providers/index.js";
import { getCapabilitiesForModel } from "../../providers/capabilities.js";
import { DEFAULT_MAX_TOKENS } from "../../config/runtimeConfig.js";

const CACHE_CONTROL_5M = { type: "ephemeral" };
const CACHE_CONTROL_1H = { type: "ephemeral", ttl: "1h" };

// Anthropic rejects a tool carrying BOTH defer_loading:true and cache_control
// ("Tools defer_loading cannot use prompt caching", #3567). MCP clients put
// deferred tools at the tail, which is exactly where the cache anchor lands.
// Anchor on the last tool that CAN be cached instead of dropping caching.
export function lastCacheableToolIndex(tools) {
  if (!Array.isArray(tools)) return -1;
  for (let i = tools.length - 1; i >= 0; i--) {
    if (tools[i]?.defer_loading !== true) return i;
  }
  return -1;
}

// Check if message has valid non-empty content
export function hasValidContent(msg) {
  if (typeof msg.content === "string" && msg.content.trim()) return true;
  if (msg.content && typeof msg.content === "object" && !Array.isArray(msg.content)) {
    const block = msg.content;
    return !!((block.type === CLAUDE_BLOCK.TEXT && block.text?.trim()) ||
      block.type === CLAUDE_BLOCK.TOOL_USE ||
      block.type === CLAUDE_BLOCK.TOOL_RESULT ||
      block.type === CLAUDE_BLOCK.IMAGE ||
      block.type === CLAUDE_BLOCK.DOCUMENT);
  }
  if (Array.isArray(msg.content)) {
    return msg.content.some(block =>
      (block.type === CLAUDE_BLOCK.TEXT && block.text?.trim()) ||
      block.type === CLAUDE_BLOCK.TOOL_USE ||
      block.type === CLAUDE_BLOCK.TOOL_RESULT ||
      block.type === CLAUDE_BLOCK.IMAGE ||
      block.type === CLAUDE_BLOCK.DOCUMENT
    );
  }
  return false;
}
// Content may arrive as a single content block object (spec allows string | array;
// some clients send the bare object). Wrap it as a one-block array and strip any
// client-placed cache_control: a bare-object marker must never survive
// normalization, on any path, guard or no guard.
function normalizeMessageContent(msg) {
  const c = msg?.content;
  if (c && typeof c === "object" && !Array.isArray(c)) {
    delete c.cache_control;
    msg.content = [c];
  }
  return msg;
}

// Total blocks carrying cache_control across system, tools, and messages — the
// upstream Messages API allows at most 4 markers per request.
function countCacheControlBlocks(body) {
  let n = 0;
  if (Array.isArray(body?.system)) for (const b of body.system) if (b?.cache_control) n++;
  if (Array.isArray(body?.tools)) for (const t of body.tools) if (t?.cache_control) n++;
  if (Array.isArray(body?.messages)) {
    for (const m of body.messages) {
      if (Array.isArray(m?.content)) {
        for (const b of m.content) if (b?.cache_control) n++;
      } else if (m?.content && typeof m.content === "object" && m.content.cache_control) n++;
    }
  }
  return n;
}
// Trim every marker past the 4-marker budget. The head anchors (last system
// block, last cacheable tool) are held; the remaining slots go to the tail-most
// of the other markers in document order. A plain "keep the last 4 in document
// order" rule would drop the head anchors first — they lead document order, yet
// they are exactly what re-anchoring exists to pin.
function capCacheControlBlocks(body) {
  const isHead = (b) => {
    const sys = Array.isArray(body?.system) ? body.system : [];
    if (sys.length && sys[sys.length - 1] === b) return true;
    const tools = Array.isArray(body?.tools) ? body.tools : [];
    const lastTool = lastCacheableToolIndex(tools);
    return lastTool >= 0 && tools[lastTool] === b;
  };
  const marked = [];
  if (Array.isArray(body?.system)) for (const b of body.system) if (b?.cache_control) marked.push(b);
  if (Array.isArray(body?.tools)) for (const t of body.tools) if (t?.cache_control) marked.push(t);
  if (Array.isArray(body?.messages)) {
    for (const m of body.messages) {
      if (Array.isArray(m?.content)) for (const b of m.content) if (b?.cache_control) marked.push(b);
    }
  }
  const head = marked.filter(isHead);
  const rest = marked.filter(b => !isHead(b));
  const keep = Math.max(0, 4 - head.length);
  for (const b of rest.slice(0, Math.max(0, rest.length - keep))) delete b.cache_control;
}

// Fix tool_use/tool_result ordering for Claude API
// 1. Assistant message with tool_use: remove text AFTER tool_use (Claude doesn't allow)
// 2. Merge consecutive same-role messages
export function fixToolUseOrdering(messages) {
  if (messages.length <= 1) return messages;

  // Pass 1: Fix assistant messages with tool_use - remove text after tool_use
  for (const msg of messages) {
    if (msg.role === ROLE.ASSISTANT && Array.isArray(msg.content)) {
      const hasToolUse = msg.content.some(b => b.type === CLAUDE_BLOCK.TOOL_USE);
      if (hasToolUse) {
        // Keep only: thinking blocks + tool_use blocks (remove text blocks after tool_use)
        const newContent = [];
        let foundToolUse = false;

        for (const block of msg.content) {
          if (block.type === CLAUDE_BLOCK.TOOL_USE) {
            foundToolUse = true;
            newContent.push(block);
          } else if (block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING) {
            newContent.push(block);
          } else if (!foundToolUse) {
            // Keep text blocks BEFORE tool_use
            newContent.push(block);
          }
          // Skip text blocks AFTER tool_use
        }

        msg.content = newContent;
      }
    }
  }

  // Pass 2: Merge consecutive same-role messages
  const merged = [];

  for (const msg of messages) {
    const last = merged[merged.length - 1];

    if (last && last.role === msg.role) {
      // Merge content arrays
      const lastContent = Array.isArray(last.content) ? last.content : [{ type: CLAUDE_BLOCK.TEXT, text: last.content }];
      const msgContent = Array.isArray(msg.content) ? msg.content : [{ type: CLAUDE_BLOCK.TEXT, text: msg.content }];

      // Put tool_result first, then other content
      const toolResults = [...lastContent.filter(b => b.type === CLAUDE_BLOCK.TOOL_RESULT), ...msgContent.filter(b => b.type === CLAUDE_BLOCK.TOOL_RESULT)];
      const otherContent = [...lastContent.filter(b => b.type !== CLAUDE_BLOCK.TOOL_RESULT), ...msgContent.filter(b => b.type !== CLAUDE_BLOCK.TOOL_RESULT)];

      last.content = [...toolResults, ...otherContent];
    } else {
      // Ensure content is array
      const content = Array.isArray(msg.content) ? msg.content : [{ type: CLAUDE_BLOCK.TEXT, text: msg.content }];
      merged.push({ role: msg.role, content: [...content] });
    }
  }

  return merged;
}

// Models that reject thinking.type "adaptive" + output_config.effort (Opus 4.5+/Sonnet 4.6+ only)
const ADAPTIVE_THINKING_UNSUPPORTED = /haiku/i;

function handlesThinkingBlocks(provider) {
  return provider === "claude" || provider?.startsWith("anthropic-compatible") || provider === "deepseek";
}

function buildThinkingPlaceholder(provider) {
  const block = {
    type: CLAUDE_BLOCK.THINKING,
    thinking: ".",
  };

  // DeepSeek's Anthropic-compatible endpoint requires a thinking block in
  // thinking mode, but it does not need Anthropic's signed-thinking fallback.
  if (provider !== "deepseek") {
    block.signature = DEFAULT_THINKING_CLAUDE_SIGNATURE;
  }

  return block;
}

// Anthropic validates server_tool_use ids against this pattern and rejects the
// whole request with a 400 when one does not match. A combo that falls back to a
// provider with its own built-in tools (z.ai/glm emits OpenAI-style `call_` ids for
// its analyze_image tool) leaves such blocks in the history, so every later Claude
// turn carries a poisoned id.
const CLAUDE_SERVER_TOOL_USE_ID = /^srvtoolu_[a-zA-Z0-9_]+$/;

function hasForeignServerToolUseId(block) {
  return block?.type === CLAUDE_BLOCK.SERVER_TOOL_USE
    && !CLAUDE_SERVER_TOOL_USE_ID.test(String(block.id ?? ""));
}

// Normalize a native Claude passthrough body to match Anthropic Messages API spec.
// Newer Cowork/Claude Code clients emit beta-only shapes that OAuth endpoints reject:
// 1. thinking.type "adaptive" → unsupported on Haiku
// 2. output_config.effort → unsupported on Haiku
// 3. bare content-block objects (content: {block} instead of [{block}]) → wrapped first
// 4. role "system" messages (mid-conversation-system beta) → only top-level system is allowed
// 5. server_tool_use blocks carrying a foreign (non-srvtoolu_) id → rejected outright
export function normalizeClaudePassthrough(body, model = "") {
  if (!body || typeof body !== "object") return body;

  // 1. Downgrade adaptive thinking for models that don't support it
  if (body.thinking?.type === "adaptive" && ADAPTIVE_THINKING_UNSUPPORTED.test(model)) {
    body.thinking = { type: "enabled", budget_tokens: 10000 };
  }

  // 2. Strip effort param for models that don't support it (keep other output_config fields)
  if (ADAPTIVE_THINKING_UNSUPPORTED.test(model) && body.output_config?.effort != null) {
    delete body.output_config.effort;
    if (Object.keys(body.output_config).length === 0) delete body.output_config;
  }

  // 3. Wrap bare content-block objects as one-element arrays before folding.
  // Some clients send content: {block} instead of content: [{block}]; the
  // mid-conversation-system fold below assumes the array shape, so it must
  // run first — a bare-object neighbor would otherwise be zeroed to [].
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) normalizeMessageContent(msg);
  }

  // 4. Fold mid-conversation system messages into the neighbouring turn.
  // Hoisting them into body.system would insert volatile content (token counters,
  // reminders) ahead of the whole conversation and invalidate the prefix cache on
  // every request. Folding in place keeps the cached prefix stable.
  if (Array.isArray(body.messages)) {
    const messages = [];
    for (const msg of body.messages) {
      if (msg.role !== ROLE.SYSTEM) {
        messages.push(msg);
        continue;
      }
      const text = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map(b => (typeof b === "string" ? b : b?.text || "")).join("\n")
          : "";
      if (!text.trim()) continue;

      // Copy-on-write: the caller's body is reused across account-fallback
      // attempts, so folding must never mutate the original message.
      const block = { type: CLAUDE_BLOCK.TEXT, text };
      const prev = messages[messages.length - 1];
      if (prev?.role === ROLE.USER) {
        const content = typeof prev.content === "string"
          ? [{ type: CLAUDE_BLOCK.TEXT, text: prev.content }]
          : Array.isArray(prev.content) ? [...prev.content] : [];
        messages[messages.length - 1] = { ...prev, content: [...content, block] };
        continue;
      }
      messages.push({ role: ROLE.USER, content: [block] });
    }
    body.messages = messages;
  }

  // 5. Drop thinking blocks whose signature is not Claude's (combo mixes models,
  // so foreign signatures leak into history and Anthropic rejects them).
  const thinkingEnabled = body.thinking?.type === "enabled";
  const droppedServerToolUseIds = new Set();
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (msg.role !== ROLE.ASSISTANT || !Array.isArray(msg.content)) continue;
      let hasToolUse = false;
      let hasKeptThinking = false;
      const kept = [];
      for (const block of msg.content) {
        if (block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING) {
          if (isValidClaudeSignature(block.signature)) {
            hasKeptThinking = true;
            kept.push(block);
          }
          continue;
        }
        if (hasForeignServerToolUseId(block)) {
          if (block.id != null) droppedServerToolUseIds.add(String(block.id));
          continue;
        }
        if (block.type === CLAUDE_BLOCK.TOOL_USE) hasToolUse = true;
        kept.push(block);
      }
      msg.content = kept;
      if (thinkingEnabled && !hasKeptThinking && hasToolUse) {
        msg.content.unshift(buildThinkingPlaceholder("claude"));
      }
    }
  }

  // A dropped server_tool_use leaves its result behind; Anthropic rejects a
  // tool_result that references an id no block declares, so both halves must go.
  if (droppedServerToolUseIds.size > 0 && Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (!Array.isArray(msg.content)) continue;
      const kept = msg.content.filter(block => !(
        (block?.type === CLAUDE_BLOCK.TOOL_RESULT || block?.type === CLAUDE_BLOCK.WEB_SEARCH_TOOL_RESULT)
        && droppedServerToolUseIds.has(String(block.tool_use_id ?? ""))
      ));
      if (kept.length !== msg.content.length) {
        msg.content = kept;
      }
    }
  }

  // 6. Drop empty text blocks and any message left with no content at all.
  // Anthropic rejects `messages.N.content` blocks with empty text (400
  // "text content blocks must be non-empty"); a message whose blocks were all
  // stripped above must be dropped, not padded with an empty placeholder.
  if (Array.isArray(body.messages)) {
    body.messages = body.messages.filter(msg => {
      if (typeof msg.content === "string") return msg.content.trim().length > 0;
      if (!Array.isArray(msg.content)) return true;
      msg.content = msg.content.filter(block =>
        !(block?.type === CLAUDE_BLOCK.TEXT && !String(block.text ?? "").trim()));
      return msg.content.length > 0;
    });
  }

  return body;
}

// Put a 5m breakpoint on the last cache-eligible block of a message.
// thinking/redacted_thinking blocks do not accept cache_control.
function markLastCacheableBlock(msg) {
  if (!Array.isArray(msg?.content)) return false;
  for (let i = msg.content.length - 1; i >= 0; i--) {
    const block = msg.content[i];
    if (typeof block !== "object" || block === null) continue;
    if (block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING) continue;
    block.cache_control = { ...CACHE_CONTROL_5M };
    return true;
  }
  return false;
}

// Re-anchor cache breakpoints on a Claude passthrough body (same policy as
// prepareClaudeRequest): last tool + last system block at 1h, last assistant at 5m.
// The client's own markers point at pre-normalization offsets, so they are dropped.
// Must run LAST, after every step that can reshape system/tools/messages
// (normalize, tool dedupe, token savers) — otherwise the anchor drifts off the tail.
export function anchorClaudeCache(body) {
  if (!body || typeof body !== "object") return body;
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) normalizeMessageContent(msg);
  }
  // Invalid markers first, whatever the budget: Anthropic rejects a tool that
  // carries BOTH defer_loading and cache_control (#3567). The re-anchor path
  // below strips them anyway; the over-budget early return used to forward
  // them untouched.
  if (Array.isArray(body.tools)) {
    for (const t of body.tools) {
      if (t?.defer_loading === true) delete t.cache_control;
    }
  }

  // Head anchors first, before any budget guard: the 1h TTL on system/tools is
  // the point of re-anchoring, and skipping it because the client spent its
  // budget would silently downgrade a cache hit to the 5m default.
  if (Array.isArray(body.system)) {
    const last = body.system.length - 1;
    body.system.forEach((block, i) => {
      if (typeof block !== "object" || block === null) return;
      if (i === last) block.cache_control = { ...CACHE_CONTROL_1H };
      else delete block.cache_control;
    });
  }

  if (Array.isArray(body.tools)) {
    const last = lastCacheableToolIndex(body.tools);
    body.tools.forEach((tool, i) => {
      if (i === last) tool.cache_control = { ...CACHE_CONTROL_1H };
      else delete tool.cache_control;
    });
  }

  // Budget guard AFTER the head anchors: with the last system block and last
  // tool pinned, at most 2 slots remain. At >= 4 markers the client has spent
  // the rest of the budget and every remaining marker is itself a valid
  // breakpoint — re-anchoring the tail could only exceed 4, so trim instead.
  if (countCacheControlBlocks(body) >= 4) {
    capCacheControlBlocks(body);
    return body;
  }

  if (Array.isArray(body.messages)) {
    let anchored = null;
    for (let i = body.messages.length - 1; i >= 0; i--) {
      const msg = body.messages[i];
      if (!Array.isArray(msg.content)) continue;
      for (const block of msg.content) delete block.cache_control;

      // Prefer the last assistant turn: it ends a completed exchange, so the
      // prefix up to it stays byte-stable across the following requests.
      if (anchored || msg.role !== ROLE.ASSISTANT) continue;
      anchored = markLastCacheableBlock(msg);
    }

    // First turn of a conversation has no assistant yet — anchor the final
    // message instead, so the opening prompt is cached rather than paid twice.
    if (!anchored) {
      for (let i = body.messages.length - 1; i >= 0 && !anchored; i--) {
        anchored = markLastCacheableBlock(body.messages[i]);
      }
    }
  }

  return body;
}

// Prepare request for Claude format endpoints
// - Cleanup cache_control
// - Filter empty messages
// - Add thinking block for Anthropic endpoint (provider === "claude")
// - Fix tool_use/tool_result ordering
// - Apply cloaking (billing header + fake user ID) for OAuth tokens
export function prepareClaudeRequest(body, provider = null, apiKey = null, connectionId = null, rawHeaders = null, sessionId = null) {
  // quirk: MiniMax's Claude-compatible endpoint rejects Anthropic's output_config (400 invalid params)
  if (PROVIDERS[provider]?.quirks?.dropOutputConfig) {
    delete body.output_config;
  }

  // Clamp max_tokens to the model's real output ceiling. Models whose caps
  // declare a higher maxOutput (e.g. Opus 4.8 / Sonnet 4.6 = 128000) are allowed
  // up to it, so max-effort thinking gets full budget; others fall back to the
  // conservative 64000 default.
  if (body.max_tokens) {
    const ceiling = getCapabilitiesForModel(provider, body.model).maxOutput || DEFAULT_MAX_TOKENS;
    if (body.max_tokens > ceiling) body.max_tokens = ceiling;

    // Reconcile against thinking budget. applyThinking (thinkingUnified.js) runs
    // AFTER adjustMaxTokens capped max_tokens, and the claude-budget format maps
    // max effort → budget_tokens 128000 — larger than the clamped max_tokens.
    // Anthropic requires max_tokens strictly greater than budget_tokens (else 400).
    // Prefer raising max_tokens to preserve the requested thinking depth; if the
    // budget alone meets/exceeds the ceiling, cap output and shrink the budget so
    // some tokens remain for the answer.
    if (body.thinking?.type === "enabled" && body.thinking.budget_tokens && body.thinking.budget_tokens >= body.max_tokens) {
      body.max_tokens = Math.min(body.thinking.budget_tokens + 1024, ceiling);
      if (body.thinking.budget_tokens >= body.max_tokens) {
        body.thinking.budget_tokens = Math.max(1024, body.max_tokens - 1024);
      }
    }
  }

  // 1. System: remove all cache_control, add only to last block with ttl 1h
  if (body.system && Array.isArray(body.system)) {
    body.system = body.system.map((block, i) => {
      const { cache_control, ...rest } = block;
      if (i === body.system.length - 1) {
        return { ...rest, cache_control: { type: "ephemeral", ttl: "1h" } };
      }
      return rest;
    });
  }

  // 2. Messages: process in optimized passes
  if (body.messages && Array.isArray(body.messages)) {
    const len = body.messages.length;
    let filtered = [];

    // Pass 1: remove cache_control + filter empty messages
    for (let i = 0; i < len; i++) {
      const msg = body.messages[i];
      normalizeMessageContent(msg);

      // Remove cache_control from content blocks
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          delete block.cache_control;
        }
      }

      // Keep final assistant even if empty, otherwise check valid content
      const isFinalAssistant = i === len - 1 && msg.role === "assistant";
      if (isFinalAssistant || hasValidContent(msg)) {
        filtered.push(msg);
      }
    }

    // Pass 1.5: Fix tool_use/tool_result ordering
    // Each tool_use must have tool_result in the NEXT message (not same message with other content)
    filtered = fixToolUseOrdering(filtered);

    body.messages = filtered;

    // Check if thinking is enabled AND last message is from user
    const lastMessage = filtered[filtered.length - 1];
    const lastMessageIsUser = lastMessage?.role === "user";
    const thinkingEnabled = body.thinking?.type === "enabled" && lastMessageIsUser;

    // Pass 2 (reverse): add cache_control to last assistant + handle thinking for Anthropic
    let lastAssistantProcessed = false;
    for (let i = filtered.length - 1; i >= 0; i--) {
      const msg = filtered[i];

      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        // Add cache_control to last non-thinking block of first (from end) assistant with content
        // thinking/redacted_thinking blocks do not support cache_control
        if (!lastAssistantProcessed && msg.content.length > 0) {
          for (let j = msg.content.length - 1; j >= 0; j--) {
            const block = msg.content[j];
            if (block.type !== CLAUDE_BLOCK.THINKING && block.type !== CLAUDE_BLOCK.REDACTED_THINKING) {
              block.cache_control = { type: "ephemeral" };
              break;
            }
          }
          lastAssistantProcessed = true;
        }

        // Handle thinking blocks for Anthropic-compatible endpoints.
        if (handlesThinkingBlocks(provider)) {
          let hasToolUse = false;
          let hasKeptThinking = false;

          // Claude native: preserve valid signatures, drop invalid blocks.
          // anthropic-compatible: replace with default (safe fallback for lenient upstreams).
          // DeepSeek: keep existing thinking as-is; add an unsigned placeholder only if missing.
          const isClaudeNative = provider === "claude";
          const isDeepSeek = provider === "deepseek";
          const kept = [];
          for (const block of msg.content) {
            const isThinking = block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING;
            if (isThinking) {
              if (isClaudeNative) {
                if (isValidClaudeSignature(block.signature)) {
                  hasKeptThinking = true;
                  kept.push(block);
                }
              } else if (isDeepSeek) {
                hasKeptThinking = true;
                kept.push(block);
              } else {
                block.signature = DEFAULT_THINKING_CLAUDE_SIGNATURE;
                hasKeptThinking = true;
                kept.push(block);
              }
              continue;
            }
            if (block.type === CLAUDE_BLOCK.TOOL_USE) hasToolUse = true;
            kept.push(block);
          }
          msg.content = kept;

          // Add thinking block if thinking enabled + has tool_use but no thinking
          if (thinkingEnabled && !hasKeptThinking && hasToolUse) {
            msg.content.unshift(buildThinkingPlaceholder(provider));
          }
        }
      }
    }
  }

  // 3. Tools: filter built-in tools for non-Anthropic providers, then handle cache_control
  if (body.tools && Array.isArray(body.tools)) {
    // Strip built-in tools (e.g. web_search_20250305) and normalize to Anthropic-native shape
    // (drop `type` field, fold `function.{name,description,parameters}`) for non-Anthropic providers
    if (provider !== "claude") {
      // Provider-specific whitelist of Anthropic tool `type` values that the
      // upstream actually accepts. When the provider declares it
      // (e.g. DeepSeek — only web_search_*), keep only listed types; otherwise
      // keep the prior behaviour of dropping every non-function tool, which is
      // correct for OpenAI-compatible targets reached through this Claude-format
      // pass (their tools get normalized below to function-style).
      const supportedTypes = PROVIDERS[provider]?.quirks?.claudeSupportedToolTypes;
      const hasWhitelist = Array.isArray(supportedTypes);
      body.tools = body.tools
        .filter(tool => {
          const t = tool?.type;
          if (!t || t === "function") return true;
          if (hasWhitelist) return supportedTypes.includes(t);
          return false;
        })
        .map(tool => {
          if (tool.function) {
            return {
              name: tool.function.name,
              description: tool.function.description,
              input_schema: tool.function.parameters,
            };
          }
          // When the provider declared a supportedToolTypes whitelist, keep
          // the surviving tools' `type` field intact — the upstream
          // Anthropic-compatible endpoint (e.g. DeepSeek) requires it to
          // route built-ins like web_search_* correctly. Without a
          // whitelist, preserve prior behaviour and strip `type` so the
          // tool is normalized to plain Anthropic shape.
          if (hasWhitelist) return tool;
          const { type, ...rest } = tool;
          return rest;
        });
    }

    const lastCacheable = lastCacheableToolIndex(body.tools);
    body.tools = body.tools.map((tool, i) => {
      const { cache_control, ...rest } = tool;
      if (i === lastCacheable) {
        return { ...rest, cache_control: { type: "ephemeral", ttl: "1h" } };
      }
      return rest;
    });

    // Remove tools array and tool_choice if empty after filtering
    if (body.tools.length === 0) {
      delete body.tools;
      delete body.tool_choice;
    }
  }

  // Apply cloaking for OAuth tokens (billing header + fake user ID)
  // session_id in user_id must match X-Claude-Code-Session-Id for fingerprint consistency
  if ((provider === "claude" || provider?.startsWith("anthropic-compatible")) && apiKey) {
    const sid = sessionId || resolveSessionId({ headers: rawHeaders, body, connectionId, scope: "claude" });
    body = applyCloaking(body, apiKey, sid);
  }

  return body;
}
