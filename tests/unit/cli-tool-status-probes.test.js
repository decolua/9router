import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COMMAND_LOOKUP_CACHE_TTL_MS,
  COMMAND_LOOKUP_TIMEOUT_MS,
  createCommandAvailabilityProbe,
} from "@/lib/cliTools/commandAvailability.js";
import { CLI_STATUS_CONCURRENCY, mapWithConcurrency } from "@/lib/cliTools/statusFanout.js";

const rootFile = (relativePath) => fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));

describe("CLI status command probes", () => {
  it("uses where.exe directly on Windows and coalesces/cache concurrent lookups", async () => {
    let now = 1_000;
    const calls = [];
    const probe = createCommandAvailabilityProbe({
      platform: "win32",
      env: {
        APPDATA: "C:\\Users\\test\\AppData\\Roaming",
        PATH: "C:\\Windows\\System32",
      },
      now: () => now,
      execFileImpl(file, args, options, callback) {
        calls.push({ file, args, options });
        queueMicrotask(() => callback(null, "C:\\tools\\claude.cmd\r\n", ""));
        return {};
      },
    });

    const [first, second] = await Promise.all([
      probe.findCommandOnPath("claude"),
      probe.findCommandOnPath("claude"),
    ]);

    expect(first).toBe("C:\\tools\\claude.cmd");
    expect(second).toBe(first);
    expect(calls).toHaveLength(1);
    expect(calls[0].file).toBe("where.exe");
    expect(calls[0].args).toEqual(["claude"]);
    expect(calls[0].options).toMatchObject({
      windowsHide: true,
      timeout: COMMAND_LOOKUP_TIMEOUT_MS,
    });
    expect(calls[0].options.env.PATH).toBe("C:\\Users\\test\\AppData\\Roaming\\npm;C:\\Windows\\System32");

    await probe.findCommandOnPath("claude");
    expect(calls).toHaveLength(1);

    now += COMMAND_LOOKUP_CACHE_TTL_MS + 1;
    await probe.findCommandOnPath("claude");
    expect(calls).toHaveLength(2);
  });

  it("does not use cmd.exe to read a version and coalesces that optional probe", async () => {
    const calls = [];
    const probe = createCommandAvailabilityProbe({
      platform: "win32",
      execFileImpl(file, args, options, callback) {
        calls.push({ file, args, options });
        queueMicrotask(() => {
          if (file === "where.exe") callback(null, "C:\\tools\\devin.exe\r\n", "");
          else callback(null, "devin 1.2.3\r\n", "");
        });
        return {};
      },
    });

    const [first, second] = await Promise.all([
      probe.getCommandOutput("devin", ["--version"]),
      probe.getCommandOutput("devin", ["--version"]),
    ]);

    expect(first).toBe("devin 1.2.3");
    expect(second).toBe(first);
    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.file)).toEqual(["where.exe", "C:\\tools\\devin.exe"]);
    expect(calls.every((call) => call.file !== "cmd.exe")).toBe(true);
  });

  it("rejects malformed names before a child process can be created", async () => {
    const calls = [];
    const probe = createCommandAvailabilityProbe({
      execFileImpl(...args) {
        calls.push(args);
        return {};
      },
    });

    await expect(probe.findCommandOnPath("claude & start cmd")).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("CLI status fan-out", () => {
  it("caps concurrent status getters and preserves their input order", async () => {
    let active = 0;
    let maximumActive = 0;
    const values = await mapWithConcurrency(["a", "b", "c", "d", "e", "f", "g"], CLI_STATUS_CONCURRENCY, async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value.toUpperCase();
    });

    expect(values).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
    expect(maximumActive).toBeLessThanOrEqual(CLI_STATUS_CONCURRENCY);
    expect(CLI_STATUS_CONCURRENCY).toBeLessThan(14);
  });

  it("routes all shell-backed status checks through the shared probe", () => {
    const routeFiles = [
      "claude-settings",
      "opencode-settings",
      "droid-settings",
      "openclaw-settings",
      "hermes-settings",
      "cline-settings",
      "kilo-settings",
      "deepseek-tui-settings",
      "jcode-settings",
      "grok-build-settings",
      "devin-settings",
    ];

    for (const name of routeFiles) {
      const source = fs.readFileSync(rootFile(`src/app/api/cli-tools/${name}/route.js`), "utf8");
      expect(source).toContain("@/lib/cliTools/commandAvailability.js");
      expect(source).not.toMatch(/promisify\(exec\)|from\s+["']child_process["']/);
    }

    const allStatusesSource = fs.readFileSync(rootFile("src/app/api/cli-tools/all-statuses/route.js"), "utf8");
    expect(allStatusesSource).toContain("mapWithConcurrency");
    expect(allStatusesSource).toContain("CLI_STATUS_CONCURRENCY");
    expect(allStatusesSource).not.toContain("Promise.all(");
  });
});

