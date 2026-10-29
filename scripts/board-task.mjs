#!/usr/bin/env node
/**
 * board-task.mjs — the repository-owned, fail-closed mutation helper for the
 * JSONL-canonical task board (`.coding-hermes/board/tasks.jsonl`).
 *
 * WHY THIS EXISTS
 * ---------------
 * The board is append-only JSONL and intentionally keeps several historical
 * GENERATIONS of the same id: `DF-9ROUTER-1` exists at three lines with three
 * different meanings (one per dogfood cycle) and `QA-9ROUTER-1` is filed once
 * per QA cycle. An id-only "find the row and complete it" helper resolves the
 * FIRST line that matches, so completing today's generation rewrites a defect
 * row from a cycle ago. That is not hypothetical: on tick 336 the fleet's
 * `append_board_task_completed.py` wrongly completed `DF-9ROUTER-3` (line 73,
 * "npm run cli:pack fails — esbuild") and `DF-9ROUTER-5` (line 75,
 * "REQUIRE_API_KEY ignored") while the live rows (lines 96/98) stayed pending.
 * See row `BOARD-ID-001` (`.coding-hermes/board/tasks.jsonl`) for the incident
 * record and the mitigation options.
 *
 * WHAT IT REFUSES
 * ---------------
 *   * An id-only mutation when the id is not unique: it aborts (exit 2) and
 *     prints every competing candidate, including line number, status,
 *     created_at, ts and title, plus the discriminators that would disambiguate.
 *     It never falls back to first-match — and it never quietly falls back to
 *     LAST match either, because "last" is still a guess when generations are
 *     not monotonic.
 *   * A mutation whose discriminator still matches more than one row (exit 2).
 *   * A mutation that matches no row, or a `--line` that belongs to a different
 *     id (exit 3).
 *   * Any rewrite of a board that contains a line that does not parse as JSON
 *     (exit 5): the file is rewritten whole, and an unparseable line could
 *     itself be another generation of the id, so uniqueness would be undecidable.
 *   * `--set id=...` (exit 4): the id is the identity being resolved; re-idding
 *     a historical generation is a separate, explicit operation, never a side
 *     effect of an update.
 *
 * WHAT IT GUARANTEES
 * ------------------
 *   * Byte preservation: the target line is the ONLY line re-serialized. Every
 *     other line (including odd whitespace, key order and unicode escapes) is
 *     copied verbatim, and the invariant is asserted in-process before the write.
 *   * Atomic replacement (temp file + rename in the same directory).
 *   * Unique-id compatibility: an id that matches exactly one row still updates
 *     without any discriminator, so existing single-generation usage keeps working.
 *   * Determinism: no implicit timestamps. `updated_at`/`completed_at` are set
 *     only when the caller passes them via `--set`.
 *
 * USAGE
 * -----
 *   node scripts/board-task.mjs duplicates [--file F] [--json] [--fail-on-duplicate]
 *   node scripts/board-task.mjs resolve --id ID [discriminator] [--json]
 *   node scripts/board-task.mjs update  --id ID [discriminator] --set k=v [--set k=v] [--dry-run]
 *
 *   Discriminators (ANDed when several are given):
 *     --line N                exact 1-based physical line number (row identity)
 *     --created-at VALUE      exact `created_at` match; `null`/`-` matches rows where it is absent
 *     --ts VALUE              exact `ts` match; `null`/`-` matches rows where it is absent
 *     --title-contains TEXT   substring of `title`
 *     --detail-contains TEXT  substring of `detail`
 *
 *   Example — complete ONE intended generation of a duplicated id:
 *     node scripts/board-task.mjs update --id DF-9ROUTER-1 \
 *       --ts 2026-09-13T13:10:59.889Z \
 *       --set status=complete --set worker_status=complete
 *
 * EXIT CODES
 * ----------
 *   0 ok (updated / would-update / no_change / resolved / report)
 *   2 ambiguous — refused, competing candidates printed, nothing written
 *   3 not found — the id or discriminator matched no row, nothing written
 *   4 usage error (bad flags, missing --set, --set id=…)
 *   5 invalid board — a line does not parse as JSON, or an internal invariant failed
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_BOARD_FILE = path.join(REPO_ROOT, ".coding-hermes", "board", "tasks.jsonl");

/** Stable exit codes — scripts and the foreman branch on these. */
export const EXIT = Object.freeze({
  OK: 0,
  AMBIGUOUS: 2,
  NOT_FOUND: 3,
  USAGE: 4,
  INVALID_BOARD: 5,
});

/** The fields that may be used to select one generation of a duplicated id. */
export const DISCRIMINATORS = ["line", "createdAt", "ts", "titleContains", "detailContains"];

const TITLE_PREVIEW = 96;

/** Parse the raw JSONL text into addressable rows, remembering the terminator. */
export function parseBoard(text) {
  const terminator = text.endsWith("\n");
  const rawLines = text.split("\n");
  if (terminator) rawLines.pop();
  const rows = rawLines.map((line, index) => {
    const entry = {
      line: index + 1,
      raw: line,
      blank: line.trim() === "",
      data: null,
      parseError: null,
    };
    if (!entry.blank) {
      try {
        entry.data = JSON.parse(line);
      } catch (error) {
        entry.parseError = error instanceof Error ? error.message : String(error);
      }
    }
    return entry;
  });
  return { rows, terminator };
}

/** Rows whose `id` equals the requested id (order = file order). */
export function matchingId(rows, id) {
  return rows.filter((row) => row.data !== null && row.data.id === id);
}

/** `null` / `-` matches an absent-or-null field; anything else is an exact string match. */
function fieldMatches(value, wanted) {
  if (wanted === "null" || wanted === "-") return value === null || value === undefined;
  if (value === null || value === undefined) return false;
  return String(value) === wanted;
}

function containsCaseSensitive(value, needle) {
  return String(value === null || value === undefined ? "" : value).includes(needle);
}

/** Human-readable one-liner for a candidate row (used in refusals). */
export function describeRow(row) {
  const data = row.data || {};
  const title = data.title === undefined || data.title === null ? "" : String(data.title);
  const preview = title.length > TITLE_PREVIEW ? `${title.slice(0, TITLE_PREVIEW - 1)}…` : title;
  return [
    `line ${row.line}`,
    `status=${data.status === undefined ? "?" : data.status}`,
    `created_at=${data.created_at === null || data.created_at === undefined ? "-" : data.created_at}`,
    `ts=${data.ts === null || data.ts === undefined ? "-" : data.ts}`,
    `id=${data.id === undefined ? "?" : data.id}`,
    `title=${preview}`,
  ].join(" | ");
}

/** Which discriminators the caller actually supplied (for messages + JSON output). */
export function appliedDiscriminators(criteria) {
  const applied = [];
  if (criteria.line !== undefined) applied.push(`--line ${criteria.line}`);
  if (criteria.createdAt !== undefined) applied.push(`--created-at ${criteria.createdAt}`);
  if (criteria.ts !== undefined) applied.push(`--ts ${criteria.ts}`);
  if (criteria.titleContains !== undefined) applied.push(`--title-contains ${criteria.titleContains}`);
  if (criteria.detailContains !== undefined) applied.push(`--detail-contains ${criteria.detailContains}`);
  return applied;
}

/**
 * Resolve a (id, discriminator) pair to at most one row.
 * Returns one of: usage | invalid_board | not_found | ambiguous | resolved.
 * Nothing here writes — `mutateBoard` is the only writer.
 */
export function selectRow(rows, criteria) {
  const id = criteria.id;
  if (id === undefined || id === null || String(id) === "") {
    return { status: "usage", reason: "missing required --id" };
  }

  const broken = rows.filter((row) => row.parseError !== null);
  if (broken.length > 0) {
    return {
      status: "invalid_board",
      broken,
      reason:
        `${broken.length} board line(s) do not parse as JSON (first: line ${broken[0].line}: ` +
        `${broken[0].parseError}) — the guard rewrites the file whole, so an unparseable line could itself be ` +
        "another generation of the id; repair the line before mutating the board",
    };
  }

  const byId = matchingId(rows, id);
  const applied = appliedDiscriminators(criteria);
  const filters = [];

  if (criteria.line !== undefined) {
    const wanted = Number(criteria.line);
    if (!Number.isInteger(wanted) || wanted < 1) {
      return { status: "usage", reason: `--line must be a positive integer (got ${JSON.stringify(criteria.line)})` };
    }
    const row = rows[wanted - 1];
    if (row === undefined) {
      return { status: "not_found", candidates: byId, applied, reason: `line ${wanted} is past the end of the board (${rows.length} lines)` };
    }
    if (row.data === null || row.data.id !== id) {
      const actual = row.data === null ? "a blank/unparseable line" : `id "${row.data.id}"`;
      return { status: "not_found", candidates: byId, applied, reason: `line ${wanted} is not id "${id}" — it is ${actual}` };
    }
    filters.push((row) => row.line === wanted);
  }
  if (criteria.createdAt !== undefined) filters.push((row) => fieldMatches(row.data.created_at, criteria.createdAt));
  if (criteria.ts !== undefined) filters.push((row) => fieldMatches(row.data.ts, criteria.ts));
  if (criteria.titleContains !== undefined) filters.push((row) => containsCaseSensitive(row.data.title, criteria.titleContains));
  if (criteria.detailContains !== undefined) filters.push((row) => containsCaseSensitive(row.data.detail, criteria.detailContains));

  if (byId.length === 0) {
    return { status: "not_found", candidates: byId, applied, reason: `no board row has id "${id}"` };
  }

  const survivors = byId.filter((row) => filters.every((filter) => filter(row)));

  if (survivors.length === 0) {
    return {
      status: "not_found",
      candidates: byId,
      applied,
      reason: `id "${id}" matches ${byId.length} row(s), but none of them match ${applied.join(", ")}`,
    };
  }

  if (survivors.length > 1) {
    return {
      status: "ambiguous",
      candidates: survivors,
      considered: byId,
      applied,
      reason:
        applied.length === 0
          ? `id "${id}" matches ${byId.length} rows and no discriminator was given — refusing an ID-only mutation`
          : `id "${id}" still matches ${survivors.length} rows after ${applied.join(", ")}`,
    };
  }

  return { status: "resolved", target: survivors[0], candidates: byId, applied };
}

/** `--set key=value` → typed assignment. Quoted values stay strings. */
export function parseAssignment(token) {
  const eq = token.indexOf("=");
  if (eq <= 0) return { error: `invalid --set "${token}": expected key=value` };
  const key = token.slice(0, eq);
  const raw = token.slice(eq + 1);
  if (key === "id") {
    return { error: "refusing to set \"id\": the id is the identity being resolved; re-idding a generation is a separate explicit operation" };
  }
  return { key, value: coerceValue(raw) };
}

/** JSON literals (numbers, booleans, null, arrays, objects) are stored typed; a quoted JSON string stays a string; everything else is the literal text. */
export function coerceValue(raw) {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "string") return parsed;
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) return parsed;
  } catch {
    /* not JSON — keep the literal string */
  }
  return raw;
}

/** Apply `--set` assignments to a row object (shallow copy; key order preserved for untouched keys). */
export function applyAssignments(data, assignments) {
  const next = { ...data };
  for (const assignment of assignments) next[assignment.key] = assignment.value;
  return next;
}

/** Field-level diff for reporting (from → to). */
export function diffFields(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes = [];
  for (const key of keys) {
    const from = before[key];
    const to = after[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) changes.push({ key, from, to });
  }
  return changes;
}

/** Per-id generation report (read-only helper for foremen and CI). */
export function duplicatesReport(rows) {
  const byId = new Map();
  for (const row of rows) {
    if (row.data === null) continue;
    const id = row.data.id;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(row);
  }
  const duplicateIds = [...byId.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([id, group]) => ({
      id,
      count: group.length,
      lines: group.map((row) => row.line),
      entries: group.map((row) => ({
        line: row.line,
        status: row.data.status,
        created_at: row.data.created_at ?? null,
        ts: row.data.ts ?? null,
        title: row.data.title ?? null,
      })),
    }));
  return { duplicateIds, idsWithDuplicates: duplicateIds.length, rows: rows.filter((row) => row.data !== null).length };
}

/**
 * Resolve, then (unless `dryRun`) rewrite exactly the target line.
 * Never writes when the resolution is not exactly one row.
 */
export function mutateBoard({ file, criteria, assignments, dryRun = false }) {
  const text = fs.readFileSync(file, "utf8");
  const board = parseBoard(text);
  const selection = selectRow(board.rows, criteria);
  if (selection.status !== "resolved") return { ...selection, file };

  const target = selection.target;
  const nextData = applyAssignments(target.data, assignments);
  const nextLine = JSON.stringify(nextData);

  if (nextLine === JSON.stringify(target.data)) {
    return { status: "no_change", file, target, candidates: selection.candidates, applied: selection.applied, changed: [] };
  }

  const outLines = board.rows.map((row) => (row.line === target.line ? nextLine : row.raw));
  // Structural byte-preservation invariant: nothing but the target line may move.
  for (let i = 0; i < board.rows.length; i += 1) {
    if (board.rows[i].line !== target.line && outLines[i] !== board.rows[i].raw) {
      throw new Error(`internal invariant violated: line ${board.rows[i].line} would be rewritten`);
    }
  }
  const content = outLines.join("\n") + (board.terminator ? "\n" : "");

  if (!dryRun) {
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, file);
  }

  return {
    status: dryRun ? "would_update" : "updated",
    file,
    target,
    candidates: selection.candidates,
    applied: selection.applied,
    changed: diffFields(target.data, nextData),
    untouched: board.rows.length - 1,
    bytesBefore: Buffer.byteLength(text),
    bytesAfter: Buffer.byteLength(content),
  };
}

const HELP = `board-task.mjs — safe, fail-closed mutation for .coding-hermes/board/tasks.jsonl

The board keeps intentional historical generations of the same id (e.g. DF-9ROUTER-1
exists at three lines with three different meanings; QA-9ROUTER-1 is filed once per
QA cycle). An id-only "complete the first matching row" mutation therefore rewrites
an unrelated historical generation. This helper refuses that: when an id is not
unique it aborts with the competing candidates and requires an explicit
discriminator that narrows the match to exactly one row.

COMMANDS
  duplicates [--json] [--fail-on-duplicate]
      Read-only report of every id with more than one generation.
  resolve --id ID [discriminator] [--json]
      Read-only: which row would be selected (or why it is ambiguous).
  update --id ID [discriminator] --set key=value [--set key=value] [--dry-run] [--json]
      Rewrite exactly one line; every other line is copied byte-for-byte.

DISCRIMINATORS (ANDed when several are supplied)
  --line N                 exact 1-based physical line number (row identity)
  --created-at VALUE       exact created_at match; "null" or "-" matches rows where it is absent
  --ts VALUE               exact ts match; "null" or "-" matches rows where it is absent
  --title-contains TEXT    title substring (case-sensitive)
  --detail-contains TEXT   detail substring (case-sensitive)

OPTIONS
  --file PATH    board file (default: .coding-hermes/board/tasks.jsonl)
  --dry-run      resolve and report, write nothing
  --json         machine-readable output

EXIT CODES
  0 ok   2 ambiguous (refused, nothing written)   3 not found (nothing written)
  4 usage error   5 invalid board (unparseable line / invariant failure)

COMPATIBILITY
  An id that matches exactly one row still updates with no discriminator, so
  single-generation usage is unchanged. Historical duplicate rows are never
  renumbered, merged or rewritten by this tool.

EXAMPLES
  node scripts/board-task.mjs duplicates
  node scripts/board-task.mjs update --id DF-9ROUTER-1 --ts 2026-09-13T13:10:59.889Z \\
      --set status=complete --set worker_status=complete
  node scripts/board-task.mjs update --id QA-9ROUTER-1 --line 100 --dry-run --set status=complete
  node scripts/board-task.mjs resolve --id QA-9ROUTER-1 --title-contains 'not registered'
`;

/** Parse argv into { command, options }. Supports `--flag value` and `--flag=value`. */
export function parseArgv(argv) {
  const options = { sets: [] };
  const positional = [];
  const withValue = new Set([
    "file",
    "id",
    "line",
    "created-at",
    "ts",
    "title-contains",
    "detail-contains",
    "set",
  ]);
  const flags = new Set(["json", "dry-run", "fail-on-duplicate", "help", "h"]);

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    const name = (eq === -1 ? token.slice(2) : token.slice(2, eq)).trim();
    if (flags.has(name)) {
      options[name] = true;
      continue;
    }
    if (!withValue.has(name)) return { error: `unknown option --${name}` };
    let value;
    if (eq !== -1) value = token.slice(eq + 1);
    else {
      value = argv[i + 1];
      i += 1;
    }
    if (value === undefined) return { error: `--${name} requires a value` };
    if (name === "set") {
      const assignment = parseAssignment(value);
      if (assignment.error) return { error: assignment.error };
      options.sets.push(assignment);
    } else {
      options[name] = value;
    }
  }
  return { command: positional[0], positional, options };
}

function criteriaFrom(options) {
  const criteria = { id: options.id };
  if (options.line !== undefined) criteria.line = options.line;
  if (options["created-at"] !== undefined) criteria.createdAt = options["created-at"];
  if (options.ts !== undefined) criteria.ts = options.ts;
  if (options["title-contains"] !== undefined) criteria.titleContains = options["title-contains"];
  if (options["detail-contains"] !== undefined) criteria.detailContains = options["detail-contains"];
  return criteria;
}

function emit(json, payload, text) {
  if (json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else process.stdout.write(`${text}\n`);
}

function reportRefusal(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stderr.write(`ERROR: ${result.reason}\n`);
    const candidates = result.candidates || result.broken || [];
    if (candidates.length > 0) {
      process.stderr.write(`COMPETING CANDIDATES (${candidates.length}):\n`);
      for (const row of candidates) {
        process.stderr.write(`  ${row.parseError ? `line ${row.line} | unparseable: ${row.parseError}` : describeRow(row)}\n`);
      }
    }
    if (result.status === "ambiguous") {
      process.stderr.write(
        "HINT: select exactly one row with --line <N>, --created-at <value>, --ts <value>, " +
          "--title-contains <substr> or --detail-contains <substr>.\n",
      );
    }
    process.stderr.write("NO FILE WAS MODIFIED\n");
  }
  return exitForStatus(result.status);
}

/** Map a non-resolved status onto its exit code. */
export function exitForStatus(status) {
  if (status === "ambiguous") return EXIT.AMBIGUOUS;
  if (status === "not_found") return EXIT.NOT_FOUND;
  if (status === "invalid_board") return EXIT.INVALID_BOARD;
  return EXIT.USAGE;
}

/** CLI entry point. Returns the process exit code. */
export function main(argv) {
  const { command, options, error } = parseArgv(argv);
  if (error) {
    process.stderr.write(`ERROR: ${error}\n${HELP}`);
    return EXIT.USAGE;
  }
  if (options.help || options.h || command === undefined || command === "help") {
    process.stdout.write(HELP);
    return EXIT.OK;
  }
  const file = options.file ? path.resolve(options.file) : DEFAULT_BOARD_FILE;

  if (command === "duplicates") {
    const board = parseBoard(fs.readFileSync(file, "utf8"));
    const report = duplicatesReport(board.rows);
    emit(
      options.json,
      { status: "ok", file, ...report },
      report.idsWithDuplicates === 0
        ? `NO DUPLICATE IDS (${report.rows} rows, all ids unique)`
        : `DUPLICATE IDS (${report.idsWithDuplicates} ids, ${report.rows} rows):\n` +
            report.duplicateIds
              .map(
                (entry) =>
                  `  ${entry.id} ×${entry.count} — lines ${entry.lines.join(", ")}\n` +
                  entry.entries
                    .map((row) => `      line ${row.line} | status=${row.status} | ts=${row.ts ?? "-"} | ${String(row.title ?? "").slice(0, TITLE_PREVIEW)}`)
                    .join("\n"),
              )
              .join("\n"),
    );
    if (options["fail-on-duplicate"] && report.idsWithDuplicates > 0) return EXIT.AMBIGUOUS;
    return EXIT.OK;
  }

  if (command === "resolve") {
    const board = parseBoard(fs.readFileSync(file, "utf8"));
    const selection = selectRow(board.rows, criteriaFrom(options));
    if (selection.status === "resolved") {
      emit(
        options.json,
        { status: "resolved", file, line: selection.target.line, candidates: selection.candidates.length, applied: selection.applied, row: selection.target.data },
        `RESOLVED id=${options.id} line=${selection.target.line} candidates=${selection.candidates.length}` +
          (selection.applied.length ? ` via ${selection.applied.join(", ")}` : "") +
          `\n${describeRow(selection.target)}`,
      );
      return EXIT.OK;
    }
    return reportRefusal(selection, options.json);
  }

  if (command === "update") {
    if (options.sets.length === 0) {
      process.stderr.write(`ERROR: update requires at least one --set key=value\n${HELP}`);
      return EXIT.USAGE;
    }
    let result;
    try {
      result = mutateBoard({ file, criteria: criteriaFrom(options), assignments: options.sets, dryRun: options["dry-run"] === true });
    } catch (caught) {
      process.stderr.write(`ERROR: ${caught instanceof Error ? caught.message : String(caught)}\n`);
      return EXIT.INVALID_BOARD;
    }
    if (result.status === "updated" || result.status === "would_update") {
      emit(
        options.json,
        {
          status: result.status,
          file: result.file,
          line: result.target.line,
          candidates: result.candidates.length,
          applied: result.applied,
          changed: result.changed,
          untouched: result.untouched,
          bytesBefore: result.bytesBefore,
          bytesAfter: result.bytesAfter,
        },
        `${result.status === "updated" ? "UPDATED" : "WOULD UPDATE"} id=${options.id} line=${result.target.line} ` +
          `(candidates=${result.candidates.length})` +
          `\n  changed: ${result.changed.map((c) => `${c.key}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`).join(", ")}` +
          `\n  untouched lines byte-preserved: ${result.untouched}`,
      );
      return EXIT.OK;
    }
    if (result.status === "no_change") {
      emit(
        options.json,
        { status: "no_change", file, line: result.target.line, candidates: result.candidates.length, applied: result.applied },
        `NO CHANGE id=${options.id} line=${result.target.line} — the row already carries the requested values; file not written`,
      );
      return EXIT.OK;
    }
    if (result.status === "invalid_board") {
      return reportRefusal(result, options.json);
    }
    return reportRefusal(result, options.json);
  }

  process.stderr.write(`ERROR: unknown command "${command}"\n${HELP}`);
  return EXIT.USAGE;
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
