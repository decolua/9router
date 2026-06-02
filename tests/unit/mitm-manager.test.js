import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const tmpRoots = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }
});

describe("mitm manager helpers", () => {
  it("resolves the source MITM directory when standalone only contains server.js", async () => {
    const { __test__ } = await import("../../src/mitm/manager.js");
    const bundledPath = path.join(process.cwd(), ".next", "standalone", "src", "mitm", "server.js");
    const sourceDir = __test__.resolveMitmSourceDir(bundledPath);

    expect(sourceDir).toBe(path.join(process.cwd(), "src", "mitm"));
  });

  it("copies the MITM tree recursively", async () => {
    const { __test__ } = await import("../../src/mitm/manager.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "9router-mitm-"));
    tmpRoots.push(root);

    const srcDir = path.join(root, "src");
    const nested = path.join(srcDir, "nested");
    const destDir = path.join(root, "dest");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "logger.js"), "module.exports = { ok: true };");
    fs.writeFileSync(path.join(nested, "child.txt"), "child");

    __test__.copyRecursive(srcDir, destDir);

    expect(fs.readFileSync(path.join(destDir, "logger.js"), "utf8")).toContain("ok: true");
    expect(fs.readFileSync(path.join(destDir, "nested", "child.txt"), "utf8")).toBe("child");
  });

  it("copies the shared MITM host contract beside the runtime tree", async () => {
    const { __test__ } = await import("../../src/mitm/manager.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "9router-mitm-"));
    tmpRoots.push(root);

    const sourceDir = path.join(root, "src", "mitm");
    const sharedDir = path.join(root, "src", "shared", "constants");
    const destFile = path.join(root, "runtime", "shared", "constants", "mitmToolHosts.js");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.writeFileSync(path.join(sharedDir, "mitmToolHosts.js"), "module.exports = { TOOL_HOSTS: {} };");

    const resolved = __test__.resolveSharedMitmToolHostsPath(sourceDir);
    __test__.copyFileIfExists(resolved, destFile);

    expect(resolved).toBe(path.join(sharedDir, "mitmToolHosts.js"));
    expect(fs.readFileSync(destFile, "utf8")).toContain("TOOL_HOSTS");
  });

  it("self-heals a missing shared host file even when the server tree is untouched", async () => {
    const { __test__ } = await import("../../src/mitm/manager.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "9router-mitm-"));
    tmpRoots.push(root);

    const sourceDir = path.join(root, "src", "mitm");
    const sharedDir = path.join(root, "src", "shared", "constants");
    const runtimeShared = path.join(root, "runtime", "shared", "constants", "mitmToolHosts.js");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.writeFileSync(path.join(sharedDir, "mitmToolHosts.js"), "module.exports = { TOOL_HOSTS: { a: [] } };");

    // Runtime missing the shared file (older build that skipped it) → must be created.
    __test__.ensureRuntimeSharedHosts(sourceDir, false, runtimeShared);
    expect(fs.readFileSync(runtimeShared, "utf8")).toContain("a: []");

    // Without force, an existing runtime file is left untouched (no needless rewrite).
    fs.writeFileSync(runtimeShared, "STALE");
    __test__.ensureRuntimeSharedHosts(sourceDir, false, runtimeShared);
    expect(fs.readFileSync(runtimeShared, "utf8")).toBe("STALE");

    // With force (fresh build copy), the file is refreshed from source.
    __test__.ensureRuntimeSharedHosts(sourceDir, true, runtimeShared);
    expect(fs.readFileSync(runtimeShared, "utf8")).toContain("a: []");
  });

  it("adds ancestor node_modules to the MITM child NODE_PATH", async () => {
    const { __test__ } = await import("../../src/mitm/manager.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "9router-mitm-"));
    tmpRoots.push(root);

    const standaloneRoot = path.join(root, "standalone");
    const bundledServer = path.join(standaloneRoot, "src", "mitm", "server.js");
    const bundledNodeModules = path.join(standaloneRoot, "node_modules");
    const packageNodeModules = path.join(root, "node_modules");
    fs.mkdirSync(path.dirname(bundledServer), { recursive: true });
    fs.mkdirSync(bundledNodeModules, { recursive: true });
    fs.mkdirSync(packageNodeModules, { recursive: true });
    fs.writeFileSync(bundledServer, "require('node-forge');");

    const nodePath = __test__.buildMitmNodePath(bundledServer, path.join(root, "existing"));

    expect(nodePath.split(path.delimiter)).toEqual([
      bundledNodeModules,
      packageNodeModules,
      path.join(root, "existing"),
    ]);
  });
});
