import { describe, it, expect } from "vitest";
import {
  countSinceLastDelegation,
  buildNudge,
  injectOrchestrationNudge,
  NOVEL_CONTEXT_CAP,
} from "../../open-sse/rtk/orchestrationNudge.js";

// Claude-shaped assistant turn carrying tool_use blocks
const claudeTurn = (...calls) => ({
  role: "assistant",
  content: calls.map(([name, input]) => ({ type: "tool_use", name, input: input ?? {} })),
});

const claudeBody = (...turns) => ({ messages: turns });

const reads = (n) => Array.from({ length: n }, () => claudeTurn(["Read", { file_path: "/a" }]));

describe("countSinceLastDelegation", () => {
  it("returns null for an unreadable body rather than guessing", () => {
    expect(countSinceLastDelegation(null)).toBeNull();
    expect(countSinceLastDelegation({})).toBeNull();
    expect(countSinceLastDelegation({ messages: "nope" })).toBeNull();
  });

  it("counts novel-context calls when there has been no delegation at all", () => {
    const stats = countSinceLastDelegation(claudeBody(...reads(9)));
    expect(stats.novel).toBe(9);
    expect(stats.sawDelegation).toBe(false);
  });

  it("stops counting at the most recent delegation", () => {
    const body = claudeBody(
      ...reads(20),
      claudeTurn(["Agent", { model: "haiku" }]),
      ...reads(3),
    );
    const stats = countSinceLastDelegation(body);
    expect(stats.novel).toBe(3);
    expect(stats.sawDelegation).toBe(true);
  });

  it("does not count tools that only manipulate what is already in context", () => {
    const body = claudeBody(
      claudeTurn(["Edit", {}], ["Write", {}], ["TodoWrite", {}]),
      claudeTurn(["Read", {}]),
    );
    expect(countSinceLastDelegation(body).novel).toBe(1);
  });

  it("counts every novel tool kind, including Bash and web fetches", () => {
    const body = claudeBody(
      claudeTurn(["Bash", {}], ["Grep", {}], ["Glob", {}]),
      claudeTurn(["WebFetch", {}], ["WebSearch", {}], ["PowerShell", {}]),
    );
    expect(countSinceLastDelegation(body).novel).toBe(6);
  });

  it("flags a delegation that named no model", () => {
    const withModel = claudeBody(claudeTurn(["Agent", { model: "haiku" }]));
    const without = claudeBody(claudeTurn(["Agent", { prompt: "go" }]));
    expect(countSinceLastDelegation(withModel).unspecifiedModel).toBe(0);
    expect(countSinceLastDelegation(without).unspecifiedModel).toBe(1);
  });

  it("reads OpenAI tool_calls shape", () => {
    const body = {
      messages: [
        { role: "assistant", tool_calls: [
          { function: { name: "Read", arguments: "{}" } },
          { function: { name: "Grep", arguments: "{}" } },
        ] },
      ],
    };
    expect(countSinceLastDelegation(body).novel).toBe(2);
  });

  it("survives malformed OpenAI tool arguments without throwing", () => {
    const body = {
      messages: [
        { role: "assistant", tool_calls: [{ function: { name: "Agent", arguments: "{not json" } }] },
      ],
    };
    const stats = countSinceLastDelegation(body);
    expect(stats.sawDelegation).toBe(true);
    expect(stats.unspecifiedModel).toBe(1);   // unparseable args cannot have named a model
  });

  it("reads Gemini contents/parts shape", () => {
    const body = { contents: [
      { role: "model", parts: [{ functionCall: { name: "Read", args: {} } },
                               { functionCall: { name: "Bash", args: {} } }] },
    ] };
    expect(countSinceLastDelegation(body).novel).toBe(2);
  });

  it("reads the Antigravity nested request.contents shape", () => {
    const body = { request: { contents: [
      { role: "model", parts: [{ functionCall: { name: "Read", args: {} } }] },
    ] } };
    expect(countSinceLastDelegation(body).novel).toBe(1);
  });
});

describe("buildNudge", () => {
  it("stays silent below the cap", () => {
    expect(buildNudge({ novel: NOVEL_CONTEXT_CAP - 1, unspecifiedModel: 0 })).toBeNull();
  });

  it("reminds at the cap and states the live count", () => {
    const msg = buildNudge({ novel: NOVEL_CONTEXT_CAP, unspecifiedModel: 0 });
    expect(msg).toContain(String(NOVEL_CONTEXT_CAP));
    expect(msg).toContain("Delegate");
  });

  it("escalates at double the cap and names the overage", () => {
    const msg = buildNudge({ novel: 14, unspecifiedModel: 0 });
    expect(msg).toContain("14");
    expect(msg).toContain(String(14 - NOVEL_CONTEXT_CAP));
    expect(msg).toContain("now");
  });

  it("calls out an unnamed model on the previous delegation", () => {
    const msg = buildNudge({ novel: NOVEL_CONTEXT_CAP, unspecifiedModel: 1 });
    expect(msg).toContain("named no model");
  });
});

describe("injectOrchestrationNudge", () => {
  it("injects into a Claude-shaped body via system[]", () => {
    const final = { system: [{ type: "text", text: "base" }] };
    const tier = injectOrchestrationNudge(final, "claude", claudeBody(...reads(8)));
    expect(tier).toBe("remind");
    expect(final.system.map((b) => b.text).join(" ")).toContain("Orchestration");
  });

  it("injects into a Gemini-shaped body via systemInstruction.parts", () => {
    const final = {};
    const tier = injectOrchestrationNudge(final, "gemini", claudeBody(...reads(15)));
    expect(tier).toBe("firm");
    expect(final.systemInstruction.parts[0].text).toContain("Orchestration");
  });

  it("injects into an OpenAI-shaped body via a system message", () => {
    const final = { messages: [{ role: "user", content: "hi" }] };
    injectOrchestrationNudge(final, "openai", claudeBody(...reads(8)));
    expect(final.messages[0].role).toBe("system");
    expect(final.messages[0].content).toContain("Orchestration");
  });

  it("leaves the body untouched below the cap", () => {
    const final = { system: "base" };
    expect(injectOrchestrationNudge(final, "claude", claudeBody(...reads(2)))).toBeNull();
    expect(final.system).toBe("base");
  });

  it("goes quiet again once a delegation resets the count", () => {
    const body = claudeBody(...reads(30), claudeTurn(["Agent", { model: "haiku" }]));
    const final = { system: "base" };
    expect(injectOrchestrationNudge(final, "claude", body)).toBeNull();
    expect(final.system).toBe("base");
  });

  it("fails open on a hostile body instead of throwing", () => {
    const final = { system: "base" };
    const circular = { messages: [] };
    circular.messages.push(circular);
    expect(() => injectOrchestrationNudge(final, "claude", circular)).not.toThrow();
  });

  it("reproduces session dce6e9bd: 83 inline calls, no delegation, fires firm", () => {
    const body = claudeBody(...Array.from({ length: 83 }, () => claudeTurn(["Bash", { command: "grep x" }])));
    const stats = countSinceLastDelegation(body);
    expect(stats.novel).toBe(83);
    expect(stats.sawDelegation).toBe(false);
    const final = {};
    expect(injectOrchestrationNudge(final, "gemini", body)).toBe("firm");
  });
});
