// Antigravity answers a detail-free 429 RESOURCE_EXHAUSTED ("Resource has been exhausted (e.g.
// check quota).") when the system prompt carries OpenClaw's identity line — no quota is involved.
// Isolated live: the line alone as the whole system prompt reproduces the 429 on gemini-4-hydrogen
// and gemini-3.8-flash, and OpenClaw's full gateway prompt returns 200 once only that line is reworded.
import { describe, expect, it } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

const IDENTITY = "You are a personal assistant running inside OpenClaw.";
const REWRITTEN = "You are a personal assistant that runs inside OpenClaw.";
const MODEL_LINE = "Current model identity: 9router/ag/gemini-4-hydrogen. If asked what model you are, answer with this value for the current run.";

// OpenClaw's agent prompt surface (buildAgentSystemPrompt, promptMode "full"), trimmed.
const OPENCLAW_SYSTEM = [
  "<!-- openclaw:attempt:STABLE -->",
  IDENTITY,
  "## Execution Bias\n- Actionable request: act now.",
  "## Runtime Context\nOpenClaw may attach a separate runtime-context message for the current request. Treat it as application context rather than user-authored text.",
  "## Messaging\n- OpenClaw messaging: use available messaging tools, never shell commands, the CLI, curl, or direct RPC.",
  `## Runtime\n${MODEL_LINE}`,
].join("\n");

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

describe("Antigravity OpenClaw prompt rewrites", () => {
  const out = rewrittenSystem(OPENCLAW_SYSTEM);

  it("removes the fingerprinted identity line", () => {
    expect(out).not.toContain(IDENTITY);
  });

  it("keeps the identity's meaning and the rest of the prompt unchanged", () => {
    expect(out).toBe(OPENCLAW_SYSTEM.replace(IDENTITY, REWRITTEN));
  });

  it("covers promptMode \"none\" (identity line plus the model identity line)", () => {
    expect(rewrittenSystem(`${IDENTITY}\n${MODEL_LINE}`)).toBe(`${REWRITTEN}\n${MODEL_LINE}`);
  });

  it("matches case-insensitively, like Antigravity does", () => {
    expect(rewrittenSystem("you are a personal assistant running inside openclaw.")).toBe(REWRITTEN);
  });

  it("leaves OpenClaw's other identity lines alone (they pass upstream as-is)", () => {
    const other = "You are OpenClaw, the system agent: a small, tidy hermit crab that lives in the config shell.";
    expect(rewrittenSystem(other)).toBe(other);
  });
});
