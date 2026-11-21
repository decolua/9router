/**
 * Console Log viewer parsing (#5794).
 *
 * The dashboard viewer filters/counts structured rows derived from raw captured
 * console output. These tests pin the parsing contract: level detection, tag
 * extraction, request/response summary fields and the filter semantics.
 */

import { describe, it, expect } from "vitest";
import {
  parseLogEntry,
  countByLevel,
  collectTags,
  matchesLogFilters,
} from "@/shared/utils/consoleLogFormat";

describe("parseLogEntry", () => {
  it("parses a request summary line", () => {
    const row = parseLogEntry(
      "[10:22:31] 🟢 ▶ POST claude-sonnet-4-5 → anthropic/claude-sonnet-4-5 · FMT: openai→claude · STREAM · 12 MSG · 3 TOOL · ACC:acct-1",
      0
    );

    expect(row.kind).toBe("request");
    expect(row.level).toBe("INFO");
    expect(row.time).toBe("10:22:31");
    expect(row.body.startsWith("POST ")).toBe(true);
    expect(row.model).toBe("claude-sonnet-4-5");
    expect(row.routedModel).toBe("anthropic/claude-sonnet-4-5");
    expect(row.fmt).toBe("openai→claude");
    expect(row.stream).toBe(true);
    expect(row.msgCount).toBe(12);
    expect(row.toolCount).toBe(3);
    expect(row.account).toBe("acct-1");
  });

  it("parses a done summary line with tokens and latency", () => {
    const row = parseLogEntry(
      "[10:22:33] 🟢 📊 DONE 1523ms · TTFT 410ms · IN 1200 (CACHE ↻800 +100) · OUT 340 · anthropic/claude-sonnet-4-5",
      1
    );

    expect(row.kind).toBe("done");
    expect(row.body.startsWith("DONE ")).toBe(true);
    expect(row.totalMs).toBe(1523);
    expect(row.ttftMs).toBe(410);
    expect(row.inTokens).toBe(1200);
    expect(row.cacheRead).toBe(800);
    expect(row.cacheCreate).toBe(100);
    expect(row.outTokens).toBe(340);
    expect(row.routedModel).toBe("anthropic/claude-sonnet-4-5");
  });

  it("marks upstream failures as ERROR and keeps the status code", () => {
    const row = parseLogEntry(
      "[10:22:40] 🟢 ✗ ERROR 402 · anthropic/claude-sonnet-4-5 · 210ms\n    quota exhausted",
      2
    );

    expect(row.level).toBe("ERROR");
    expect(row.kind).toBe("error");
    expect(row.status).toBe("402");
  });

  it("uses the captured console level for warn lines", () => {
    const row = parseLogEntry({ t: 1, level: "warn", text: "[10:00:00] ⚠️ [BG_TOKEN_REFRESH] Tick failed (swallowed)" });

    expect(row.level).toBe("WARN");
    expect(row.tag).toBe("BG_TOKEN_REFRESH");
  });

  it("uses the captured console level for info and debug lines", () => {
    expect(parseLogEntry({ t: 1, level: "info", text: "[10:00:00] ℹ️  [TOKEN_REFRESH] Credentials updated" }).level).toBe("INFO");
    expect(parseLogEntry({ t: 1, level: "debug", text: "[10:00:00] 🔍 [DBG:STREAM] chunk #1" }).level).toBe("DEBUG");
  });

  it("falls back to INFO for untagged console.log output", () => {
    const row = parseLogEntry({ t: 1, level: "log", text: "plain message" });

    expect(row.level).toBe("INFO");
    expect(row.tag).toBeNull();
    expect(row.kind).toBe("log");
  });

  it("keys rows by the capture sequence so ids survive buffer trimming", () => {
    const first = parseLogEntry({ seq: 7, t: 1, level: "log", text: "a" });
    const second = parseLogEntry({ seq: 8, t: 2, level: "log", text: "b" });

    expect(first.id).toBe("7");
    expect(second.id).toBe("8");
  });

  it("strips the leading tag and status symbol from every log shape", () => {
    const bodies = [
      ["[10:00:00] 🟢 ▶ POST m → p/m · FMT: openai", "POST m → p/m · FMT: openai"],
      ["[10:00:00] 🟢 📊 DONE 5ms · IN 1 · OUT 2 · p/m", "DONE 5ms · IN 1 · OUT 2 · p/m"],
      ["[10:00:00] ⚠️  [BG_TOKEN_REFRESH] Tick failed", "[BG_TOKEN_REFRESH] Tick failed"],
      ["[10:00:00] ℹ️  [TOKEN_REFRESH] Updated", "[TOKEN_REFRESH] Updated"],
      ["[10:00:00] 🐛 [DBG:STREAM] chunk #1", "[DBG:STREAM] chunk #1"],
      ["[10:00:00] 🟢 ✗ ERROR 402 · p/m · 1ms", "ERROR 402 · p/m · 1ms"],
    ];

    for (const [text, expected] of bodies) {
      expect(parseLogEntry({ t: 1, level: "log", text }).body).toBe(expected);
    }
  });

  it("leaves plain text untouched", () => {
    expect(parseLogEntry({ t: 1, level: "log", text: "[DB] Driver: better-sqlite3" }).body).toBe(
      "[DB] Driver: better-sqlite3"
    );
    expect(parseLogEntry({ t: 1, level: "log", text: "plain message" }).body).toBe("plain message");
  });
});

describe("countByLevel / collectTags", () => {
  const rows = [
    parseLogEntry({ t: 1, level: "error", text: "[10:00:00] ✗ boom" }, 0),
    parseLogEntry({ t: 2, level: "warn", text: "[10:00:01] ⚠️ [TOKEN_REFRESH] slow" }, 1),
    parseLogEntry({ t: 3, level: "log", text: "[10:00:02] [TOKEN_REFRESH] again" }, 2),
  ];

  it("counts rows per level", () => {
    expect(countByLevel(rows)).toEqual({ ERROR: 1, WARN: 1, INFO: 1, DEBUG: 0 });
  });

  it("counts tags, most frequent first", () => {
    expect(collectTags(rows)).toEqual([{ tag: "TOKEN_REFRESH", count: 2 }]);
  });
});

describe("matchesLogFilters", () => {
  const row = parseLogEntry(
    "[10:22:31] 🟢 ▶ POST claude-sonnet-4-5 → anthropic/claude-sonnet-4-5 · FMT: openai→claude · STREAM · 12 MSG · ACC:acct-1",
    0
  );

  it("passes everything with default filters", () => {
    expect(matchesLogFilters(row, {})).toBe(true);
  });

  it("filters by level", () => {
    expect(matchesLogFilters(row, { level: "INFO" })).toBe(true);
    expect(matchesLogFilters(row, { level: "ERROR" })).toBe(false);
  });

  it("filters by tag", () => {
    expect(matchesLogFilters(row, { tag: "ALL" })).toBe(true);
    expect(matchesLogFilters(row, { tag: "TOKEN_REFRESH" })).toBe(false);
  });

  it("searches model, account and raw text", () => {
    expect(matchesLogFilters(row, { query: "claude-sonnet" })).toBe(true);
    expect(matchesLogFilters(row, { query: "acct-1" })).toBe(true);
    expect(matchesLogFilters(row, { query: "openai" })).toBe(true);
    expect(matchesLogFilters(row, { query: "gpt-5" })).toBe(false);
  });
});
