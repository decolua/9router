/**
 * BOARD-ID-001 — the JSONL board keeps intentional historical generations of the
 * same id, so an id-only "find the row and update it" helper silently rewrites the
 * wrong generation. On tick 336 the fleet's first-match helper completed
 * DF-9ROUTER-3 (line 73) and DF-9ROUTER-5 (line 75) instead of the live rows
 * (lines 96/98). The repository-owned remedy is `scripts/board-task.mjs`, which
 * refuses an id-only mutation whenever the id is not unique and requires an
 * explicit discriminator that narrows the match to exactly one row.
 *
 * Coverage, in two layers, both against the REAL implementation (imported and
 * spawned, never copied):
 *
 *  1. LIBRARY — `parseBoard` / `selectRow` / `mutateBoard` / `duplicatesReport`
 *     driven directly: ambiguous selection returns `ambiguous` without touching
 *     the file, a discriminator resolves to exactly one row, and an unparseable
 *     line fails closed.
 *
 *  2. SPAWN E2E — the real CLI (`node scripts/board-task.mjs`) against a temp
 *     board file, asserting exit codes (0 ok / 2 ambiguous / 3 not-found /
 *     4 usage / 5 invalid board), the printed competing-candidate list, and the
 *     byte-preservation contract: the target line is the ONLY line that differs,
 *     every other line (including the odd-spacing line) is byte-identical.
 *
 * The temp file is always passed via `--file`; the repo's live board is never
 * read or written by these tests.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXIT,
  applyAssignments,
  coerceValue,
  duplicatesReport,
  mutateBoard,
  parseAssignment,
  parseArgv,
  parseBoard,
  selectRow,
} from "../../scripts/board-task.mjs";

const SCRIPT = fileURLToPath(new URL("../../scripts/board-task.mjs", import.meta.url));

// Fixture line layout (1-based, mirrors the real board's mixed shapes):
//   1        UNIQ-001        single generation (no created_at/ts conflict)
//   2, 3     DUP-1           two generations, distinguished by created_at + title
//   4        ODD-1           odd spacing / key order — byte-preservation probe
//   5, 6     DUP-2           ts-only rows with IDENTICAL titles (ts is the only witness)
//   7, 8, 9  DUP-3           three generations (the DF-9ROUTER-1 shape)
const FIXTURE_LINES = [
  JSON.stringify({
    id: "UNIQ-001",
    status: "pending",
    worker_status: "pending",
    created_at: "2026-09-01 10:00:00.000000",
    title: "Unique row — one generation only",
  }),
  JSON.stringify({
    id: "DUP-1",
    status: "pending",
    worker_status: "pending",
    created_at: "2026-09-01 11:00:00.000000",
    title: "DUP-1 first generation — stale defect from cycle 1",
    detail: "stale detail",
  }),
  JSON.stringify({
    id: "DUP-1",
    status: "pending",
    worker_status: "pending",
    created_at: "2026-09-10 12:00:00.000000",
    title: "DUP-1 second generation — live defect from cycle 2",
    detail: "live detail",
  }),
  '{ "id" : "ODD-1", "status" : "pending",  "title": "Odd formatting line — extra spaces, different key order", "note": "\\u00e9" }',
  JSON.stringify({
    id: "DUP-2",
    status: "pending",
    ts: "2026-09-03T00:00:00.000Z",
    title: "shared ambiguous title",
    detail: "generation A",
  }),
  JSON.stringify({
    id: "DUP-2",
    status: "pending",
    ts: "2026-09-11T00:00:00.000Z",
    title: "shared ambiguous title",
    detail: "generation B",
  }),
  JSON.stringify({
    id: "DUP-3",
    status: "pending",
    ts: "2026-09-01T04:24:50.523Z",
    title: "DUP-3 generation one",
  }),
  JSON.stringify({
    id: "DUP-3",
    status: "pending",
    ts: "2026-09-04T04:46:31.406Z",
    title: "DUP-3 generation two",
  }),
  JSON.stringify({
    id: "DUP-3",
    status: "pending",
    ts: "2026-09-07T05:49:28.558Z",
    title: "DUP-3 generation three",
  }),
];

const FIXTURE_TEXT = `${FIXTURE_LINES.join("\n")}\n`;

let workDir;
let boardFile;

function readRawLines(file) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines;
}

function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

/** The byte-preservation contract: only `lineNumber` (1-based) may differ. */
function expectOnlyLineChanged(before, after, lineNumber, { changed = true } = {}) {
  expect(after.length).toBe(before.length);
  before.forEach((raw, index) => {
    const line = index + 1;
    if (line === lineNumber) {
      if (changed) expect(after[index]).not.toBe(raw);
      else expect(after[index]).toBe(raw);
    } else {
      expect(after[index]).toBe(raw);
    }
  });
}

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "board-task-guard-"));
  boardFile = path.join(workDir, "tasks.jsonl");
  fs.writeFileSync(boardFile, FIXTURE_TEXT, "utf8");
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("board-task guard — library", () => {
  it("parseBoard keeps file order, real raw bytes and the trailing-newline flag", () => {
    const board = parseBoard(FIXTURE_TEXT);
    expect(board.terminator).toBe(true);
    expect(board.rows).toHaveLength(FIXTURE_LINES.length);
    expect(board.rows.map((row) => row.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(board.rows[3].raw).toBe(FIXTURE_LINES[3]);
    expect(board.rows.every((row) => row.parseError === null)).toBe(true);
  });

  it("selectRow refuses an ID-only match on a duplicated id and lists every competing generation", () => {
    const board = parseBoard(FIXTURE_TEXT);
    const selection = selectRow(board.rows, { id: "DUP-1" });
    expect(selection.status).toBe("ambiguous");
    expect(selection.candidates.map((row) => row.line)).toEqual([2, 3]);
    expect(selection.reason).toContain("refusing an ID-only mutation");
  });

  it("selectRow resolves a unique id with no discriminator (unique-id compatibility)", () => {
    const board = parseBoard(FIXTURE_TEXT);
    const selection = selectRow(board.rows, { id: "UNIQ-001" });
    expect(selection.status).toBe("resolved");
    expect(selection.target.line).toBe(1);
  });

  it("selectRow resolves each of three generations to a distinct row via its own witness", () => {
    const board = parseBoard(FIXTURE_TEXT);
    for (const [ts, line] of [
      ["2026-09-01T04:24:50.523Z", 7],
      ["2026-09-04T04:46:31.406Z", 8],
      ["2026-09-07T05:49:28.558Z", 9],
    ]) {
      const selection = selectRow(board.rows, { id: "DUP-3", ts });
      expect(selection.status).toBe("resolved");
      expect(selection.target.line).toBe(line);
    }
  });

  it("does not fall back to the LAST match when no discriminator is given", () => {
    const board = parseBoard(FIXTURE_TEXT);
    const selection = selectRow(board.rows, { id: "DUP-3" });
    expect(selection.status).toBe("ambiguous");
    expect(selection.candidates).toHaveLength(3);
  });

  it("mutateBoard refuses without writing, then updates exactly one row when given a witness", () => {
    const before = fs.readFileSync(boardFile, "utf8");

    const refused = mutateBoard({ file: boardFile, criteria: { id: "DUP-1" }, assignments: [{ key: "status", value: "complete" }] });
    expect(refused.status).toBe("ambiguous");
    expect(fs.readFileSync(boardFile, "utf8")).toBe(before);

    const applied = mutateBoard({
      file: boardFile,
      criteria: { id: "DUP-1", createdAt: "2026-09-10 12:00:00.000000" },
      assignments: [{ key: "status", value: "complete" }],
    });
    expect(applied.status).toBe("updated");
    expect(applied.target.line).toBe(3);
    expect(applied.changed).toEqual([{ key: "status", from: "pending", to: "complete" }]);
    expectOnlyLineChanged(FIXTURE_LINES, readRawLines(boardFile), 3);
  });

  it("fails closed on an unparseable board line (uniqueness is undecidable)", () => {
    fs.appendFileSync(boardFile, '{"id":"DUP-1","status":"pending"\n', "utf8");
    const before = fs.readFileSync(boardFile, "utf8");
    const result = mutateBoard({ file: boardFile, criteria: { id: "DUP-1", line: 2 }, assignments: [{ key: "status", value: "complete" }] });
    expect(result.status).toBe("invalid_board");
    expect(result.reason).toContain("do not parse as JSON");
    expect(fs.readFileSync(boardFile, "utf8")).toBe(before);
  });

  it("coerces JSON literals and keeps quoted values as strings", () => {
    expect(coerceValue("3")).toBe(3);
    expect(coerceValue("true")).toBe(true);
    expect(coerceValue("null")).toBe(null);
    expect(coerceValue('"3"')).toBe("3");
    expect(coerceValue("abc123")).toBe("abc123");
    expect(coerceValue("2026-09-10 12:00:00.000000")).toBe("2026-09-10 12:00:00.000000");
    expect(applyAssignments({ id: "X" }, [{ key: "attempts", value: 3 }])).toEqual({ id: "X", attempts: 3 });
  });

  it("refuses to mutate the identity field and rejects malformed --set tokens", () => {
    expect(parseAssignment("id=OTHER").error).toContain("refusing to set \"id\"");
    expect(parseAssignment("status").error).toContain("expected key=value");
    expect(parseAssignment("=v").error).toContain("expected key=value");
    expect(parseAssignment("status=complete")).toEqual({ key: "status", value: "complete" });
  });

  it("parseArgv accepts both --flag value and --flag=value and rejects unknown flags", () => {
    const spaced = parseArgv(["update", "--id", "DUP-1", "--ts", "T", "--set", "status=complete"]);
    expect(spaced.options.id).toBe("DUP-1");
    expect(spaced.options.sets).toEqual([{ key: "status", value: "complete" }]);

    const equals = parseArgv(["update", "--id=DUP-1", "--set=status=complete"]);
    expect(equals.options.id).toBe("DUP-1");
    expect(equals.options.sets).toEqual([{ key: "status", value: "complete" }]);

    expect(parseArgv(["update", "--nope", "1"]).error).toContain("unknown option --nope");
  });

  it("duplicatesReport flags every multi-generation id and only those", () => {
    const report = duplicatesReport(parseBoard(FIXTURE_TEXT).rows);
    expect(report.idsWithDuplicates).toBe(3);
    expect(report.duplicateIds.map((entry) => entry.id).sort()).toEqual(["DUP-1", "DUP-2", "DUP-3"]);
    expect(report.duplicateIds.find((entry) => entry.id === "DUP-1").lines).toEqual([2, 3]);
    expect(report.duplicateIds.find((entry) => entry.id === "DUP-3").count).toBe(3);
    expect(report.duplicateIds.some((entry) => entry.id === "UNIQ-001" || entry.id === "ODD-1")).toBe(false);
  });
});

describe("board-task guard — CLI (exit codes + byte preservation)", () => {
  it("refuses an ID-only update on a duplicated id: exit 2, candidates printed, file untouched", () => {
    const before = fs.readFileSync(boardFile, "utf8");
    const run = runCli(["update", "--id", "DUP-1", "--set", "status=complete", "--file", boardFile]);

    expect(run.status).toBe(EXIT.AMBIGUOUS);
    expect(run.stderr).toContain("refusing an ID-only mutation");
    expect(run.stderr).toContain("COMPETING CANDIDATES (2)");
    expect(run.stderr).toContain("line 2");
    expect(run.stderr).toContain("line 3");
    expect(run.stderr).toContain("stale defect from cycle 1");
    expect(run.stderr).toContain("live defect from cycle 2");
    expect(run.stderr).toContain("NO FILE WAS MODIFIED");
    expect(fs.readFileSync(boardFile, "utf8")).toBe(before);
  });

  it("refuses when the discriminator still matches more than one generation", () => {
    const before = fs.readFileSync(boardFile, "utf8");
    const run = runCli(["update", "--id", "DUP-2", "--title-contains", "shared ambiguous title", "--set", "status=complete", "--file", boardFile]);

    expect(run.status).toBe(EXIT.AMBIGUOUS);
    expect(run.stderr).toContain("still matches 2 rows");
    expect(run.stderr).toContain("line 5");
    expect(run.stderr).toContain("line 6");
    expect(fs.readFileSync(boardFile, "utf8")).toBe(before);
  });

  it("resolves identical-title generations by their ts witness", () => {
    const run = runCli([
      "update",
      "--id",
      "DUP-2",
      "--ts",
      "2026-09-11T00:00:00.000Z",
      "--set",
      "status=complete",
      "--file",
      boardFile,
    ]);

    expect(run.status).toBe(EXIT.OK);
    expect(run.stdout).toContain("UPDATED id=DUP-2 line=6");
    expectOnlyLineChanged(FIXTURE_LINES, readRawLines(boardFile), 6);
  });

  it("updates exactly the intended generation with --created-at and leaves the sibling generation alone", () => {
    const run = runCli([
      "update",
      "--id",
      "DUP-1",
      "--created-at",
      "2026-09-01 11:00:00.000000",
      "--set",
      "status=complete",
      "--set",
      "worker_status=complete",
      "--file",
      boardFile,
    ]);

    expect(run.status).toBe(EXIT.OK);
    expect(run.stdout).toContain("UPDATED id=DUP-1 line=2");
    const after = readRawLines(boardFile);
    expectOnlyLineChanged(FIXTURE_LINES, after, 2);
    expect(JSON.parse(after[1]).status).toBe("complete");
    expect(JSON.parse(after[2]).status).toBe("pending");
    expect(JSON.parse(after[2]).title).toBe("DUP-1 second generation — live defect from cycle 2");
  });

  it("updates exactly the intended generation with --line and never another row", () => {
    const run = runCli(["update", "--id", "DUP-3", "--line", "8", "--set", "status=complete", "--file", boardFile]);
    expect(run.status).toBe(EXIT.OK);
    expect(run.stdout).toContain("UPDATED id=DUP-3 line=8");
    const after = readRawLines(boardFile);
    expectOnlyLineChanged(FIXTURE_LINES, after, 8);
    expect(JSON.parse(after[6]).status).toBe("pending");
    expect(JSON.parse(after[8]).status).toBe("pending");
    // The odd-spacing line is byte-identical, raw formatting included.
    expect(after[3]).toBe(FIXTURE_LINES[3]);
  });

  it("does not let --line point at a different id's row", () => {
    const before = fs.readFileSync(boardFile, "utf8");
    const run = runCli(["update", "--id", "DUP-1", "--line", "6", "--set", "status=complete", "--file", boardFile]);
    expect(run.status).toBe(EXIT.NOT_FOUND);
    expect(run.stderr).toContain('not id "DUP-1"');
    expect(fs.readFileSync(boardFile, "utf8")).toBe(before);
  });

  it("keeps unique-id behavior working with no discriminator", () => {
    const run = runCli(["update", "--id", "UNIQ-001", "--set", "status=complete", "--set", "commit_hash=abc123", "--file", boardFile]);
    expect(run.status).toBe(EXIT.OK);
    expect(run.stdout).toContain("UPDATED id=UNIQ-001 line=1");
    const after = readRawLines(boardFile);
    expectOnlyLineChanged(FIXTURE_LINES, after, 1);
    const row = JSON.parse(after[0]);
    expect(row.status).toBe("complete");
    expect(row.commit_hash).toBe("abc123");
    expect(typeof row.commit_hash).toBe("string");
  });

  it("stores JSON literals typed (--set attempts=3 is a number)", () => {
    const run = runCli(["update", "--id", "UNIQ-001", "--set", "attempts=3", "--file", boardFile]);
    expect(run.status).toBe(EXIT.OK);
    expect(JSON.parse(readRawLines(boardFile)[0]).attempts).toBe(3);
  });

  it("exits 3 and writes nothing for an unknown id", () => {
    const before = fs.readFileSync(boardFile, "utf8");
    const run = runCli(["update", "--id", "NOPE-999", "--set", "status=complete", "--file", boardFile]);
    expect(run.status).toBe(EXIT.NOT_FOUND);
    expect(run.stderr).toContain('no board row has id "NOPE-999"');
    expect(fs.readFileSync(boardFile, "utf8")).toBe(before);
  });

  it("exits 3 and lists the real candidates when a discriminator matches none of them", () => {
    const before = fs.readFileSync(boardFile, "utf8");
    const run = runCli(["update", "--id", "DUP-1", "--created-at", "1999-01-01 00:00:00.000000", "--set", "status=complete", "--file", boardFile]);
    expect(run.status).toBe(EXIT.NOT_FOUND);
    expect(run.stderr).toContain("matches 2 row(s), but none of them match");
    expect(run.stderr).toContain("line 2");
    expect(run.stderr).toContain("line 3");
    expect(fs.readFileSync(boardFile, "utf8")).toBe(before);
  });

  it("--dry-run reports the exact target and writes nothing", () => {
    const before = fs.readFileSync(boardFile, "utf8");
    const run = runCli(["update", "--id", "DUP-3", "--ts", "2026-09-04T04:46:31.406Z", "--set", "status=complete", "--dry-run", "--file", boardFile]);
    expect(run.status).toBe(EXIT.OK);
    expect(run.stdout).toContain("WOULD UPDATE id=DUP-3 line=8");
    expect(fs.readFileSync(boardFile, "utf8")).toBe(before);
  });

  it("is idempotent: re-running the same update reports NO CHANGE and rewrites nothing", () => {
    expect(runCli(["update", "--id", "DUP-3", "--line", "9", "--set", "status=complete", "--file", boardFile]).status).toBe(EXIT.OK);
    const afterFirst = fs.readFileSync(boardFile, "utf8");
    const rerun = runCli(["update", "--id", "DUP-3", "--line", "9", "--set", "status=complete", "--file", boardFile]);
    expect(rerun.status).toBe(EXIT.OK);
    expect(rerun.stdout).toContain("NO CHANGE");
    expect(fs.readFileSync(boardFile, "utf8")).toBe(afterFirst);
  });

  it("exits 4 for a missing --set and for --set id=…", () => {
    const before = fs.readFileSync(boardFile, "utf8");
    const noSet = runCli(["update", "--id", "UNIQ-001", "--file", boardFile]);
    expect(noSet.status).toBe(EXIT.USAGE);
    expect(noSet.stderr).toContain("at least one --set");

    const idSet = runCli(["update", "--id", "DUP-1", "--line", "2", "--set", "id=RENAMED", "--file", boardFile]);
    expect(idSet.status).toBe(EXIT.USAGE);
    expect(idSet.stderr).toContain("refusing to set");
    expect(fs.readFileSync(boardFile, "utf8")).toBe(before);
  });

  it("exits 5 and writes nothing when the board holds an unparseable line", () => {
    fs.appendFileSync(boardFile, '{"id":\n', "utf8");
    const before = fs.readFileSync(boardFile, "utf8");
    const run = runCli(["update", "--id", "DUP-1", "--line", "2", "--set", "status=complete", "--file", boardFile]);
    expect(run.status).toBe(EXIT.INVALID_BOARD);
    expect(run.stderr).toContain("do not parse as JSON");
    expect(fs.readFileSync(boardFile, "utf8")).toBe(before);
  });

  it("resolve is read-only and reports ambiguity as JSON for tooling", () => {
    const before = fs.readFileSync(boardFile, "utf8");
    const ambiguous = runCli(["resolve", "--id", "DUP-1", "--json", "--file", boardFile]);
    expect(ambiguous.status).toBe(EXIT.AMBIGUOUS);
    const payload = JSON.parse(ambiguous.stdout);
    expect(payload.status).toBe("ambiguous");
    expect(payload.candidates.map((row) => row.line)).toEqual([2, 3]);

    const resolved = runCli(["resolve", "--id", "DUP-1", "--line", "3", "--json", "--file", boardFile]);
    expect(resolved.status).toBe(EXIT.OK);
    expect(JSON.parse(resolved.stdout).line).toBe(3);
    expect(fs.readFileSync(boardFile, "utf8")).toBe(before);
  });

  it("duplicates reports the multi-generation ids and can fail a gate", () => {
    const report = runCli(["duplicates", "--json", "--file", boardFile]);
    expect(report.status).toBe(EXIT.OK);
    expect(JSON.parse(report.stdout).idsWithDuplicates).toBe(3);

    const gated = runCli(["duplicates", "--fail-on-duplicate", "--file", boardFile]);
    expect(gated.status).toBe(EXIT.AMBIGUOUS);
  });

  it("help documents the duplicate-id refusal, the discriminators and the safe invocation", () => {
    const run = runCli(["--help"]);
    expect(run.status).toBe(EXIT.OK);
    expect(run.stdout).toContain("refuses that");
    expect(run.stdout).toContain("--created-at VALUE");
    expect(run.stdout).toContain("--line N");
    expect(run.stdout).toContain("An id that matches exactly one row still updates with no discriminator");
    expect(run.stdout).toContain("Historical duplicate rows are never");
  });
});
