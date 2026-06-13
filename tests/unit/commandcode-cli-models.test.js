import { EventEmitter } from "events";
import os from "os";
import { describe, it, expect, vi, beforeEach } from "vitest";

const spawnMock = vi.fn();

vi.mock("child_process", () => ({
  spawn: spawnMock,
}));

const { resolveCommandCodeCliModels } = await import("../../open-sse/services/commandCodeCliModels.js");

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

describe("commandcode-cli model discovery", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    delete process.env.COMMAND_CODE_CLI_BIN;
    delete process.env.COMMAND_CODE_API_KEY;
    vi.stubGlobal("fetch", vi.fn());
  });

  it("lists CLI models with shell:false, args array, and cwd isolated to os.tmpdir()", async () => {
    spawnMock.mockReturnValue(mockChildProcess({ stdout: JSON.stringify({ models: ["deepseek/deepseek-v4-pro"] }) }));

    const result = await resolveCommandCodeCliModels({ timeoutMs: 1000 });

    expect(result.source).toBe("cli");
    expect(result.models[0].id).toBe("deepseek/deepseek-v4-pro");
    expect(spawnMock).toHaveBeenCalledWith("cmd", ["--list-models"], expect.objectContaining({
      shell: false,
      cwd: os.tmpdir(),
    }));
  });
});
