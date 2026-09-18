// #3365 — the CLI hard-coded --max-old-space-size=6144 on the next-server
// spawn line. Node lets command-line flags beat NODE_OPTIONS, so an operator
// running under a cgroup limit could not lower it: the child kept a 6 GB heap
// budget, GC never felt pressure, and the kernel OOM-killed next-server.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveHeapFlags, DEFAULT_MAX_OLD_SPACE_MB } = require("../../cli/hooks/nodeFlags.js");

const DEFAULT_FLAG = `--max-old-space-size=${DEFAULT_MAX_OLD_SPACE_MB}`;

describe("resolveHeapFlags (#3365)", () => {
  let warn;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("keeps the 6144 default when nothing is configured", () => {
    expect(resolveHeapFlags({})).toEqual([DEFAULT_FLAG]);
    expect(DEFAULT_MAX_OLD_SPACE_MB).toBe(6144);
  });

  it("honours an explicit cap", () => {
    expect(resolveHeapFlags({ NINEROUTER_MAX_OLD_SPACE_SIZE: "384" }))
      .toEqual(["--max-old-space-size=384"]);
    expect(resolveHeapFlags({ NINEROUTER_MAX_OLD_SPACE_SIZE: " 1024 " }))
      .toEqual(["--max-old-space-size=1024"]);
  });

  it("emits no flag at all for 0, leaving the sizing to node", () => {
    expect(resolveHeapFlags({ NINEROUTER_MAX_OLD_SPACE_SIZE: "0" })).toEqual([]);
  });

  // The spawn-line flag would beat NODE_OPTIONS, so an operator who set it
  // there would see their setting silently ignored — the bug in the report.
  it("stands aside when NODE_OPTIONS already caps the heap", () => {
    expect(resolveHeapFlags({ NODE_OPTIONS: "--max-old-space-size=384" })).toEqual([]);
    expect(resolveHeapFlags({ NODE_OPTIONS: "--enable-source-maps --max-old-space-size=384" })).toEqual([]);
    // Node accepts the underscore spelling of V8 flags too.
    expect(resolveHeapFlags({ NODE_OPTIONS: "--max_old_space_size=384" })).toEqual([]);
  });

  it("ignores unrelated NODE_OPTIONS", () => {
    expect(resolveHeapFlags({ NODE_OPTIONS: "--enable-source-maps" })).toEqual([DEFAULT_FLAG]);
    // Not a match: a different flag that merely contains the name.
    expect(resolveHeapFlags({ NODE_OPTIONS: "--max-old-space-size-hint=8" })).toEqual([DEFAULT_FLAG]);
  });

  it("prefers the dedicated var over NODE_OPTIONS", () => {
    const flags = resolveHeapFlags({
      NINEROUTER_MAX_OLD_SPACE_SIZE: "512",
      NODE_OPTIONS: "--max-old-space-size=4096",
    });
    expect(flags).toEqual(["--max-old-space-size=512"]);
  });

  // A safety cap must not disappear because someone typed the value wrong.
  it("falls back to the default on a junk value, and says so", () => {
    for (const value of ["abc", "-1", "1.5", "512MB"]) {
      expect(resolveHeapFlags({ NINEROUTER_MAX_OLD_SPACE_SIZE: value }), value).toEqual([DEFAULT_FLAG]);
    }
    expect(warn).toHaveBeenCalledTimes(4);
    expect(warn.mock.calls[0][0]).toContain("NINEROUTER_MAX_OLD_SPACE_SIZE");
  });

  it("treats an empty or whitespace value as unset, without warning", () => {
    expect(resolveHeapFlags({ NINEROUTER_MAX_OLD_SPACE_SIZE: "   " })).toEqual([DEFAULT_FLAG]);
    expect(warn).not.toHaveBeenCalled();
  });
});
