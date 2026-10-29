import { describe, it, expect } from "vitest";
import { resolveClientWorkingDirectory } from "open-sse/services/opencodeServiceBridge.js";
import path from "node:path";
import os from "node:os";

describe("OpenCode Bridge Multi-Platform Compatibility", () => {
  it("resolves Windows absolute paths from headers", () => {
    // Windows drive-letter path (e.g. C:\Projects\app or D:/workspace)
    const winPath = "C:\\Projects\\my-app";
    const creds = { rawHeaders: { "x-working-directory": winPath } };
    const resolved = resolveClientWorkingDirectory(creds, {}, []);
    expect(resolved).toBe(winPath);
  });

  it("resolves Windows path from body location", () => {
    const winPath = "D:/Workspaces/code";
    const resolved = resolveClientWorkingDirectory({}, { location: { directory: winPath } }, []);
    expect(resolved).toBe(winPath);
  });

  it("resolves Windows path from <env> block", () => {
    const winPath = "E:\\Sources\\project";
    const msgs = [{ role: "system", content: `<env>\n  Working directory: ${winPath}\n</env>` }];
    const resolved = resolveClientWorkingDirectory({}, {}, msgs);
    expect(resolved).toBe(winPath);
  });

  it("resolves POSIX path from headers", () => {
    const posixPath = "/workspace/project";
    const creds = { rawHeaders: { "x-cwd": posixPath } };
    const resolved = resolveClientWorkingDirectory(creds, {}, []);
    expect(resolved).toBe(posixPath);
  });
});
