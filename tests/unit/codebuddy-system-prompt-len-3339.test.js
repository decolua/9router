// #3339 — CodeBuddy CN replaces a system prompt that looks like a coding-agent
// identity, because Tencent's filter rejects those. The length half of that
// test was a hard-coded 2000 with no signal, so a long hand-written project
// prompt was silently swapped for the neutral one.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";

const NEUTRAL = "You are a helpful AI assistant that helps with software engineering tasks.";
const AGENT_PROMPT = "You are Claude Code, Anthropic's official CLI for Claude.";

// Long, but plainly a human-written project prompt: no agent identity marker.
const LONG_PROJECT_PROMPT = `Project conventions. ${"Prefer small, focused functions and explicit names. ".repeat(60)}`;

function run(body, exec = new CodeBuddyExecutor()) {
  return exec.transformRequest("glm-5.2", body, false, {});
}

function systemOf(out) {
  const message = out.messages.find((m) => m.role === "system");
  return typeof message?.content === "string"
    ? message.content
    : message?.content?.map((b) => b.text).join("\n");
}

describe("CodeBuddyExecutor system prompt length gate (#3339)", () => {
  const ENV_KEY = "CODEBUDDY_SYSTEM_PROMPT_MAX_LEN";
  let warn;

  beforeEach(() => {
    delete process.env[ENV_KEY];
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env[ENV_KEY];
    warn.mockRestore();
  });

  it("still replaces an agent identity prompt", () => {
    const out = run({ messages: [{ role: "system", content: AGENT_PROMPT }] });
    expect(systemOf(out)).toBe(NEUTRAL);
  });

  it("leaves a short project prompt alone and stays quiet", () => {
    const out = run({ messages: [{ role: "system", content: "Answer in French." }] });
    expect(systemOf(out)).toBe("Answer in French.");
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps the 2000-char default when the env var is unset", () => {
    expect(LONG_PROJECT_PROMPT.length).toBeGreaterThan(2000);
    const out = run({ messages: [{ role: "system", content: LONG_PROJECT_PROMPT }] });
    expect(systemOf(out)).toBe(NEUTRAL);
  });

  it("honours a raised limit so a long project prompt survives", () => {
    process.env[ENV_KEY] = "20000";
    const out = run({ messages: [{ role: "system", content: LONG_PROJECT_PROMPT }] });
    expect(systemOf(out)).toBe(LONG_PROJECT_PROMPT);
  });

  it("treats 0 as 'identity markers only'", () => {
    process.env[ENV_KEY] = "0";

    const kept = run({ messages: [{ role: "system", content: LONG_PROJECT_PROMPT }] });
    expect(systemOf(kept)).toBe(LONG_PROJECT_PROMPT);

    // A raised/disabled limit must never let an agent prompt through — that is
    // the case the filter actually rejects.
    const agent = run({ messages: [{ role: "system", content: AGENT_PROMPT }] });
    expect(systemOf(agent)).toBe(NEUTRAL);
  });

  it("falls back to the default on a junk or negative value", () => {
    for (const value of ["abc", "-1", "1.5", ""]) {
      process.env[ENV_KEY] = value;
      const out = run({ messages: [{ role: "system", content: LONG_PROJECT_PROMPT }] });
      expect(systemOf(out), `value ${JSON.stringify(value)}`).toBe(NEUTRAL);
    }
  });

  it("names the rule that fired so a false positive is diagnosable", () => {
    run({ messages: [{ role: "system", content: LONG_PROJECT_PROMPT }] });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("CODEBUDDY_SYSTEM_PROMPT_MAX_LEN");
    expect(warn.mock.calls[0][0]).toContain(String(LONG_PROJECT_PROMPT.length));

    warn.mockClear();
    run({ messages: [{ role: "system", content: AGENT_PROMPT }] });
    expect(warn.mock.calls[0][0]).toContain("agent identity marker");
  });

  it("preserves typed-block content shape on replacement", () => {
    const out = run({
      messages: [{ role: "system", content: [{ type: "text", text: AGENT_PROMPT }] }],
    });
    const message = out.messages.find((m) => m.role === "system");
    expect(message.content).toEqual([{ type: "text", text: NEUTRAL }]);
  });

  it("does not touch user or assistant messages", () => {
    const out = run({
      messages: [
        { role: "user", content: LONG_PROJECT_PROMPT },
        { role: "assistant", content: AGENT_PROMPT },
      ],
    });
    expect(out.messages[0].content).toBe(LONG_PROJECT_PROMPT);
    expect(out.messages[1].content).toBe(AGENT_PROMPT);
    expect(warn).not.toHaveBeenCalled();
  });
});
