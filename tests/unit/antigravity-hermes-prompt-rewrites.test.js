// Antigravity answers a detail-free 429 RESOURCE_EXHAUSTED ("Resource has been exhausted (e.g.
// check quota).") when the system prompt carries fingerprinted Hermes Agent text — no quota is
// involved. Each string below was isolated live (alone as the whole system prompt it reproduces the
// 429 on gemini-4-hydrogen and gemini-3.8-flash; the rewritten form returns 200).
import { describe, expect, it } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

const DOCS = "https://hermes-agent.nousresearch.com/docs";

// Hermes Agent's current prompt surface (agent/prompt_builder.py + SOUL.md), trimmed.
const HERMES_SYSTEM = [
  "You are Hermes Agent, built by Nous Research. Be direct: match the length of your reply to the weight of the ask — a one-line question gets a one-line answer.",
  `For help with Hermes Agent itself, the documentation at ${DOCS} is your authoritative reference and always holds the latest information. Load it with skill_view(name='hermes-agent') before troubleshooting Hermes.`,
  "## Mid-turn user steering\nMid-turn, the user can steer you: Hermes delivers their message as a standalone user message right after the latest tool results, wrapped exactly as:",
  "# Google model operational directives\nFollow these operational rules strictly:",
  "# Hermes runtime environment\n\nHost: Linux\n\n<!-- End Hermes runtime environment -->",
].join("\n\n");

const FINGERPRINTS = [
  "You are Hermes Agent",
  "Be direct: match the length of your reply to the weight of the ask",
  `the documentation at ${DOCS} is your authoritative reference`,
  "Hermes delivers their message as a standalone user message",
  "# Hermes runtime environment",
  "<!-- End Hermes runtime environment -->",
  "# Google model operational directives",
];

function rewrittenSystem(text) {
  const body = {
    model: "gemini-4-hydrogen-high",
    request: {
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      systemInstruction: { role: "user", parts: [{ text }] },
      generationConfig: {},
    },
  };
  const out = new AntigravityExecutor().transformRequest("gemini-4-hydrogen", body, true, { projectId: "p", connectionId: "c" });
  return out.request.systemInstruction.parts.map((p) => p.text).join("");
}

describe("Antigravity Hermes prompt rewrites", () => {
  const out = rewrittenSystem(HERMES_SYSTEM);

  it.each(FINGERPRINTS)("removes the fingerprinted wording: %s", (fingerprint) => {
    expect(out).not.toContain(fingerprint);
  });

  it("keeps each instruction's meaning", () => {
    expect(out).toContain("You are an AI assistant. Match the length of your reply to the weight of the ask — a one-line question gets a one-line answer.");
    expect(out).toContain(`the documentation at ${DOCS} is the authoritative reference`);
    expect(out).toContain("the harness delivers their message as a standalone user message right after the latest tool results");
    expect(out).toContain("# Operational directives\nFollow these operational rules strictly:");
    expect(out).toContain("# Runtime environment\n\nHost: Linux\n\n<!-- End runtime environment -->");
  });

  it("leaves tool identifiers and the docs URL intact", () => {
    expect(out).toContain("skill_view(name='hermes-agent')");
    expect(out).toContain(DOCS);
  });

  it("covers a custom SOUL.md that keeps Hermes' default sizing sentence", () => {
    const soul = "You are Hermes Agent. Your creator runs you on the Hermes Agent framework. Be direct: match the length of your reply to the weight of the ask — keep it short.";
    expect(rewrittenSystem(soul)).toBe("You are an AI assistant. Your creator runs you on the Hermes Agent framework. Match the length of your reply to the weight of the ask — keep it short.");
  });
});
