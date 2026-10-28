import { describe, it, expect } from "vitest";
import { resolveClientWorkingDirectory } from "open-sse/services/opencodeServiceBridge.js";
import os from "node:os";

describe("Client Working Directory Resolution", () => {
  it("resolves directory from x-working-directory header", () => {
    const creds = { rawHeaders: { "x-working-directory": "/tmp" } };
    expect(resolveClientWorkingDirectory(creds, {}, [])).toBe("/tmp");
  });

  it("resolves directory from x-cwd header", () => {
    const creds = { rawHeaders: { "x-cwd": "/tmp" } };
    expect(resolveClientWorkingDirectory(creds, {}, [])).toBe("/tmp");
  });

  it("resolves directory from body.location.directory", () => {
    const body = { location: { directory: "/tmp" } };
    expect(resolveClientWorkingDirectory({}, body, [])).toBe("/tmp");
  });

  it("resolves directory from <env> block in system prompt", () => {
    const msgs = [{ role: "system", content: "<env>\n  Working directory: /tmp\n</env>" }];
    expect(resolveClientWorkingDirectory({}, {}, msgs)).toBe("/tmp");
  });

  it("falls back to process.cwd when no directory info provided", () => {
    const res = resolveClientWorkingDirectory({}, {}, []);
    expect(typeof res).toBe("string");
    expect(res.length).toBeGreaterThan(0);
  });
});
