
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createServiceTurnWatchdog,
  messagesToPromptText,
} from "../../open-sse/services/opencodeServiceBridge.js";

describe("OpenCode Multi-Step Agentic Continuity", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a long thinking turn alive when reasoning events keep arriving", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = createServiceTurnWatchdog({ timeoutMs: 100, onTimeout });

    watchdog.reset();
    vi.advanceTimersByTime(90);
    watchdog.reset();
    vi.advanceTimersByTime(90);

    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10);
    expect(onTimeout).toHaveBeenCalledOnce();
    watchdog.clear();
  });

  it("allows tool execution to use a longer timeout than model thinking", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = createServiceTurnWatchdog({ timeoutMs: 100, onTimeout });

    watchdog.reset(250);
    vi.advanceTimersByTime(200);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(onTimeout).toHaveBeenCalledOnce();
    watchdog.clear();
  });

  it("preserves tool results in the next service prompt", () => {
    const prompt = messagesToPromptText([
      { role: "assistant", content: null, tool_calls: [{ id: "call_abc123", type: "function", function: { name: "ctx_shell", arguments: '{"command":"ls"}' } }] },
      { role: "tool", tool_call_id: "call_abc123", content: "package.json\nREADME.md" },
    ], [], null);

    expect(prompt).toContain("TOOL RESULT for ctx_shell (call_abc123)");
    expect(prompt).toContain("package.json");
  });
});
