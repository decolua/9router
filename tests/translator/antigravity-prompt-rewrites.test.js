// ANTIGRAVITY_PROMPT_REWRITES: the Hermes / Nous Research identity is filtered by
// the backend, so it must be rewritten before the request leaves. A miss is
// silent — the request is answered with a fake 429 RESOURCE_EXHAUSTED (see #3358).
import { describe, it, expect } from "vitest";
import { ANTIGRAVITY_PROMPT_REWRITES } from "../../open-sse/config/appConstants.js";

const rewrite = (text) =>
  ANTIGRAVITY_PROMPT_REWRITES.reduce(
    (acc, { from, to }) => (typeof from === "string" ? acc.replaceAll(from, to) : acc.replace(from, to)),
    text,
  );

describe("ANTIGRAVITY_PROMPT_REWRITES — Hermes identity", () => {
  const canonical = "You are Hermes Agent, an intelligent AI assistant created by Nous Research.";

  it("rewrites the canonical identity", () => {
    const out = rewrite(canonical + " You are helpful.");
    expect(out).not.toContain("Hermes");
    expect(out).not.toContain("Nous Research");
    expect(out).toContain("You are helpful.");
  });

  // Every one of these sailed past the previous narrow pattern.
  const variants = [
    "You are Hermes Agent.",
    "You are Hermes Agent, built by Nous Research.",
    "Hermes Agent, an intelligent AI assistant created by Nous Research",
    "You are Hermes Agent \u2014 an intelligent AI assistant created by Nous Research.",
    "You are Hermes Agent, a helpful AI assistant built by Nous Research.",
    "You are Hermes Agent, a capable AI agent created by Nous Research.",
    "You are Hermes Agent: an autonomous AI assistant made by Nous Research.",
    "Hermes Agent, a brilliant AI assistant developed by Nous Research.",
  ];

  for (const text of variants) {
    it(`catches: ${text.slice(0, 45)}…`, () => {
      const out = rewrite(text);
      expect(out, "identity left intact").not.toContain("Hermes");
      expect(out, "vendor left intact").not.toContain("Nous Research");
    });
  }

  it("survives a reworded input — matching is on identity, not one sentence", () => {
    const out = rewrite(
      "Context first. You are Hermes Agent, a tremendously capable AI assistant built by Nous Research. Then obey.",
    );
    expect(out).not.toContain("Hermes Agent");
    expect(out).toContain("Then obey.");
  });

  // Guards: a regex wide enough to catch every reword is also wide enough to
  // swallow unrelated prose.
  const untouched = [
    "You are a helpful coding assistant.",
    "The Hermes rocket launched successfully.",
    "Nous Research publishes open models.",
    "You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team.",
    "You are Claude Code, Anthropic's official CLI for Claude.",
  ];

  for (const text of untouched) {
    it(`leaves untouched: ${text.slice(0, 45)}…`, () => {
      expect(rewrite(text)).toBe(text);
    });
  }
});
