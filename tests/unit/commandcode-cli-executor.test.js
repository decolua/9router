import { EventEmitter } from "events";
import os from "os";
import { describe, it, expect, vi, beforeEach } from "vitest";

const spawnMock = vi.fn();

vi.mock("child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn().mockResolvedValue(undefined),
  saveRequestUsage: vi.fn().mockResolvedValue(undefined),
}));

const { CommandCodeCLIExecutor } = await import("../../open-sse/executors/commandcode-cli.js");
const { resolveCommandCodeCliBin } = await import("../../open-sse/services/commandCodeCliBin.js");
const { createPassthroughStreamWithLogger } = await import("../../open-sse/utils/stream.js");

function mockChildProcess({ stdout = "", stderr = "", code = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();

  queueMicrotask(() => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.emit("close", code);
  });

  return child;
}

describe("CommandCodeCLIExecutor", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    delete process.env.COMMAND_CODE_CLI_BIN;
  });

  it("resolves the CLI binary by env override and platform defaults", () => {
    expect(resolveCommandCodeCliBin({ env: {}, platform: "win32" })).toBe("commandcode");
    expect(resolveCommandCodeCliBin({ env: {}, platform: "linux" })).toBe("cmd");
    expect(resolveCommandCodeCliBin({ env: {}, platform: "darwin" })).toBe("cmd");
    expect(resolveCommandCodeCliBin({
      env: { COMMAND_CODE_CLI_BIN: "/opt/command-code/bin/cc" },
      platform: "win32",
    })).toBe("/opt/command-code/bin/cc");
  });

  it("spawns cmd with an args array and maps arbitrary cccli-prefixed model IDs to upstream CLI model IDs", async () => {
    spawnMock.mockReturnValue(mockChildProcess({ stdout: "hello from cli\n" }));
    const executor = new CommandCodeCLIExecutor();

    const result = await executor.execute({
      model: "cccli/deepseek/deepseek-v4-pro",
      body: { messages: [{ role: "user", content: "Say hello" }], stream: false },
      credentials: { providerSpecificData: {} },
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawnMock.mock.calls[0];
    expect(command).toBe("cmd");
    expect(Array.isArray(args)).toBe(true);
    expect(options.shell).toBe(false);
    expect(options.cwd).toBe(os.tmpdir());
    expect(args).toEqual([
      "--model", "deepseek/deepseek-v4-pro",
      "-p", "user: Say hello",
      "--skip-onboarding",
      "--trust",
      "--max-turns", "4",
    ]);

    const json = await result.response.json();
    expect(json.model).toBe("cccli/deepseek/deepseek-v4-pro");
    expect(json.choices[0].message.content).toBe("hello from cli");
  });

  it("uses COMMAND_CODE_CLI_BIN when set", async () => {
    process.env.COMMAND_CODE_CLI_BIN = "/custom/commandcode";
    spawnMock.mockReturnValue(mockChildProcess({ stdout: "ok" }));
    const executor = new CommandCodeCLIExecutor();

    await executor.execute({
      model: "deepseek/deepseek-v4-pro",
      body: { messages: [{ role: "user", content: "ping" }] },
      credentials: { providerSpecificData: {} },
    });

    expect(spawnMock.mock.calls[0][0]).toBe("/custom/commandcode");
    expect(spawnMock.mock.calls[0][2]).toEqual(expect.objectContaining({
      shell: false,
      cwd: os.tmpdir(),
    }));
  });

  it("returns OpenAI-compatible SSE when stream is true and the core appends one DONE sentinel", async () => {
    spawnMock.mockReturnValue(mockChildProcess({ stdout: "Hello!\n" }));
    const executor = new CommandCodeCLIExecutor();
    const body = { messages: [{ role: "user", content: "Say hello" }], stream: true };

    const result = await executor.execute({
      model: "deepseek/deepseek-v4-pro",
      body,
      credentials: { providerSpecificData: {} },
    });

    expect(result.response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    const executorText = await result.response.clone().text();
    expect((executorText.match(/data: \[DONE\]/g) || []).length).toBe(0);

    const transform = createPassthroughStreamWithLogger("commandcode-cli", null, "deepseek/deepseek-v4-pro", null, body);
    const text = await new Response(result.response.body.pipeThrough(transform)).text();
    expect(text.startsWith("data: ")).toBe(true);
    expect((text.match(/data: \[DONE\]/g) || []).length).toBe(1);
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
    expect(text).toContain('"object":"chat.completion.chunk"');
    expect(text).toContain('"model":"cccli/deepseek/deepseek-v4-pro"');
    expect(text).toContain('"role":"assistant"');
    expect(text).toContain('"content":"Hello!"');
    expect(text).toContain('"finish_reason":"stop"');
  });

  it("allows providerSpecificData.maxTurns to override the default", async () => {
    spawnMock.mockReturnValue(mockChildProcess({ stdout: "ok" }));
    const executor = new CommandCodeCLIExecutor();

    await executor.execute({
      model: "xiaomi/mimo-v2.5",
      body: { messages: [{ role: "user", content: "ping" }] },
      credentials: { providerSpecificData: { maxTurns: 1 } },
    });

    expect(spawnMock.mock.calls[0][1]).toContain("1");
    expect(spawnMock.mock.calls[0][1].slice(0, 2)).toEqual(["--model", "xiaomi/mimo-v2.5"]);
  });
});
