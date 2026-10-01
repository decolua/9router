// End-to-end integration test: hit live local proxy and verify [RTK] behavior.
// Run with: RUN_E2E=1 RTK_E2E_PORT=... RTK_E2E_KEY=... RTK_E2E_LOG=<absolute path to server stdout file> npm test rtk.e2e.test.js
// Requires: dev server running, rtkEnabled=true, API key present.
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const PORT = process.env.RTK_E2E_PORT || "20128";
const BASE = `http://localhost:${PORT}`;
const API_KEY = process.env.RTK_E2E_KEY || "";
const LOG_FILE = process.env.RTK_E2E_LOG || "";

const RUN = process.env.RUN_E2E === "1";
const maybe = RUN ? describe : describe.skip;

function readLogTail(bytes = 8192) {
  if (!LOG_FILE || !fs.existsSync(LOG_FILE)) return "";
  const stat = fs.statSync(LOG_FILE);
  const start = Math.max(0, stat.size - bytes);
  const fd = fs.openSync(LOG_FILE, "r");
  const buf = Buffer.alloc(stat.size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  return buf.toString("utf8");
}

// Read new bytes appended to log since `offset`. Returns text + new offset.
function readLogSince(offset) {
  if (!LOG_FILE || !fs.existsSync(LOG_FILE)) return { text: "", next: offset };
  const stat = fs.statSync(LOG_FILE);
  if (stat.size <= offset) return { text: "", next: stat.size };
  const fd = fs.openSync(LOG_FILE, "r");
  const buf = Buffer.alloc(stat.size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  return { text: buf.toString("utf8"), next: stat.size };
}

function logOffset() {
  if (!LOG_FILE || !fs.existsSync(LOG_FILE)) return 0;
  return fs.statSync(LOG_FILE).size;
}

async function sendChat(body) {
  return fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": `Bearer ${API_KEY}` },
    body: JSON.stringify(body)
  });
}

function makeBigDiff(fileCount = 3, linesPerFile = 80) {
  const out = [];
  for (let f = 0; f < fileCount; f++) {
    out.push(`diff --git a/src/file${f}.js b/src/file${f}.js`);
    out.push(`index abc${f}..def${f} 100644`);
    out.push(`--- a/src/file${f}.js`);
    out.push(`+++ b/src/file${f}.js`);
    out.push(`@@ -1,${linesPerFile} +1,${linesPerFile} @@`);
    for (let i = 0; i < linesPerFile; i++) {
      out.push(`-const old${f}_${i} = "removed value ${i} padding padding padding";`);
      out.push(`+const new${f}_${i} = "added value ${i} padding padding padding padding";`);
    }
  }
  return out.join("\n");
}

maybe("RTK end-to-end", () => {
  it("server is reachable", async () => {
    const res = await fetch(`${BASE}/api/health`);
    expect(res.ok).toBe(true);
  });

  it("rtkEnabled flag is true (user must enable via dashboard)", async () => {
    const res = await fetch(`${BASE}/api/settings`);
    const data = await res.json();
    expect(data.rtkEnabled).toBe(true);
  });

  it("compresses git diff tool_result and writes [RTK] savings to log", async () => {
    const diff = makeBigDiff(2, 60);
    expect(diff.length).toBeGreaterThan(500);

    const offset = logOffset();
    const res = await sendChat({
      model: "cc/claude-opus-4-7",
      stream: false,
      max_tokens: 64,
      messages: [
        { role: "user", content: "run git diff" },
        { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "Bash", arguments: JSON.stringify({ command: "git diff" }) } }] },
        { role: "tool", tool_call_id: "call_1", content: diff },
        { role: "user", content: "summarize in 10 words" }
      ]
    });
    expect([200, 400, 401, 402, 500]).toContain(res.status);

    if (!LOG_FILE) return;
    await new Promise(r => setTimeout(r, 500));
    const { text } = readLogSince(offset);
    const matches = [...text.matchAll(/\[RTK\] saved (\d+)B \/ (\d+)B \([\d.]+%\) via \[([\w,-]+)\] hits=(\d+)/g)];
    // Find the log line that corresponds to OUR request (total ≥ diff.length and contains git-diff)
    const mine = matches.find(m => Number(m[2]) >= diff.length && m[3].includes("git-diff"));
    expect(mine, `no matching [RTK] line for our request (diff=${diff.length}B) in ${matches.length} log entries`).toBeTruthy();
    expect(Number(mine[1])).toBeGreaterThan(500);
    expect(mine[3]).toContain("git-diff");
    expect(Number(mine[4])).toBeGreaterThanOrEqual(1);
  });

  it("compresses grep-style tool_result", async () => {
    const lines = [];
    for (let i = 1; i <= 30; i++) lines.push(`src/lib/foo.js:${i}:const v${i} = "matching content with enough padding to exceed threshold";`);
    const grepOut = lines.join("\n");
    expect(grepOut.length).toBeGreaterThan(500);

    const offset = logOffset();
    const res = await sendChat({
      model: "cc/claude-opus-4-7",
      stream: false,
      max_tokens: 32,
      messages: [
        { role: "user", content: "grep" },
        { role: "assistant", content: null, tool_calls: [{ id: "c3", type: "function", function: { name: "Bash", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "c3", content: grepOut },
        { role: "user", content: "ok" }
      ]
    });
    expect([200, 400, 401, 402, 500]).toContain(res.status);

    if (!LOG_FILE) return;
    await new Promise(r => setTimeout(r, 500));
    const { text } = readLogSince(offset);
    const matches = [...text.matchAll(/\[RTK\] saved (\d+)B \/ (\d+)B \([\d.]+%\) via \[([\w,-]+)\] hits=(\d+)/g)];
    const mine = matches.find(m => Number(m[2]) >= grepOut.length && m[3].includes("grep"));
    expect(mine, `no matching [RTK] line for grep payload`).toBeTruthy();
  });
});
