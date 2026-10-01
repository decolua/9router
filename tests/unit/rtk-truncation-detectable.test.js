// Regression: RTK find / search-list / grep silently dropped paths once a
// per-dir or per-total cap was exceeded, replacing them with a bare "+N" that
// reads like a harmless summary. For a Claude Code agent that needs the FULL
// file set (Glob/Grep), an undetectable drop causes missed files and wrong
// answers. Each truncating filter must now emit a machine-detectable sentinel
// carrying the omitted and total counts.
import { describe, expect, it } from "vitest";
import { find } from "../../open-sse/rtk/filters/find.js";
import { searchList } from "../../open-sse/rtk/filters/searchList.js";
import { grep } from "../../open-sse/rtk/filters/grep.js";
import { tree } from "../../open-sse/rtk/filters/tree.js";
import { gitStatus } from "../../open-sse/rtk/filters/gitStatus.js";
import { gitLog } from "../../open-sse/rtk/filters/gitLog.js";
import { FIND_PER_DIR_MAX, GREP_PER_FILE_MAX, SEARCH_LIST_PER_DIR_MAX, TREE_MAX_LINES, STATUS_MAX_FILES, GIT_LOG_MAX_LINES } from "../../open-sse/rtk/constants.js";

const SENTINEL = /\[RTK-TRUNCATED filter=(\S+) omitted=(\d+) total=(\d+)\]/;

describe("RTK truncation is detectable", () => {
  it("find emits a sentinel with the omitted count when a dir overflows", () => {
    const n = FIND_PER_DIR_MAX + 5;
    const input = Array.from({ length: n }, (_, i) => `./src/f${i}.js`).join("\n");
    const out = find(input);
    const m = out.match(SENTINEL);
    expect(m).toBeTruthy();
    expect(m[1]).toBe("find");
    expect(Number(m[2])).toBe(5);
    expect(Number(m[3])).toBe(n);
  });

  it("find does not emit a sentinel when nothing is dropped", () => {
    const input = ["./src/a.js", "./src/b.js", "./src/c.js"].join("\n");
    expect(find(input)).not.toMatch(SENTINEL);
  });

  it("search-list emits a sentinel when a dir overflows", () => {
    const n = SEARCH_LIST_PER_DIR_MAX + 3;
    const paths = Array.from({ length: n }, (_, i) => `- src/a/f${i}.js`);
    const input = ["Result of search in '/x' (total " + n + " files):", ...paths].join("\n");
    const out = searchList(input);
    const m = out.match(SENTINEL);
    expect(m).toBeTruthy();
    expect(m[1]).toBe("search-list");
    expect(Number(m[2])).toBe(3);
  });

  it("grep emits a sentinel when a file overflows its match cap", () => {
    const n = GREP_PER_FILE_MAX + 7;
    const input = Array.from({ length: n }, (_, i) => `src/foo.js:${i + 1}:needle ${i}`).join("\n");
    const out = grep(input);
    const m = out.match(SENTINEL);
    expect(m).toBeTruthy();
    expect(m[1]).toBe("grep");
    expect(Number(m[2])).toBe(7);
  });

  it("tree, git-status and git-log also emit a sentinel when they drop data", () => {
    // tree: exceed TREE_MAX_LINES
    const treeOut = tree(Array.from({ length: TREE_MAX_LINES + 9 }, (_, i) => `├── f${i}`).join("\n"));
    expect(treeOut).toMatch(/\[RTK-TRUNCATED filter=tree/);

    // git-status: exceed the per-section file cap
    const statusLines = ["On branch main", "Changes to be committed:"];
    for (let i = 0; i < STATUS_MAX_FILES + 4; i++) statusLines.push(`\tnew file:   src/a${i}.js`);
    expect(gitStatus(statusLines.join("\n"))).toMatch(/\[RTK-TRUNCATED filter=git-status/);

    // git-log: exceed maxLines (default cap)
    const logInput = Array.from({ length: GIT_LOG_MAX_LINES + 30 }, (_, i) => `commit ${String(i).padStart(40, "0")}`).join("\n");
    expect(gitLog(logInput)).toMatch(/\[RTK-TRUNCATED filter=git-log/);
  });
});
