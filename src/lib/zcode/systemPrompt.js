const MARKER = "You are ZCode, an interactive coding agent";
const CLAUDE_MARKERS = ["You are Claude Code", "Anthropic's official CLI for Claude"];

function textOf(block) {
  return typeof block?.text === "string" ? block.text : "";
}

export function injectZcodeSystemPrompt(body, model) {
  if (!body || typeof body !== "object") return body;
  const system = Array.isArray(body.system) ? body.system : [];
  if (system.some((block) => textOf(block).includes(MARKER))) return body;
  const preserved = system.filter((block) => !CLAUDE_MARKERS.some((marker) => textOf(block).includes(marker)));
  const cache = { type: "ephemeral" };
  return {
    ...body,
    system: [
      { type: "text", text: MARKER, cache_control: cache },
      {
        type: "text",
        text: `You are powered by builtin:zai-start-plan/${model}. Follow the caller's instructions and use the supplied tools accurately.`,
        cache_control: cache,
      },
      ...preserved,
    ],
  };
}

export const ZCODE_SYSTEM_IDENTITY_MARKER = MARKER;
