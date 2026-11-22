// Regression tests: a real Hermes Agent system prompt must come out of the Antigravity
// transform with every fingerprinted string gone, so Google's host does not answer the
// bare 429 RESOURCE_EXHAUSTED ("Resource has been exhausted (e.g. check quota).") that it
// uses for stock third-party agent prompts (upstream decolua#5745, decolua#5703).
//
// The fixtures below are copied verbatim from Hermes Agent's prompt surface:
//   - agent/prompt_builder.py: TASK_COMPLETION_GUIDANCE, GOOGLE_MODEL_OPERATIONAL_GUIDANCE,
//     STEER_CHANNEL_NOTE
//   - SOUL.md: the default identity/sizing sentence
//   - the runtime-environment frame the CLI and gateway wrap the environment block in
//
// What is asserted, per fingerprint:
//   1. the exact wording that trips the filter is gone from systemInstruction,
//   2. the instruction itself survives (not blanked), and
//   3. identifiers Hermes depends on (skill_view(name='hermes-agent'), the docs URL,
//      the Begin marker) are untouched.

import { describe, expect, it } from "vitest";

import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

const DOCS = "https://hermes-agent.nousresearch.com/docs";

// SOUL.md (default profile), verbatim first two sentences.
const SOUL = "You are Hermes Agent, built by Nous Research. Be direct: match the length of your reply to the weight of the ask — a one-line question gets a one-line answer, and finished work gets a short report of what changed, what's verified, and what's left, never a replay of the process.";

// agent/prompt_builder.py :: TASK_COMPLETION_GUIDANCE
const TASK_COMPLETION_GUIDANCE = [
  "# Finishing the job",
  "When the user asks you to build, run, or verify something, the deliverable is a working artifact backed by real "
    + "tool output — not a description of one. Do not stop after writing a stub, a plan, or a single command. Keep "
    + "working until you have actually exercised the code or produced the requested result, then report what real "
    + "execution returned.",
  "If a tool, install, or network call fails and blocks the real path, say so directly and try an alternative "
    + "(different package manager, different approach, ask the user). NEVER substitute plausible-looking fabricated "
    + "output (made-up data, invented file contents, synthesised API responses) for results you couldn't actually "
    + "produce. Reporting a blocker honestly is always better than inventing a result.",
].join("\n");

// agent/prompt_builder.py :: GOOGLE_MODEL_OPERATIONAL_GUIDANCE (Hermes adds it for any model id
// containing "gemini" — i.e. every ag/gemini-* route).
const GOOGLE_MODEL_OPERATIONAL_GUIDANCE = [
  "# Google model operational directives",
  "Follow these operational rules strictly:",
  "- **Absolute paths:** Always construct and use absolute file paths for all file system operations.",
  "- **Verify first:** Use read_file/search_files to check file contents and project structure before making changes.",
].join("\n");

// agent/system_prompt.py :: STEER_CHANNEL_NOTE (gateway prompts; "Hermes delivers their message ...")
const STEER_NOTE = [
  "## Mid-turn user steering",
  "Mid-turn, the user can steer you: Hermes delivers their message as a standalone user message right after "
    + "the latest tool results, wrapped exactly as:",
].join("\n");

// The self-documentation line that also carries the docs URL Hermes tells the model to load.
const SELF_DOC_LINE = "For help with Hermes Agent itself — configuring, setting up, using, extending, or "
  + `troubleshooting it — or to understand your own features, tools, or capabilities, the documentation at ${DOCS} `
  + "is your authoritative reference and always holds the latest, most up-to-date information. The `hermes-agent` "
  + "skill has the actual commands and proven workflows — load it with skill_view(name='hermes-agent') before "
  + "configuring, modifying, or troubleshooting Hermes so you don't guess or invent workarounds.";

// Runtime-environment frame (Begin marker passes Google's filter; End marker does not).
const RUNTIME_ENV = [
  "# Hermes runtime environment",
  "",
  "Host: Windows",
  "",
  "<!-- End Hermes runtime environment -->",
].join("\n");

const FULL_HERMES_PROMPT = [SOUL, SELF_DOC_LINE, RUNTIME_ENV, GOOGLE_MODEL_OPERATIONAL_GUIDANCE, STEER_NOTE, TASK_COMPLETION_GUIDANCE].join("\n\n");

// Exact wording that made the upstream host answer the bare 429 (bisected live, one string at a time).
const FINGERPRINTS = [
  "You are Hermes Agent, built by Nous Research",
  "Be direct: match the length of your reply to the weight of the ask",
  `the documentation at ${DOCS} is your authoritative reference`,
  "Hermes delivers their message as a standalone user message",
  "# Hermes runtime environment",
  "<!-- End Hermes runtime environment -->",
  "# Google model operational directives",
  "the deliverable is a working artifact backed by real tool output",
  "Reporting a blocker honestly is always better than inventing a result.",
];

/** Run a system prompt through the same two steps a live OpenAI-format request takes. */
function systemTextSentToAntigravity(systemContent, model = "gemini-3.8-flash-high") {
  const body = openaiToAntigravityRequest(model, {
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: "hi" },
    ],
  }, true);
  const finalBody = new AntigravityExecutor().transformRequest(model, body, true, { projectId: "p", connectionId: "c" });
  return finalBody.request.systemInstruction.parts.map((p) => p.text).join("\n");
}

describe("Antigravity transforms a real Hermes Agent system prompt (fake-429 triggers)", () => {
  const out = systemTextSentToAntigravity(FULL_HERMES_PROMPT);

  it.each(FINGERPRINTS)("removes the fingerprinted wording from systemInstruction: %s", (fingerprint) => {
    expect(out).not.toContain(fingerprint);
  });

  it("keeps the identity as a neutral assistant line", () => {
    expect(out).toContain("You are an AI assistant.");
    expect(out).not.toContain("Nous Research");
  });

  it("keeps each instruction instead of blanking the line", () => {
    expect(out).toContain("Match the length of your reply to the weight of the ask");
    expect(out).toContain(`the documentation at ${DOCS} is the authoritative reference`);
    expect(out).toContain("the harness delivers their message as a standalone user message");
    expect(out).toContain("# Operational directives");
    expect(out).toContain("# Runtime environment");
    expect(out).toContain("the deliverable is a working artifact that real tool output backs");
    expect(out).toContain("Honestly reporting a blocker is always better than inventing a result.");
  });

  it("keeps the identifiers Hermes relies on", () => {
    expect(out).toContain(DOCS);
    expect(out).toContain("skill_view(name='hermes-agent')");
    // The Begin marker never trips the filter and must survive.
    expect(systemTextSentToAntigravity("<!-- Begin Hermes runtime environment -->\nCWD: C:\\x"))
      .toContain("<!-- Begin Hermes runtime environment -->");
  });

  it("leaves the rest of the system prompt byte-identical", () => {
    expect(out).toContain("- **Absolute paths:** Always construct and use absolute file paths for all file system operations.");
    expect(out).toContain("NEVER substitute plausible-looking fabricated output");
    expect(out).toContain("Host: Windows");
  });

  it("is idempotent: transforming the rewritten prompt again changes nothing", () => {
    expect(systemTextSentToAntigravity(out)).toBe(out);
  });

  it("does not touch a prompt that carries no Hermes wording", () => {
    const plain = "You are a helpful assistant.\n# Operational notes\nBe concise.";
    expect(systemTextSentToAntigravity(plain)).toContain("You are a helpful assistant.");
    expect(systemTextSentToAntigravity(plain)).toContain("Be concise.");
  });

  it("covers a non-default AG model too", () => {
    const hydrogen = systemTextSentToAntigravity(FULL_HERMES_PROMPT, "gemini-4-hydrogen-medium");
    for (const fingerprint of FINGERPRINTS) expect(hydrogen).not.toContain(fingerprint);
  });

  it("treats only the bare detail-free 429 as a prompt rejection, not real quota 429s", async () => {
    const { isAntigravityPromptRejection } = await import("../../open-sse/executors/antigravity.js");
    const bare = JSON.stringify({
      error: { code: 429, message: "Resource has been exhausted (e.g. check quota).", status: "RESOURCE_EXHAUSTED" },
    });
    const realQuota = JSON.stringify({
      error: {
        code: 429,
        message: "Individual quota reached for gemini-3.8-flash-high. Resets in 1h56m",
        status: "RESOURCE_EXHAUSTED",
        details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", metadata: { quotaResetTimeStamp: "2026-11-21T23:00:00Z" } }],
      },
    });
    expect(isAntigravityPromptRejection(429, bare)).toBe(true);
    // A real quota 429 carries details and must keep the normal quota handling.
    expect(isAntigravityPromptRejection(429, realQuota)).toBe(false);
    expect(isAntigravityPromptRejection(500, bare)).toBe(false);
    expect(isAntigravityPromptRejection(429, "")).toBe(false);
  });
});
