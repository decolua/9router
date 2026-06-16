import os from "node:os";

/** Substring used to detect ZCode identity blocks (idempotent injection). */
export const ZCODE_SYSTEM_IDENTITY_MARKER = "You are ZCode, an interactive coding agent";

export const ZCODE_SYSTEM_IDENTITY = ZCODE_SYSTEM_IDENTITY_MARKER;

export const ZCODE_SYSTEM_HARNESS = `You are an interactive ZCode agent that helps users with software engineering tasks.

IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.

# Harness
- Text you output outside of tool use is displayed to the user as Github-flavored markdown in a terminal.
- Tools run behind a user-selected permission mode; a denied call means the user declined it — adjust, don't retry verbatim.
- \`<system-reminder>\` tags in messages and tool results are injected by the harness, not the user. Hooks may intercept tool calls; treat hook output as user feedback.
- Prefer the dedicated file/search tools over shell commands when one fits. Independent tool calls can run in parallel in one response.
- Reference code as \`file_path:line_number\` — it's clickable.`;

export const ZCODE_SYSTEM_GUIDANCE = `Write code that reads like the surrounding code: match its comment density, naming, and idiom.

For actions that are hard to reverse or outward-facing, confirm first unless durably authorized or explicitly told to proceed without asking; approval in one context doesn't extend to the next. Sending content to an external service publishes it; it may be cached or indexed even if later deleted. Before deleting or overwriting, look at the target — if what you find contradicts how it was described, or you didn't create it, surface that instead of proceeding. Report outcomes faithfully: if tests fail, say so with the output; if a step was skipped, say that; when something is done and verified, state it plainly without hedging.

# Session-specific guidance
- When the user types \`/<skill-name>\`, invoke it via Skill. Only use skills listed in the user-invocable skills section — don't guess.

# Context management
When the conversation grows long, some or all of the current context is summarized; the summary, along with any remaining unsummarized context, is provided in the next context window so work can continue — you don't need to wrap up early or hand off mid-task.`;

const CLAUDE_CODE_SYSTEM_MARKERS = [
  "You are Claude Code",
  "Anthropic's official CLI for Claude",
];

function textFromSystemBlock(block) {
  if (!block || typeof block !== "object") return "";
  return typeof block.text === "string" ? block.text : "";
}

function isClaudeCodeSystemBlock(block) {
  const text = textFromSystemBlock(block);
  return CLAUDE_CODE_SYSTEM_MARKERS.some((marker) => text.includes(marker));
}

function hasZcodeSystemMarker(system) {
  const blocks = Array.isArray(system) ? system : [];
  return blocks.some((block) => textFromSystemBlock(block).includes(ZCODE_SYSTEM_IDENTITY_MARKER));
}

/**
 * Build the ZCode environment block (matches ZCode app shape; paths are resolved at request time).
 */
export function buildZcodeEnvironmentBlock({
  modelRef = "builtin:zai-start-plan/GLM-5.2",
  workingDirectory = process.cwd(),
  platform = process.platform,
  shell = process.env.SHELL?.split("/").pop() || "sh",
  osVersion = `${os.type()} ${os.release()} ${os.arch()}`,
  isGitRepository = false,
} = {}) {
  return `${ZCODE_SYSTEM_GUIDANCE}

# Environment
You have been invoked in the following environment:
- Primary working directory: ${workingDirectory}
- Is a git repository: ${isGitRepository ? "yes" : "no"}
- Platform: ${platform}
- Shell: ${shell}
- OS Version: ${osVersion}
- You are powered by the model named ${modelRef}.`;
}

function zcodeSystemBlocks({ modelRef, workingDirectory } = {}) {
  const cache = { type: "ephemeral" };
  return [
    { type: "text", text: ZCODE_SYSTEM_IDENTITY, cache_control: cache },
    { type: "text", text: ZCODE_SYSTEM_HARNESS, cache_control: cache },
    {
      type: "text",
      text: buildZcodeEnvironmentBlock({ modelRef, workingDirectory }),
      cache_control: cache,
    },
  ];
}

/**
 * Replace Claude Code default system prompt with ZCode blocks for Coding Plan upstream.
 * Preserves caller-provided system text (non-Claude-Code blocks).
 */
export function injectZcodeSystemPrompt(body, options = {}) {
  if (!body || typeof body !== "object") return body;

  const next = { ...body };
  const existing = Array.isArray(next.system) ? [...next.system] : [];

  if (hasZcodeSystemMarker(existing)) {
    return next;
  }

  const preserved = existing.filter((block) => !isClaudeCodeSystemBlock(block));
  const modelName =
    typeof next.model === "string" && next.model.length > 0 ? next.model : "GLM-5.2";
  const modelRef = options.modelRef || `builtin:zai-start-plan/${modelName}`;

  next.system = [
    ...zcodeSystemBlocks({
      modelRef,
      workingDirectory: options.workingDirectory,
    }),
    ...preserved,
  ];

  return next;
}