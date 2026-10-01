// E2E test: verify RTK compression runs for every configured provider/route.
// Each test covers a different source→target translator path.
// Run with: RUN_E2E=1 RTK_E2E_PORT=... RTK_E2E_KEY=... RTK_E2E_LOG=<server stdout file> npm test rtk.multi-provider.e2e.test.js
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const PORT = process.env.RTK_E2E_PORT || "20128";
const BASE = `http://localhost:${PORT}`;
const API_KEY = process.env.RTK_E2E_KEY || "";
const LOG_FILE = process.env.RTK_E2E_LOG || "";

const RUN = process.env.RUN_E2E === "1";
const maybe = RUN ? describe : describe.skip;

function logOffset() {
  if (!LOG_FILE || !fs.existsSync(LOG_FILE)) return 0;
  return fs.statSync(LOG_FILE).size;
}

function readLogSince(offset) {
  if (!LOG_FILE || !fs.existsSync(LOG_FILE)) return "";
  const stat = fs.statSync(LOG_FILE);
  if (stat.size <= offset) return "";
  const fd = fs.openSync(LOG_FILE, "r");
  const buf = Buffer.alloc(stat.size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  return buf.toString("utf8");
}

function makeBigDiff(fileCount = 2, linesPerFile = 60) {
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

async function sendChat(body) {
  return fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": `Bearer ${API_KEY}` },
    body: JSON.stringify(body)
  });
}

// Wait for server to emit a matching [RTK] log line (race-safe against concurrent traffic).
async function waitForRtkLine({ minBytes, filterName, timeoutMs = 5000 }) {
  const start = Date.now();
  const startOffset = logOffset();
  while (Date.now() - start < timeoutMs) {
    const text = readLogSince(startOffset);
    const matches = [...text.matchAll(/\[RTK\] saved (\d+)B \/ (\d+)B \(([\d.]+)%\) via \[([\w,-]+)\] hits=(\d+)/g)];
    const mine = matches.find(m => Number(m[2]) >= minBytes && m[4].includes(filterName));
    if (mine) {
      return {
        saved: Number(mine[1]),
        total: Number(mine[2]),
        pct: Number(mine[3]),
        filters: mine[4],
        hits: Number(mine[5])
      };
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return null;
}

// Build a chat request with OpenAI-style tool_result carrying large content.
function chatBodyWithDiff(model, diff) {
  return {
    model,
    stream: false,
    max_tokens: 16,
    messages: [
      { role: "user", content: "run git diff" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "Bash", arguments: JSON.stringify({ command: "git diff" }) } }]
      },
      { role: "tool", tool_call_id: "call_1", content: diff },
      { role: "user", content: "ok" }
    ]
  };
}

// Matrix of routes to cover — one entry per translator target format.
const ROUTES = [
  { name: "claude (cc/* → openai→claude)",        model: "cc/claude-opus-4-7" },
  { name: "codex (cx/* → openai→openai-responses)", model: "cx/gpt-5.4" },
  { name: "antigravity (ag/* → openai→antigravity)", model: "ag/gemini-3-flash" },
  { name: "cursor (cu/* → openai→cursor)",         model: "cu/claude-4.5-sonnet" },
  { name: "kiro (kr/* → openai→kiro)",             model: "kr/claude-sonnet-4.5" },
  { name: "gemini (gemini/* → openai→gemini)",     model: "gemini/gemini-2.5-flash" },
  { name: "deepseek (deepseek/* → openai, passthrough)", model: "deepseek/deepseek-chat" },
  { name: "ollama (ollama/* → openai→ollama)",     model: "ollama/gpt-oss:120b" },
];

maybe("RTK multi-provider E2E", () => {
  it("server reachable and rtkEnabled=true", async () => {
    const health = await fetch(`${BASE}/api/health`);
    expect(health.ok).toBe(true);
    const settings = await fetch(`${BASE}/api/settings`).then(r => r.json());
    expect(settings.rtkEnabled).toBe(true);
  });

  for (const route of ROUTES) {
    it(`compresses git diff for ${route.name}`, async () => {
      const diff = makeBigDiff();
      expect(diff.length).toBeGreaterThan(500);

      const res = await sendChat(chatBodyWithDiff(route.model, diff));
      // Provider may respond with 200/400/401/402/404/429/500 depending on account state.
      // The important thing: proxy must NOT crash (we just need status code).
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(600);

      if (!LOG_FILE) return;
      const hit = await waitForRtkLine({ minBytes: diff.length, filterName: "git-diff" });
      expect(hit, `[RTK] git-diff log line not found for ${route.name}`).toBeTruthy();
      expect(hit.saved).toBeGreaterThan(500);
      expect(hit.filters).toContain("git-diff");

      // Log actual savings for visibility
      console.log(`  ✓ ${route.name}: saved ${hit.saved}B / ${hit.total}B (${hit.pct}%) filters=${hit.filters}`);
    }, 20000);
  }
});
