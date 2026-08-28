// A5 (cases #7/#9/#10): lock hardcode->config no-op values.
import { describe, it, expect } from "vitest";
import {
  OPENAI_COMPAT_BASE,
  ANTHROPIC_COMPAT_BASE,
  ANTHROPIC_API_VERSION,
} from "../../open-sse/providers/shared.js";
import { DEFAULT_MAX_TOKENS, DEFAULT_MIN_TOKENS } from "../../open-sse/config/runtimeConfig.js";
import mimoFree from "../../open-sse/providers/registry/mimo-free.js";
import opencode from "../../open-sse/providers/registry/opencode.js";
import antigravity from "../../open-sse/providers/registry/antigravity.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";

describe("compat base URLs / version", () => {
  it("OPENAI_COMPAT_BASE", () => {
    expect(OPENAI_COMPAT_BASE).toBe("https://api.openai.com/v1");
  });
  it("ANTHROPIC_COMPAT_BASE", () => {
    expect(ANTHROPIC_COMPAT_BASE).toBe("https://api.anthropic.com/v1");
  });
  it("ANTHROPIC_API_VERSION", () => {
    expect(ANTHROPIC_API_VERSION).toBe("2023-06-01");
  });
});

describe("default token limits", () => {
  it("max/min", () => {
    expect(DEFAULT_MAX_TOKENS).toBe(64000);
    expect(DEFAULT_MIN_TOKENS).toBe(32000);
  });
});

describe("provider baseUrl const (full path, no trailing slash)", () => {
  it("mimo-free full path", () => {
    expect(mimoFree.transport.baseUrl).toBe("https://api.xiaomimimo.com/api/free-ai/openai/chat");
  });
  it("opencode no trailing slash", () => {
    expect(opencode.transport.baseUrl).toBe("https://opencode.ai");
  });
});

describe("antigravity retry (intentional change: 429=6, 503=3)", () => {
  it("429 attempts = 6", () => {
    expect(antigravity.transport.retry["429"].attempts).toBe(6);
  });
  it("503 attempts = 3", () => {
    expect(antigravity.transport.retry["503"].attempts).toBe(3);
  });
});

describe("OpenCode Free endpoint routing", () => {
  const MUSE = "muse-spark-1.2-contributor-free";

  it("declares the Responses format only on the Muse Spark model", () => {
    expect(opencode.transport.format).toBeUndefined();
    const muse = opencode.models.find((m) => m.id === MUSE);
    expect(muse?.targetFormat).toBe("openai-responses");
  });

  it("routes Muse Spark to /responses and every other model to /chat/completions", () => {
    const executor = new OpenCodeExecutor();
    expect(executor.buildUrl(MUSE)).toBe("https://opencode.ai/zen/v1/responses");
    expect(executor.buildUrl(`${MUSE}(xhigh)`)).toBe("https://opencode.ai/zen/v1/responses");
    expect(executor.buildUrl("big-pickle")).toBe("https://opencode.ai/zen/v1/chat/completions");
    expect(executor.buildUrl("hy3-free")).toBe("https://opencode.ai/zen/v1/chat/completions");
  });

  it("normalizes Chat token/thinking fields only for the Responses model", () => {
    const executor = new OpenCodeExecutor();
    const muse = { max_tokens: 4096, reasoning_effort: "high" };
    executor.transformRequest(MUSE, muse, true, {});
    expect(muse.max_output_tokens).toBe(4096);
    expect(muse.max_tokens).toBeUndefined();
    expect(muse.reasoning).toEqual({ effort: "high", summary: "auto" });

    const chat = { max_tokens: 4096, reasoning_effort: "high" };
    executor.transformRequest("big-pickle", chat, true, {});
    expect(chat.max_tokens).toBe(4096);
    expect(chat.max_output_tokens).toBeUndefined();
    expect(chat.reasoning_effort).toBe("high");
  });
});
