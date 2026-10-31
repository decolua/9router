import { DefaultExecutor } from "./default.js";

/**
 * CodeBuddyIntlExecutor — talks to https://www.codebuddy.ai/v2/chat/completions
 *
 * Same OpenAI-compatible-but-stream-only gateway behavior as codebuddy-cn:
 * non-stream requests are rejected, and reasoning is surfaced only when the
 * request carries the IDE's OpenAI-style reasoning params. Force stream and
 * mirror reasoning_summary exactly like CodeBuddyExecutor.
 */
export class CodeBuddyIntlExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-intl");
  }

  buildHeaders(credentials, stream = true, url, model, body = null) {
    const headers = super.buildHeaders(credentials, stream, url, model, body);
    const hint = body?.session_id || body?.conversation_id || body?.prompt_cache_key || body?.metadata?.session_id;
    if (typeof hint === "string" && hint.trim()) {
      headers["X-Conversation-ID"] = hint.trim().slice(0, 128);
    }
    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    transformed.stream = true;
    if (transformed.max_completion_tokens !== undefined) {
      if (transformed.max_tokens === undefined) transformed.max_tokens = transformed.max_completion_tokens;
      delete transformed.max_completion_tokens;
    }

    const eff = transformed.reasoning_effort;
    if (eff === "none" || eff === "off") {
      delete transformed.reasoning_effort;
    } else if (eff) {
      transformed.reasoning_summary = "auto";
    }

    // CodeBuddy Intl requires a leading system prompt + user content as typed
    // blocks, while preserving legitimate caller system/developer instructions
    // and neutralizing third-party agent identity strings that trigger 11128.
    const NEUTRAL_PROMPT = "You are a helpful AI assistant that helps with software engineering tasks.";
    const AGENT_PATTERN = /you are claude code|claude.?code.+official.+cli|anthropic.+official.+cli|anxthxropic.+official.+cli|you are (?:cursor|windsurf|cline|aider|continue|copilot|cody)|you are an? (?:ai )?(?:coding |code )?agent|cc_entrypoint\s*=\s*(?:cli|vscode|jetbrains|gui)|claude.?code.+issues|give feedback.+claude.?code|you are .{0,30}(?:powerful )?ai agent|orchestration capabilities|OhMyOpenCode|you are zcode|powered by deepseek harness|codex cli is an open source project|x-anthropic-billing-header:|<agent-identity>|<Role>|<Behavior_Instructions>/i;
    const flatten = (content) =>
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((b) => (b && typeof b.text === "string" ? b.text : "")).join("\n")
          : "";

    const source = Array.isArray(transformed.messages) ? transformed.messages : [];
    const outMessages = [];
    for (const message of source) {
      if (!message || typeof message !== "object") continue;
      const role = message.role === "developer" ? "system" : message.role;
      if (role === "system") {
        const text = flatten(message.content);
        if (!text) continue;
        if (text.length > 2000 || AGENT_PATTERN.test(text)) {
          outMessages.push(
            typeof message.content === "string"
              ? { ...message, role: "system", content: NEUTRAL_PROMPT }
              : { ...message, role: "system", content: [{ type: "text", text: NEUTRAL_PROMPT }] }
          );
        } else {
          outMessages.push({ ...message, role: "system" });
        }
      } else if (role === "user" && typeof message.content === "string") {
        outMessages.push({ ...message, content: [{ type: "text", text: message.content }] });
      } else if (role === "assistant") {
        const next = { ...message };
        if (next.reasoning_content !== undefined || next.reasoning_details !== undefined) {
          const rc = typeof next.reasoning_content === "string" && next.reasoning_content
            ? next.reasoning_content
            : Array.isArray(next.reasoning_details)
              ? next.reasoning_details.map((d) => (typeof d?.text === "string" ? d.text : typeof d?.summary === "string" ? d.summary : "")).join("")
              : "";
          if (rc && !(typeof next.reasoning === "string" && next.reasoning)) next.reasoning = rc;
          delete next.reasoning_content;
          delete next.reasoning_details;
        }
        outMessages.push(next);
      } else {
        outMessages.push({ ...message });
      }
    }
    if (outMessages.length === 0 || outMessages[0].role !== "system") {
      outMessages.unshift({ role: "system", content: "You are a helpful assistant." });
    }
    transformed.messages = outMessages;

    return transformed;
  }
  parseError(response, bodyText) {
    if (bodyText) {
      try {
        const data = JSON.parse(bodyText);
        const msg = data?.msg || data?.message || data?.error?.message || "";
        if (data?.code === 6004 || /超出频率限制|frequency limit|限额/i.test(msg)) {
          let resetsAtMs = null;
          const match = msg.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\s*UTC\+?([0-9:]+))?/i);
          if (match) {
            const dp = match[1];
            const tp = match[2];
            const tz = match[3]
              ? (match[3].includes(":") ? (match[3].startsWith("+") ? match[3] : `+${match[3]}`) : `+${match[3].padStart(2, "0")}:00`)
              : "+08:00";
            const dt = new Date(`${dp}T${tp}${tz}`);
            if (!isNaN(dt.getTime())) resetsAtMs = dt.getTime();
          }
          return {
            status: 429,
            message: msg || "CodeBuddy frequency limit (6004)",
            resetsAtMs,
          };
        }
      } catch {}
    }
    return super.parseError(response, bodyText);
  }
}

export default CodeBuddyIntlExecutor;
