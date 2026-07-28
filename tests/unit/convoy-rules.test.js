import { describe, expect, it } from "vitest";
import { applyConvoyRules } from "@/lib/convoy/rulesEngine.js";

const baseRule = {
  id: "rule-1",
  name: "Claude to CodeBuddy",
  enabled: true,
  priority: 1,
  matchType: "literal",
  action: "replace",
  pattern: "Claude Code",
  replacement: "CodeBuddy",
  caseSensitive: true,
  providerIds: [],
};

describe("Input Guard rules", () => {
  it("applies a global rule to every provider", () => {
    const result = applyConvoyRules({ messages: [{ content: "Claude Code" }] }, [baseRule], "codex");
    expect(result.body.messages[0].content).toBe("CodeBuddy");
    expect(result.hits).toHaveLength(1);
  });

  it("only applies scoped rules to selected providers", () => {
    const rule = { ...baseRule, providerIds: ["codebuddy-cn"] };
    expect(applyConvoyRules({ text: "Claude Code" }, [rule], "codebuddy-cn").body.text).toBe("CodeBuddy");
    expect(applyConvoyRules({ text: "Claude Code" }, [rule], "codex").body.text).toBe("Claude Code");
  });

  it("supports case-insensitive regex replacement and counts every match", () => {
    const rule = {
      ...baseRule,
      matchType: "regex",
      pattern: "claude\\s+code",
      replacement: "CodeBuddy",
      caseSensitive: false,
    };
    const result = applyConvoyRules({ text: "Claude Code and CLAUDE CODE" }, [rule], "codex");
    expect(result.body.text).toBe("CodeBuddy and CodeBuddy");
    expect(result.hits[0].count).toBe(2);
  });

  it("deletes matches and leaves the original request unchanged", () => {
    const request = { messages: [{ content: "remove secret remove" }] };
    const rule = { ...baseRule, action: "delete", pattern: "remove", replacement: "ignored" };
    const result = applyConvoyRules(request, [rule], "codex");
    expect(result.body.messages[0].content).toBe(" secret ");
    expect(result.hits[0].count).toBe(2);
    expect(request.messages[0].content).toBe("remove secret remove");
  });

  it("treats dollar signs in literal replacements as plain text", () => {
    const rule = { ...baseRule, replacement: "$&-$1-$$" };
    const result = applyConvoyRules({ text: "Claude Code" }, [rule], "codex");
    expect(result.body.text).toBe("$&-$1-$$");
  });

  it("skips an invalid regex without blocking valid rules", () => {
    const invalid = { ...baseRule, id: "bad", matchType: "regex", pattern: "[" };
    const valid = { ...baseRule, id: "good", priority: 2 };
    const result = applyConvoyRules({ text: "Claude Code" }, [invalid, valid], "codex");
    expect(result.body.text).toBe("CodeBuddy");
    expect(result.hits.map((hit) => hit.ruleId)).toEqual(["good"]);
  });
});
