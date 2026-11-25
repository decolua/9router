import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { register } from "@/instrumentation.js";
import { FatalStartupError } from "@/lib/db/fatalStartupError.js";

const { getAdapter, startNotifications, writeSync } = vi.hoisted(() => ({
  getAdapter: vi.fn(), startNotifications: vi.fn(), writeSync: vi.fn(),
}));
vi.mock("node:fs", async importOriginal => ({ ...await importOriginal(), writeSync }));
vi.mock("@/lib/consoleLogBuffer", () => ({ initConsoleLogCapture: vi.fn() }));
vi.mock("@/lib/db/driver", () => ({ getAdapter }));
vi.mock("@/lib/notifications/scheduler", () => ({ startNotifications }));

let exit;
beforeEach(() => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NEXT_PHASE", "phase-production-server");
  exit = vi.spyOn(process, "exit").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllEnvs(); });

it("logs the redacted fatal reason to stderr before exiting production startup", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const error = new FatalStartupError("Invalid or missing gateway encryption key: /sk-sensitive/key-encryption-key; restore it from backup");
  getAdapter.mockRejectedValue(error);
  await expect(register()).rejects.toBe(error);
  expect(writeSync).toHaveBeenCalledWith(2, "[startup] Fatal database error: Invalid or missing gateway encryption key: /[REDACTED]/key-encryption-key; restore it from backup; exiting (1)\n");
  expect(writeSync.mock.invocationCallOrder[0]).toBeLessThan(exit.mock.invocationCallOrder[0]);
  expect(exit).toHaveBeenCalledWith(1);
  expect(startNotifications).not.toHaveBeenCalled();
});

it.each([
  ["production", new Error("SQLite busy")],
  ["development", new FatalStartupError("Unsupported apiKeys schema")],
  ["test", new FatalStartupError("Required pre-schema backup failed")],
])("propagates %s startup errors outside the fatal production case", async (env, error) => {
  vi.stubEnv("NODE_ENV", env);
  getAdapter.mockRejectedValue(error);
  await expect(register()).rejects.toBe(error);
  expect(exit).not.toHaveBeenCalled();
  expect(writeSync).not.toHaveBeenCalled();
  expect(startNotifications).not.toHaveBeenCalled();
});
