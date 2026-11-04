import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import { resolve } from "node:path";
import { useTaskStore, DONE_TTL_MS } from "@/store/taskStore";

// vitest's cwd is the tests dir; read against the repo root so the file paths
// here resolve (src/app/(dashboard)/...) the same way the runner runs them.
const root = resolve(__dirname, "../..");
const read = (rel) => fs.readFileSync(resolve(root, rel), "utf-8");

describe("bell all loading tasks integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useTaskStore.setState({ tasks: [] });
  });

  it("providers/page.js registers useTaskStore for batch testing", () => {
    const file = read("src/app/(dashboard)/dashboard/providers/page.js", "utf-8");
    expect(file).toContain('import { useTaskStore } from "@/store/taskStore";');
    expect(file).toContain('id: taskId');
    expect(file).toContain('provider-batch-test');
    expect(file).toContain('useTaskStore.getState().start');
    expect(file).toContain('useTaskStore.getState().finish(taskId)');
  });

  it("profile/page.js registers useTaskStore for backup and import operations", () => {
    const file = read("src/app/(dashboard)/dashboard/profile/page.js", "utf-8");
    expect(file).toContain('import { useTaskStore } from "@/store/taskStore";');
    expect(file).toContain('profile-backup-task');
    expect(file).toContain('useTaskStore.getState().start');
    expect(file).toContain('useTaskStore.getState().finish(profileTaskRef.current)');
  });

  it("AddApiKeyModal.js registers useTaskStore for bulk key imports", () => {
    const file = read("src/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js", "utf-8");
    expect(file).toContain('import { useTaskStore } from "@/store/taskStore";');
    expect(file).toContain('add-apikeys-');
    expect(file).toContain('useTaskStore.getState().start');
    expect(file).toContain('useTaskStore.getState().update');
    expect(file).toContain('useTaskStore.getState().finish(taskId)');
  });

  it("BulkImportCodexModal.js registers useTaskStore for accounts import", () => {
    const file = read("src/app/(dashboard)/dashboard/providers/[id]/BulkImportCodexModal.js", "utf-8");
    expect(file).toContain('import { useTaskStore } from "@/store/taskStore";');
    expect(file).toContain('bulk-import-codex');
    expect(file).toContain('useTaskStore.getState().start');
    expect(file).toContain('useTaskStore.getState().finish(taskId)');
  });

  it("BulkImportGrokCliModal.js registers useTaskStore for grok accounts import", () => {
    const file = read("src/app/(dashboard)/dashboard/providers/[id]/BulkImportGrokCliModal.js", "utf-8");
    expect(file).toContain('import { useTaskStore } from "@/store/taskStore";');
    expect(file).toContain('bulk-import-grok');
    expect(file).toContain('useTaskStore.getState().start');
    expect(file).toContain('useTaskStore.getState().finish(taskId)');
  });

  it("providers/[id]/page.js registers useTaskStore for Qoder and Cline model imports", () => {
    const file = read("src/app/(dashboard)/dashboard/providers/[id]/page.js", "utf-8");
    expect(file).toContain('import { useTaskStore } from "@/store/taskStore";');
    expect(file).toContain("import-qoder-models-");
    expect(file).toContain("import-cline-models-");
    expect(file).toContain("useTaskStore.getState().start");
    expect(file).toContain("useTaskStore.getState().update(taskId, {");
    expect(file).toContain("finishImportTask(taskId,");
  });

  it("tracks batch test lifecycle in taskStore correctly", () => {
    const store = useTaskStore.getState();
    store.start({
      id: "provider-batch-test",
      title: "Testing connections",
      message: "Testing all API key connections",
      progress: 0,
      href: "/dashboard/providers",
    });

    let current = useTaskStore.getState().tasks.find((t) => t.id === "provider-batch-test");
    expect(current).toBeDefined();
    expect(current.state).toBeUndefined(); // running task has no 'done' state
    expect(current.title).toBe("Testing connections");

    store.finish("provider-batch-test");
    current = useTaskStore.getState().tasks.find((t) => t.id === "provider-batch-test");
    expect(current.state).toBe("done");
    expect(current.progress).toBe(100);

    // After 30s TTL auto-dismisses
    vi.advanceTimersByTime(DONE_TTL_MS + 100);
    current = useTaskStore.getState().tasks.find((t) => t.id === "provider-batch-test");
    expect(current).toBeUndefined();
  });
});
