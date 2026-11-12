import { describe, expect, it } from "vitest";
import { classifyTaskComplexity, inspectRequest } from "@/sse/services/autoRouterClassifier.js";
import {
  AutoRouterConfigurationError,
  effectiveTargets,
  selectAutoRoute,
  selectLocalRank,
} from "@/sse/services/autoRouterSelection.js";

const chat = (content) => ({ messages: [{ role: "user", content }] });

function targetFor(body, models = ["lite", "standard", "high"]) {
  return selectAutoRoute({ body, comboName: "coder-auto", models }).target;
}

describe("Auto Router classifier", () => {
  it("keeps simple requests low and routes moderate and complex work upward", () => {
    expect(targetFor(chat("hello"))).toBe("lite");
    expect(targetFor(chat("Please review this change."))).toBe("standard");
    expect(targetFor(chat("Fully audit this repository for race conditions and trace the root cause across multiple files."))).toBe("high");
  });

  it("escalates structural context and actual tool activity", () => {
    const mediumContext = chat("x".repeat(9000));
    const largeContext = chat("x".repeat(25000));
    const longHistory = { messages: Array.from({ length: 16 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: "turn" })) };
    const toolHistory = {
      messages: [
        { role: "user", content: "debug this" },
        { role: "assistant", tool_calls: [{}, {}, {}], content: "" },
        { role: "tool", content: "result".repeat(3000) },
      ],
    };

    expect(classifyTaskComplexity(mediumContext).reasons).toContain("medium-context");
    expect(classifyTaskComplexity(largeContext).reasons).toContain("large-context");
    expect(classifyTaskComplexity(longHistory).reasons).toContain("long-history");
    expect(classifyTaskComplexity(toolHistory).reasons).toEqual(expect.arrayContaining(["repeated-tool-history", "large-tool-result-history"]));
  });

  it("ignores system envelopes, tool schemas, and assistant prose for semantic escalation", () => {
    const hugeSystem = {
      messages: [{ role: "system", content: "audit architecture race condition ".repeat(3000) }, { role: "user", content: "hello" }],
      tools: [{ type: "function", function: { name: "audit", description: "race condition ".repeat(10000), parameters: { type: "object" } } }],
    };
    const assistantTerms = { messages: [{ role: "assistant", content: "fully audit the architecture for a race condition" }, { role: "user", content: "hello" }] };

    expect(classifyTaskComplexity(hugeSystem).escalationScore).toBe(0);
    expect(classifyTaskComplexity(assistantTerms).escalationScore).toBe(0);
  });

  it("resists quoted labels and identifier false positives", () => {
    expect(classifyTaskComplexity(chat('Rename the "Authentication" menu item')).escalationScore).toBe(0);
    expect(classifyTaskComplexity(chat('Add a "Race Condition" menu item')).escalationScore).toBe(0);
    expect(classifyTaskComplexity(chat('Rename the "Root Cause" heading')).escalationScore).toBe(0);
    expect(classifyTaskComplexity(chat("Please add a debug log")).escalationScore).toBe(0);
    expect(classifyTaskComplexity(chat("update migration-plan.json and authenticationService")).escalationScore).toBe(0);
  });

  it("escalates intrinsic debugging and concurrency signals regardless of leading action", () => {
    for (const prompt of [
      "Fix this race condition",
      "Resolve the root cause",
      "Find the root cause of this failure",
      "There is a race condition in this code",
      "Fix the intermittent failing tests",
      "Could you help me debug this test?",
    ]) {
      expect(classifyTaskComplexity(chat(prompt)).escalationScore).toBeGreaterThanOrEqual(6);
    }
  });

  it("uses task actions to gate domain terms without treating every task as complex", () => {
    expect(classifyTaskComplexity(chat("Rename the audit architecture menu item")).escalationScore).toBe(0);
    expect(classifyTaskComplexity(chat("Please investigate the architecture and authentication flow")).reasons)
      .toEqual(expect.arrayContaining(["complex-action", "architecture", "security"]));

    for (const prompt of ["Plan a database migration", "Implement the authentication architecture", "Plan the rollback migration"]) {
      const result = classifyTaskComplexity(chat(prompt));
      expect(result.reasons).toEqual(expect.arrayContaining(["architecture"]));
      expect(result.escalationScore).toBeGreaterThanOrEqual(6);
    }
    expect(classifyTaskComplexity(chat("Plan a database migration")).reasons).not.toContain("complex-action");
  });

  it("keeps all requests without recoverable user context conservative", () => {
    const onlySystem = { messages: [{ role: "system", content: "follow these instructions" }] };
    const assistantOnly = { messages: [{ role: "assistant", content: "I need more information" }] };
    const twoToolEvents = { messages: [{ role: "assistant", tool_calls: [{}, {}], content: "" }] };
    const threeToolEvents = { messages: [{ role: "assistant", tool_calls: [{}, {}, {}], content: "" }] };
    const mediumToolResult = { messages: [{ role: "tool", content: "result".repeat(3000) }] };
    const multiModal = { messages: [{ role: "assistant", content: [{ type: "input_image" }, { type: "input_file" }] }] };

    for (const body of [onlySystem, assistantOnly, twoToolEvents, threeToolEvents, mediumToolResult, multiModal]) {
      const result = classifyTaskComplexity(body);
      expect(result.reasons).toEqual(["contextless-request"]);
      expect(targetFor(body)).toBe("high");
    }
    expect(classifyTaskComplexity({ tools: [{ type: "function", function: { name: "read_file" } }] }).reasons).toEqual(["empty-request"]);
  });

  it("supports equivalent supported request shapes without double counting", () => {
    const messages = [{ role: "user", content: "Fully audit this repository" }];
    expect(classifyTaskComplexity({ messages, input: messages, contents: messages }).escalationScore).toBe(classifyTaskComplexity({ messages }).escalationScore);
    expect(targetFor({ input: "Fully audit this repository" })).toBe("standard");
    expect(targetFor({ contents: [{ role: "user", parts: [{ text: "Fully audit this repository" }] }] })).toBe("standard");
  });

  it("fails conservatively for malformed and empty requests", () => {
    expect(classifyTaskComplexity(null).reasons).toEqual(["invalid-request"]);
    expect(classifyTaskComplexity([]).reasons).toEqual(["invalid-request"]);
    expect(classifyTaskComplexity({}).reasons).toEqual(["empty-request"]);
    expect(targetFor({}, ["lite", "standard", "high"])).toBe("high");
  });

  it("tolerates cyclic supported content", () => {
    const content = { text: "hello" };
    content.content = [content];
    expect(() => inspectRequest({ messages: [{ role: "user", content }] })).not.toThrow();
  });
});

describe("Auto Router ordered target selection", () => {
  it("supports every configured rank without a tier ceiling", () => {
    expect(selectLocalRank({ escalationScore: 0, candidateCount: 1 })).toBe(0);
    expect(selectLocalRank({ escalationScore: 5, candidateCount: 2 })).toBe(0);
    expect(selectLocalRank({ escalationScore: 6, candidateCount: 2 })).toBe(1);
    expect(selectLocalRank({ escalationScore: 0, candidateCount: 4 })).toBe(0);
    expect(selectLocalRank({ escalationScore: 6, candidateCount: 4 })).toBe(1);
    expect(selectLocalRank({ escalationScore: 12, candidateCount: 4 })).toBe(2);
    expect(selectLocalRank({ escalationScore: 18, candidateCount: 4 })).toBe(3);
    expect(selectLocalRank({ escalationScore: 10_000, candidateCount: 8 })).toBe(7);
  });

  it("uses uncapped escalation scores instead of public diagnostic scores", () => {
    const route = selectAutoRoute({
      body: chat("Fully audit this repository for race conditions and trace the root cause across multiple files."),
      comboName: "coder-auto",
      models: ["one", "two", "three", "four", "five"],
      classifier: () => ({ score: 7, escalationScore: 24, reasons: ["audit"] }),
    });
    expect(route.target).toBe("five");
  });

  it("rejects invalid, duplicate, self-referential, and chained targets", () => {
    expect(() => effectiveTargets([])).toThrow(AutoRouterConfigurationError);
    expect(() => effectiveTargets(["one", "one"])).toThrow(AutoRouterConfigurationError);
    expect(() => selectAutoRoute({ body: chat("hello"), comboName: "auto", models: ["auto"] })).toThrow(/own combo/);
    expect(() => selectAutoRoute({
      body: chat("hello"),
      comboName: "auto",
      models: ["another-auto"],
      comboStrategies: { "another-auto": { fallbackStrategy: "auto" } },
    })).toThrow(/chaining is not supported/);
  });

  it("fails toward the strongest target for non-finite classifier scores", () => {
    expect(selectLocalRank({ escalationScore: Number.NaN, candidateCount: 3 })).toBe(2);
  });

  it("fails conservatively when an injected classifier throws or returns malformed data", () => {
    const options = {
      body: chat("hello"),
      comboName: "coder-auto",
      models: ["lite", "standard", "high"],
    };
    const thrown = selectAutoRoute({ ...options, classifier: () => { throw new Error("unexpected classifier failure"); } });
    const malformed = selectAutoRoute({ ...options, classifier: () => ({ score: Number.NaN, escalationScore: Number.NaN, reasons: [] }) });
    expect(thrown.target).toBe("high");
    expect(thrown.classification.reasons).toEqual(["classifier-error"]);
    expect(malformed.target).toBe("high");
    expect(malformed.classification.reasons).toEqual(["classifier-error"]);
  });
});
