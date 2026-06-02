import { describe, expect, it, vi } from "vitest";
import { writeJsonFileAtomically } from "../../open-sse/utils/atomicWrite.js";

function enoent(path) {
  const error = new Error(`ENOENT: ${path}`);
  error.code = "ENOENT";
  return error;
}

describe("writeJsonFileAtomically", () => {
  it("falls back to backup replace when Windows rename cannot overwrite an existing file", async () => {
    const target = "C:\\cache\\param_fixes.json";
    const files = new Map([[target, "{\"old\":true}"]]);
    const renameCalls = [];

    const fsApi = {
      writeFile: vi.fn(async (path, content) => {
        files.set(path, content);
      }),
      rename: vi.fn(async (from, to) => {
        renameCalls.push([from, to]);
        if (from.endsWith(".tmp") && to === target && files.has(target)) {
          const error = new Error("destination exists");
          error.code = "EEXIST";
          throw error;
        }
        if (!files.has(from)) throw enoent(from);
        files.set(to, files.get(from));
        files.delete(from);
      }),
      rm: vi.fn(async (path) => {
        files.delete(path);
      })
    };

    await writeJsonFileAtomically(fsApi, target, { next: true }, {
      platform: "win32",
      pid: 123,
      now: () => 456,
      random: () => 0.5
    });

    expect(JSON.parse(files.get(target))).toEqual({ next: true });
    expect([...files.keys()]).toEqual([target]);
    expect(renameCalls).toEqual([
      [`${target}.123.456.i.tmp`, target],
      [target, `${target}.123.456.i.bak`],
      [`${target}.123.456.i.tmp`, target]
    ]);
  });
});
