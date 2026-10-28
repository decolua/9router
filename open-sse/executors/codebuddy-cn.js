import { DefaultExecutor } from "./default.js";
import { refreshCodeBuddyToken } from "../services/tokenRefresh.js";

const CODEBUDDY_SYSTEM_PROMPT = "You are CodeBuddy Code.";

const CHANNEL_MARKERS = [
  "You are Claude Code, Anthropic's official CLI for Claude.",
  "x-anthropic-billing-header",
  "Main branch (you will usually use this for PRs):",
];

const CHANNEL_MARKER_REGEX =
  /you are claude code|claude.?code.+official.+cli|anthropic.+official.+cli|anxthxropic.+official.+cli|you are (?:cursor|windsurf|cline|aider|continue|copilot|cody)|cc_entrypoint\s*=\s*(?:cli|vscode|jetbrains|gui)|claude.?code.+issues|give feedback.+claude.?code|OhMyOpenCode/gi;

function sanitizeChannelMarkers(text) {
  if (typeof text !== "string" || !text) return text;
  let result = text;
  for (const marker of CHANNEL_MARKERS) {
    if (result.includes(marker)) {
      result = result.split(marker).join("[external-client-identity]");
    }
  }
  return result.replace(CHANNEL_MARKER_REGEX, "[external-client-identity]");
}

/**
 * Tencent CodeBuddy Executor (codebuddy-cn / codebuddy-intl)
 * Uses OpenAI-compatible chat completions API with CodeBuddy CLI channel headers.
 */
export class CodeBuddyExecutor extends DefaultExecutor {
  constructor(provider = "codebuddy-cn") {
    super(provider);
  }

  buildHeaders(credentials, stream = true, body, requestHeaders, clientTool = null) {
    const headers = super.buildHeaders(credentials, true, body, requestHeaders, clientTool);
    const reqId = crypto.randomUUID().replace(/-/g, "");
    const convId = crypto.randomUUID();
    const convReqId = crypto.randomUUID().replace(/-/g, "");
    const domain =
      credentials?.providerSpecificData?.domain ||
      (this.provider === "codebuddy-cn" ? "copilot.tencent.com" : "www.codebuddy.ai");

    delete headers["x-requested-with"];
    delete headers["x-codebuddy-request"];

    Object.assign(headers, {
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": "CLI/2.108.1 CodeBuddy/2.108.1",
      "X-Product": "SaaS",
      "X-App": "cli",
      "X-IDE-Type": "CLI",
      "X-IDE-Name": "CLI",
      "X-IDE-Version": "2.108.1",
      "X-Private-Data": "false",
      "X-Requested-With": "XMLHttpRequest",
      "X-CodeBuddy-Request": "1",
      "X-Domain": domain,
      "X-Stainless-Runtime": "node",
      "X-Stainless-Runtime-Version": process.version || "v24.11.1",
      "X-Stainless-Lang": "js",
      "X-Stainless-Arch": "x64",
      "X-Stainless-Os": "Windows",
      "X-Stainless-Package-Version": "6.25.0",
      "X-Stainless-Helper-Method": "stream",
      "X-Stainless-Retry-Count": "0",
      "X-Request-ID": reqId,
      "X-Conversation-ID": convId,
      "X-Conversation-Request-ID": convReqId,
      "X-Conversation-Message-ID": reqId,
      "X-Agent-Intent": "craft",
      "X-Agent-Purpose": "conversation",
    });

    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    const nextBody = super.transformRequest(model, body, stream, credentials);
    nextBody.stream = true;
    const effort = nextBody.reasoning_effort;
    if (effort === "none" || effort === "off") {
      delete nextBody.reasoning_effort;
    } else if (effort) {
      nextBody.reasoning_summary = "auto";
    }

    const inputMessages = Array.isArray(nextBody.messages) ? nextBody.messages : [];
    const systemParts = [CODEBUDDY_SYSTEM_PROMPT];
    const otherMessages = [];

    for (const m of inputMessages) {
      if (!m || typeof m !== "object") continue;
      if (m.role === "system" || m.role === "developer") {
        const rawText =
          typeof m.content === "string"
            ? m.content
            : Array.isArray(m.content)
              ? m.content
                  .map((b) => (typeof b === "string" ? b : b && typeof b.text === "string" ? b.text : ""))
                  .join("\n")
              : "";
        const cleaned = sanitizeChannelMarkers(rawText).trim();
        if (cleaned && cleaned !== CODEBUDDY_SYSTEM_PROMPT) {
          systemParts.push(cleaned);
        }
        continue;
      }
      if (m.role === "user" && typeof m.content === "string") {
        otherMessages.push({ ...m, content: [{ type: "text", text: m.content }] });
        continue;
      }
      if (m.role === "assistant") {
        const nextMsg = { ...m };
        if (typeof nextMsg.content === "string") {
          nextMsg.content = sanitizeChannelMarkers(nextMsg.content);
        } else if (Array.isArray(nextMsg.content)) {
          nextMsg.content = nextMsg.content.map((b) =>
            b && typeof b === "object" && typeof b.text === "string"
              ? { ...b, text: sanitizeChannelMarkers(b.text) }
              : b
          );
        }
        otherMessages.push(nextMsg);
        continue;
      }
      otherMessages.push({ ...m });
    }

    nextBody.messages = [{ role: "system", content: systemParts.join("\n\n") }, ...otherMessages];
    return nextBody;
  }

  parseError(response, bodyText) {
    if (bodyText) {
      try {
        const parsed = JSON.parse(bodyText);
        const msg = parsed?.msg || parsed?.message || parsed?.error?.message || "";
        // CodeBuddy 特有错误码 6004: 模型超出频率限制 (通常在 HTTP 200 SSE 或 400 中返回)
        if (parsed?.code === 6004 || /超出频率限制|frequency limit|限额/i.test(msg)) {
          let resetsAtMs = null;
          // 匹配形如 2026-09-28 14:30:00 的恢复时间
          const match = msg.match(
            /(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\s*UTC\+?([0-9:]+))?/i
          );
          if (match) {
            const dateStr = match[1];
            const timeStr = match[2];
            const tzOffset = match[3]
              ? match[3].includes(":")
                ? match[3].startsWith("+")
                  ? match[3]
                  : `+${match[3]}`
                : `+${match[3].padStart(2, "0")}:00`
              : "+08:00"; // 默认北京时间
            const parsedDate = new Date(`${dateStr}T${timeStr}${tzOffset}`);
            if (!isNaN(parsedDate.getTime())) {
              resetsAtMs = parsedDate.getTime();
            }
          }
          return {
            status: 429,
            message: msg || "CodeBuddy frequency limit (6004)",
            resetsAtMs,
          };
        }
      } catch {
        // Not JSON, fall through
      }
    }
    return super.parseError(response, bodyText);
  }

  async refreshCredentials(credentials, log) {
    if (!credentials?.refreshToken) return null;
    return refreshCodeBuddyToken(this.provider, credentials.refreshToken, log);
  }
}

export default CodeBuddyExecutor;
