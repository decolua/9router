import { describe, expect, it } from "vitest";
import { resolveTransport } from "../../open-sse/services/provider.js";
import OllamaLocalExecutor from "../../open-sse/executors/ollama-local.js";

describe("Phase 1: Claude passthrough transport", () => {
  it("Contract A: resolveTransport(ollama, claude) returns /v1/messages", () => {
    const t = resolveTransport("ollama", "claude");
    expect(t).not.toBeNull();
    expect(t.format).toBe("claude");
    expect(t.baseUrl).toBe("https://ollama.com/v1/messages");
  });

  it("Contract A local: resolveTransport(ollama-local, claude) returns localhost /v1/messages", () => {
    const t = resolveTransport("ollama-local", "claude");
    expect(t).not.toBeNull();
    expect(t.format).toBe("claude");
    expect(t.baseUrl).toBe("http://localhost:11434/v1/messages");
  });

  it("Contract B fallback: resolveTransport(ollama, openai) === null", () => {
    expect(resolveTransport("ollama", "openai")).toBeNull();
  });

  it("Contract B fallback local: resolveTransport(ollama-local, openai) === null", () => {
    expect(resolveTransport("ollama-local", "openai")).toBeNull();
  });

  it("Contract C: buildUrl honors runtimeTransport baseUrl for claude path", () => {
    const exec = new OllamaLocalExecutor();
    const creds = { runtimeTransport: { baseUrl: "http://localhost:11434/v1/messages", format: "claude" } };
    expect(exec.buildUrl("", true, 0, creds)).toBe("http://localhost:11434/v1/messages");
  });

  it("Contract C host-override: buildUrl honors providerSpecificData.baseUrl", () => {
    const exec = new OllamaLocalExecutor();
    const creds = {
      runtimeTransport: { baseUrl: "http://localhost:11434/v1/messages", format: "claude" },
      providerSpecificData: { baseUrl: "http://192.168.1.5:11434" },
    };
    expect(exec.buildUrl("", true, 0, creds)).toBe("http://192.168.1.5:11434/v1/messages");
  });

  it("Contract C fallback: buildUrl returns /api/chat without runtimeTransport", () => {
    const exec = new OllamaLocalExecutor();
    expect(exec.buildUrl("", true, 0, null)).toBe("http://localhost:11434/api/chat");
  });
});