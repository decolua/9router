import { afterEach, describe, it, expect, vi } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import * as proxyFetchModule from "../../open-sse/utils/proxyFetch.js";

afterEach(() => vi.restoreAllMocks());

/**
 * `cx/gpt-6-luna-low` names an effort: the suffix is stripped from the model id
 * and becomes `reasoning.effort`. It used to count only when the client sent no
 * effort of its own — and agents (Codex CLI, Claude Code, …) always send one,
 * so the suffix the operator typed was silently thrown away and the model ran
 * at the client's default. The `(low)` spelling already won over the client
 * (thinkingUnified); the dash spelling now does too.
 */

const run = (model, extra = {}) => new CodexExecutor().transformRequest(model, { model, input: "hi", ...extra }, true, {});

describe("an effort written into the model id", () => {
  it("is used, and stripped from the model sent upstream", () => {
    const body = run("gpt-6-luna-low");
    expect(body.model).toBe("gpt-6-luna");
    expect(body.reasoning.effort).toBe("low");
  });

  it("wins over a reasoning_effort the client sent", () => {
    const body = run("gpt-6-luna-low", { reasoning_effort: "medium" });
    expect(body.model).toBe("gpt-6-luna");
    expect(body.reasoning.effort).toBe("low");
  });

  it("wins over a reasoning object the client sent, keeping the rest of it", () => {
    const body = run("gpt-6-luna-high", { reasoning: { effort: "low", summary: "detailed" } });
    expect(body.reasoning.effort).toBe("high");
    expect(body.reasoning.summary).toBe("detailed");
  });

  it("covers every level the model accepts", () => {
    for (const level of ["low", "medium", "high"]) {
      expect(run(`gpt-6-astra-${level}`, { reasoning_effort: "xhigh" }).reasoning.effort, level).toBe(level);
    }
  });
});

describe("-max in the model id", () => {
  it("is read as the effort and stripped, like (max)", () => {
    const body = run("gpt-6-luna-max");
    expect(body.model).toBe("gpt-6-luna");
    expect(body.reasoning.effort).toBe("max");
  });

  it("wins over the effort the client sent", () => {
    expect(run("gpt-6-luna-max", { reasoning: { effort: "low" } }).reasoning.effort).toBe("max");
    expect(run("gpt-6-luna-max", { reasoning_effort: "low" }).reasoning.effort).toBe("max");
  });

  it("works on a model that is not a Lite model", () => {
    const body = run("gpt-5.6-luna-max");
    expect(body.model).toBe("gpt-5.6-luna");
    expect(body.reasoning).toEqual({ effort: "max", summary: "auto" });
    expect(run("gpt-6-astra-max").reasoning.effort).toBe("max");
  });

  it("leaves a real model id that merely ends in -max alone", () => {
    // gpt-5.1-codex-max is an actual Codex model; its base takes no "max" effort.
    const body = run("gpt-5.1-codex-max");
    expect(body.model).toBe("gpt-5.1-codex-max");
    expect(body.reasoning.effort).not.toBe("max");
  });
});

describe("an effort in the id of a Lite model", () => {
  // Whether a model is Lite was decided on the id with the suffix still on it, so
  // `cx/gpt-6-luna-high` was sent as an ordinary Responses request, not a Lite one.
  it.each(["low", "high", "xhigh", "max"])("sends -%s in the Lite shape", (level) => {
    const body = run(`gpt-6-luna-${level}`);
    expect(body.model).toBe("gpt-6-luna");
    expect(body.reasoning).toEqual({ effort: level, context: "all_turns" });
    expect(body.instructions).toBe("");
    expect(body.tools).toBeNull();
    expect(body.input[0].type).toBe("additional_tools");
  });

  it("is the same request as the client-sent effort", () => {
    const dash = run("gpt-6-luna-max");
    const plain = run("gpt-6-luna", { reasoning: { effort: "max" } });
    for (const key of ["model", "reasoning", "instructions", "tools", "parallel_tool_calls", "tool_choice"]) {
      expect(dash[key], key).toEqual(plain[key]);
    }
  });

  it("goes out with the Lite header and the stripped model", async () => {
    const fetchMock = vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockResolvedValue({
      ok: true, status: 200, headers: new Map(),
    });
    await new CodexExecutor().execute({
      model: "gpt-6-luna-max",
      body: { model: "gpt-6-luna-max", input: "hello", reasoning: { effort: "low" } },
      stream: true,
      credentials: { connectionId: "fixture", accessToken: "fixture-token" },
    });
    const [, options] = fetchMock.mock.calls[0];
    const sent = JSON.parse(options.body);
    expect(options.headers["x-openai-internal-codex-responses-lite"]).toBe("true");
    expect(sent.model).toBe("gpt-6-luna");
    expect(sent.reasoning).toEqual({ effort: "max", context: "all_turns" });
  });
});

describe("a model id without an effort", () => {
  it("keeps the client's effort", () => {
    expect(run("gpt-6-luna", { reasoning_effort: "medium" }).reasoning.effort).toBe("medium");
    expect(run("gpt-6-luna", { reasoning: { effort: "high" } }).reasoning.effort).toBe("high");
  });

  it("does not mistake part of the name for an effort", () => {
    // "-review" is a virtual model that maps to its upstream one, not a level.
    const body = run("gpt-5.6-sol-review", { reasoning_effort: "medium" });
    expect(body.model).toBe("gpt-5.6-sol");
    expect(body.reasoning.effort).toBe("medium");
  });
});
