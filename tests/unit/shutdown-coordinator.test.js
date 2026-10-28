import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  ShutdownPhase,
  registerShutdownStep,
  hasShutdownStep,
  isShuttingDown,
  runShutdown,
  handleSignal,
  installProcessSignalHandlers,
  uninstallProcessSignalHandlers,
  __test__ as coord,
} from "@/lib/runtime/shutdownCoordinator.js";

describe("shutdownCoordinator", () => {
  let errorSpy;

  beforeEach(() => {
    coord.reset();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    coord.reset();
  });

  it("runs registered steps in phase order: flush, then close, then cleanup", async () => {
    const events = [];
    registerShutdownStep("cleanup-step", () => { events.push("cleanup"); }, { phase: ShutdownPhase.CLEANUP });
    registerShutdownStep("close-step", () => { events.push("close"); }, { phase: ShutdownPhase.CLOSE });
    registerShutdownStep("flush-step", () => { events.push("flush"); }, { phase: ShutdownPhase.FLUSH });

    await runShutdown("test");

    expect(events).toEqual(["flush", "close", "cleanup"]);
  });

  it("keeps registration order within a phase", async () => {
    const events = [];
    registerShutdownStep("a", () => { events.push("a"); }, { phase: ShutdownPhase.CLOSE });
    registerShutdownStep("b", () => { events.push("b"); }, { phase: ShutdownPhase.CLOSE });

    await runShutdown("test");

    expect(events).toEqual(["a", "b"]);
  });

  it("is idempotent across repeated and concurrent triggers", async () => {
    const step = vi.fn(async () => {});
    registerShutdownStep("once", step, { phase: ShutdownPhase.FLUSH });

    const first = runShutdown("SIGINT");
    const second = runShutdown("SIGTERM");
    expect(isShuttingDown()).toBe(true);
    expect(second).toBe(first);

    await Promise.all([first, second]);
    await runShutdown("again");

    expect(step).toHaveBeenCalledTimes(1);
    expect(coord.getLastReason()).toBe("SIGINT");
  });

  it("logs an error message without the error payload and still runs later cleanup", async () => {
    const later = vi.fn();
    registerShutdownStep("boom", () => {
      throw Object.assign(new Error("flush boom"), { payload: { secret: "S3cr3t" } });
    }, { phase: ShutdownPhase.FLUSH });
    registerShutdownStep("later", later, { phase: ShutdownPhase.CLOSE });

    await runShutdown("test");

    expect(later).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]).toHaveLength(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain('step "boom" failed');
    expect(String(errorSpy.mock.calls[0][0])).toContain("flush boom");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("S3cr3t");
  });

  it("does not reject when a step fails", async () => {
    registerShutdownStep("boom", () => { throw new Error("nope"); }, { phase: ShutdownPhase.FLUSH });
    await expect(runShutdown("test")).resolves.toBeUndefined();
  });

  it("handleSignal awaits shutdown then exits once; duplicate signals do not re-run or double-exit", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {});
    const step = vi.fn(async () => {});
    registerShutdownStep("work", step, { phase: ShutdownPhase.FLUSH });

    const first = handleSignal("SIGINT");
    const second = handleSignal("SIGTERM");
    expect(first).toBeInstanceOf(Promise);
    expect(second).toBe(first);

    await Promise.all([first, second]);
    await handleSignal("SIGINT");

    expect(step).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("exposes an observable signal promise without forcing a test-process exit", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {});
    const events = [];
    registerShutdownStep("work", async () => { events.push("done"); }, { phase: ShutdownPhase.FLUSH });

    const pending = handleSignal("SIGTERM");
    expect(pending).toBeInstanceOf(Promise);
    expect(exitSpy).not.toHaveBeenCalled();
    await pending;

    expect(events).toEqual(["done"]);
    expect(exitSpy).toHaveBeenCalledTimes(1);
  });

  it("installs exactly one SIGINT and SIGTERM listener and removes them on uninstall", () => {
    const snapshot = () => ({
      SIGINT: process.listeners("SIGINT").length,
      SIGTERM: process.listeners("SIGTERM").length,
      beforeExit: process.listeners("beforeExit").length,
    });
    const before = snapshot();

    installProcessSignalHandlers();
    const installed = snapshot();
    expect(installed.SIGINT - before.SIGINT).toBe(1);
    expect(installed.SIGTERM - before.SIGTERM).toBe(1);
    expect(installed.beforeExit - before.beforeExit).toBe(1);

    installProcessSignalHandlers();
    expect(snapshot()).toEqual(installed);

    uninstallProcessSignalHandlers();
    expect(snapshot()).toEqual(before);
  });

  it("runs shutdown once when the installed SIGINT/SIGTERM listeners actually fire", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {});
    const seen = [];
    registerShutdownStep("on-sigint", () => { seen.push("SIGINT"); }, { phase: ShutdownPhase.FLUSH });
    registerShutdownStep("on-sigterm", () => { seen.push("SIGTERM"); }, { phase: ShutdownPhase.FLUSH });
    installProcessSignalHandlers();

    process.emit("SIGINT");
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledTimes(1));

    process.emit("SIGTERM");
    await Promise.resolve();

    expect(seen).toContain("SIGINT");
    expect(seen).toContain("SIGTERM");
    expect(exitSpy).toHaveBeenCalledTimes(1);
  });

  it("does not call process.exit from the beforeExit trigger", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {});
    const step = vi.fn();
    registerShutdownStep("flush", step, { phase: ShutdownPhase.FLUSH });
    installProcessSignalHandlers();

    await runShutdown("beforeExit");

    expect(step).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("registers and detects steps by name idempotently", () => {
    registerShutdownStep("named", () => {}, { phase: ShutdownPhase.FLUSH });
    registerShutdownStep("named", () => {}, { phase: ShutdownPhase.FLUSH });
    expect(hasShutdownStep("named")).toBe(true);
    expect(coord.snapshot().filter((s) => s.name === "named")).toHaveLength(1);
  });

  it("rejects non-function steps", () => {
    expect(() => registerShutdownStep("bad", null)).toThrow(TypeError);
  });
});
