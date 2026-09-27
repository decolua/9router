import { describe, it, expect } from "vitest";
import { buildSkillsPrompt, injectAgentSkills } from "../../open-sse/skills/agentSkills.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { parseFrontmatter, estimateTokens, MAX_SKILL_BYTES } from "../../src/lib/skills/fetchSkill.js";

// Shaped like the real thing: ayghri/i-have-adhd opens exactly this way.
const REAL_SKILL_MD = `---
name: i-have-adhd
description: 'Shape output for a reader with ADHD: lead with the next action.'
disable-model-invocation: true
license: MIT
metadata:
  tags: "ADHD, Output Style"
  category: "productivity"
---

# i-have-adhd

The reader has ADHD. Output is shaped so an ADHD brain can act on it.
`;

describe("SKILL.md frontmatter", () => {
  it("reads the fields the dashboard shows", () => {
    const { meta } = parseFrontmatter(REAL_SKILL_MD);

    expect(meta.name).toBe("i-have-adhd");
    expect(meta.license).toBe("MIT");
    expect(meta.description).toBe("Shape output for a reader with ADHD: lead with the next action.");
  });

  // Frontmatter is runtime metadata, not instruction text — injecting it would
  // spend tokens on fields the provider cannot act on.
  it("strips the frontmatter from the body", () => {
    const { body } = parseFrontmatter(REAL_SKILL_MD);

    expect(body).toContain("The reader has ADHD");
    expect(body).not.toContain("disable-model-invocation");
    expect(body).not.toContain("license: MIT");
  });

  it("ignores nested keys rather than mangling them", () => {
    const { meta } = parseFrontmatter(REAL_SKILL_MD);

    expect(meta.tags).toBeUndefined();
    expect(meta.metadata).toBeUndefined();
  });

  it("passes a document with no frontmatter through untouched", () => {
    const plain = "# Just markdown\n\nNo frontmatter here.";

    expect(parseFrontmatter(plain)).toEqual({ meta: {}, body: plain });
  });

  it("handles CRLF, since GitHub serves some files that way", () => {
    const { meta, body } = parseFrontmatter("---\r\nname: x\r\n---\r\nBody text");

    expect(meta.name).toBe("x");
    expect(body).toBe("Body text");
  });

  it("caps skills at a size that would otherwise ride on every request", () => {
    expect(MAX_SKILL_BYTES).toBeLessThanOrEqual(512 * 1024);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("buildSkillsPrompt", () => {
  it("joins enabled skills with a separator", () => {
    const prompt = buildSkillsPrompt([{ body: "First rule." }, { body: "Second rule." }]);

    expect(prompt).toContain("First rule.");
    expect(prompt).toContain("Second rule.");
    expect(prompt.indexOf("First")).toBeLessThan(prompt.indexOf("Second"));
  });

  it("returns nothing for an empty or absent list", () => {
    expect(buildSkillsPrompt([])).toBe("");
    expect(buildSkillsPrompt(undefined)).toBe("");
    expect(buildSkillsPrompt(null)).toBe("");
  });

  it("skips a skill whose body is blank rather than emitting separators", () => {
    expect(buildSkillsPrompt([{ body: "   " }, { body: "" }])).toBe("");
    expect(buildSkillsPrompt([{ body: "kept" }, { body: "  " }])).toBe("kept");
  });
});

// The point of the feature: the text has to survive into whatever wire format
// the chosen provider speaks, not just OpenAI's.
describe("injectAgentSkills across wire formats", () => {
  const skills = [{ name: "i-have-adhd", body: "Lead with the next action." }];

  it("reaches an OpenAI chat body", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const names = injectAgentSkills(body, FORMATS.OPENAI, skills);

    expect(names).toEqual(["i-have-adhd"]);
    expect(JSON.stringify(body)).toContain("Lead with the next action.");
  });

  it("reaches a Claude body's system field, not its messages", () => {
    const body = { system: "Existing.", messages: [{ role: "user", content: "hi" }] };
    injectAgentSkills(body, FORMATS.CLAUDE, skills);

    expect(JSON.stringify(body.system)).toContain("Lead with the next action.");
    // Anthropic rejects a "system" role inside messages[].
    expect(body.messages.some((m) => m.role === "system")).toBe(false);
  });

  it("reaches a Gemini body", () => {
    const body = { contents: [{ role: "user", parts: [{ text: "hi" }] }] };
    injectAgentSkills(body, FORMATS.GEMINI, skills);

    expect(JSON.stringify(body)).toContain("Lead with the next action.");
  });

  it("reaches a Responses body with instructions", () => {
    const body = { instructions: "Be brief.", input: [] };
    injectAgentSkills(body, FORMATS.OPENAI_RESPONSES, skills);

    expect(body.instructions).toContain("Lead with the next action.");
    expect(body.instructions).toContain("Be brief.");
  });

  it("reaches a Kiro conversationState body", () => {
    const body = { conversationState: { currentMessage: { userInputMessage: { content: "hi" } }, history: [] } };
    injectAgentSkills(body, FORMATS.KIRO, skills);

    expect(JSON.stringify(body)).toContain("Lead with the next action.");
  });

  it("keeps the existing system prompt instead of replacing it", () => {
    const body = { messages: [{ role: "system", content: "You are terse." }, { role: "user", content: "hi" }] };
    injectAgentSkills(body, FORMATS.OPENAI, skills);

    const serialized = JSON.stringify(body);
    expect(serialized).toContain("You are terse.");
    expect(serialized).toContain("Lead with the next action.");
  });

  it("injects several skills in order", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const names = injectAgentSkills(body, FORMATS.OPENAI, [
      { name: "a", body: "Rule A." },
      { name: "b", body: "Rule B." },
    ]);

    expect(names).toEqual(["a", "b"]);
    const serialized = JSON.stringify(body);
    expect(serialized.indexOf("Rule A.")).toBeLessThan(serialized.indexOf("Rule B."));
  });
});

describe("injectAgentSkills when there is nothing to do", () => {
  it("leaves the body untouched with no skills", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const before = JSON.stringify(body);

    expect(injectAgentSkills(body, FORMATS.OPENAI, [])).toEqual([]);
    expect(JSON.stringify(body)).toBe(before);
  });

  it("leaves the body untouched when skills are undefined", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const before = JSON.stringify(body);

    expect(injectAgentSkills(body, FORMATS.OPENAI, undefined)).toEqual([]);
    expect(JSON.stringify(body)).toBe(before);
  });

  // A malformed skill must never be the reason a completion fails.
  it("does not throw on a skill with no body", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };

    expect(() => injectAgentSkills(body, FORMATS.OPENAI, [{ name: "broken" }])).not.toThrow();
  });
});
