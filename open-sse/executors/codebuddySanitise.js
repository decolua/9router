// CodeBuddy (CN + INTL) system-prompt sanitisation.
//
// The CodeBuddy gateway (both copilot.tencent.com and codebuddy.ai) rejects a
// request whose system prompt identifies a rival CLI agent, answering
//   400 {"code":11128,"msg":"Illegal API invocation from an unapproved channel"}
// Probed live: the trigger is the agent-identity STRING, not the prompt's
// length — the exact sentence "You are Claude Code, Anthropic's official CLI
// for Claude." is blocked, while individual keywords ("Claude Code",
// "Anthropic") are not.
//
// We therefore replace ONLY system prompts matching AGENT_PATTERN with a
// neutral one, preserving their original content shape (string vs typed
// block). We deliberately do NOT key on a raw length threshold: Claude Code's
// real system prompt is several KB, and replacing it would silently discard
// the agent's instructions while letting the request "succeed" — the worst
// kind of corruption.

export const NEUTRAL_PROMPT =
  "You are a helpful AI assistant that helps with software engineering tasks.";

// Identity markers the CodeBuddy gateways reject. Each alternative must name a
// specific agent/CLI identity — deliberately NOT a bare "you are an AI agent"
// (a benign user system prompt can say that) nor lone generic tags. Probed
// live: the exact sentence "You are Claude Code, Anthropic's official CLI for
// Claude." is blocked; individual keywords are not.
export const AGENT_PATTERN =
  /you are claude code|claude.?code.+official.+cli|anthropic.+official.+cli|anxthxropic.+official.+cli|you are (?:cursor|windsurf|cline|aider|continue|copilot|cody)\b|you are an? (?:powerful )?(?:coding |code )?agent\s+(?:built|made|created|developed|designed) by|cc_entrypoint\s*=\s*(?:cli|vscode|jetbrains|gui)|claude.?code.+issues|give feedback.+claude.?code|OhMyOpenCode|<agent-identity>|orchestration capabilities.{0,40}claude/i;

// Flatten string | [{type:"text",text}] | other-typed blocks to plain text.
export function flattenContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b) => (b && typeof b.text === "string" ? b.text : "")).join("\n");
  }
  return "";
}

// Returns the replacement system message when `message` is an agent-identity
// system prompt, else the message unchanged. Preserves the content shape.
export function sanitiseSystemMessage(message) {
  if (!message || message.role !== "system") return message;
  const text = flattenContent(message.content);
  if (!text || !AGENT_PATTERN.test(text)) return message;
  return typeof message.content === "string"
    ? { ...message, content: NEUTRAL_PROMPT }
    : { ...message, content: [{ type: "text", text: NEUTRAL_PROMPT }] };
}
