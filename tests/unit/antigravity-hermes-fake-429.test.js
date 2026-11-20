import { describe, expect, it } from "vitest";

import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

// Each line below, verbatim from a Hermes Agent system prompt, made Antigravity answer
// 429 RESOURCE_EXHAUSTED while the account had quota (bisected 2026-11-18).
const TRIGGERS = [
  "<!-- End Hermes runtime environment -->",
  "# Google model operational directives",
  "If a tool, install, or network call fails and blocks the real path, say so directly and try an alternative (different package manager, different approach, ask the user). NEVER substitute plausible-looking fabricated output (made-up data, invented file contents, synthesised API responses) for results you couldn't actually produce. Reporting a blocker honestly is always better than inventing a result.",
  "When the user asks you to build, run, or verify something, the deliverable is a working artifact backed by real tool output — not a description of one. Do not stop after writing a stub, a plan, or a single command. Keep working until you have actually exercised the code or produced the requested result, then report what real execution returned.",
  "For help with Hermes Agent itself — configuring, setting up, using, extending, or troubleshooting it — or to understand your own features, tools, or capabilities, the documentation at https://hermes-agent.nousresearch.com/docs is your authoritative reference and always holds the latest, most up-to-date information.",
  "Mid-turn, the user can steer you: Hermes delivers their message as a standalone user message right after the latest tool results, wrapped exactly as:",
];
const SOUL = "You are Hermes Agent, built by Nous Research. Be direct: match the length of your reply to the weight of the ask — a one-line question gets a one-line answer.";

function systemTextSentToAntigravity(systemContent) {
  const body = openaiToAntigravityRequest("gemini-3.8-flash-high", {
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: "hi" },
    ],
  }, true);
  const finalBody = new AntigravityExecutor().transformRequest("gemini-3.8-flash-high", body, true, {});
  return finalBody.request.systemInstruction.parts.map((p) => p.text).join("\n");
}

describe("Antigravity strips Hermes lines that trigger a fake 429", () => {
  it("removes every trigger line and keeps the rest", () => {
    const text = systemTextSentToAntigravity([SOUL, "Keep this line.", ...TRIGGERS, "And this one."].join("\n"));
    for (const t of TRIGGERS) expect(text).not.toContain(t.slice(0, 40));
    expect(text).not.toContain("Be direct:");
    expect(text).not.toContain("Nous Research");
    expect(text).toContain("You are an AI assistant.");
    expect(text).toContain("Keep this line.");
    expect(text).toContain("And this one.");
  });

  it("keeps the Begin marker, which does not trigger", () => {
    const text = systemTextSentToAntigravity("<!-- Begin Hermes runtime environment -->\nCWD: /home");
    expect(text).toContain("<!-- Begin Hermes runtime environment -->");
  });

  it("still rewrites the plain Hermes identity sentence", () => {
    const text = systemTextSentToAntigravity("You are Hermes Agent, built by Nous Research.");
    expect(text).toContain("You are an AI assistant.");
  });
});
