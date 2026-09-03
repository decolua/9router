// Token/context benchmark: measures before/after across scenarios using the
// ToolPruner + RTK. Run with:  npx vitest run bench/token-bench.test.js   (from tests/)
// (Informational — no failing assertions, it just prints a table. Not wired into `npm test`.)
import { describe, it } from "vitest";
import { pruneToolHistory, PRUNER_DEFAULTS } from "../../open-sse/services/toolHistoryPruner.js";
import { breakdownTokens } from "../../src/lib/tokenizer.js";

const tool = (callId, name, arg, result) => [
  { role: "assistant", content: null, tool_calls: [{ id: callId, type: "function", function: { name, arguments: JSON.stringify(arg) } }] },
  { role: "tool", tool_call_id: callId, content: result },
];

const bigToolResult = (callId, name, lines = 400) => {
  const content = Array.from({ length: lines }, (_, i) => `line ${i + 1}: some file read output content ${i}`).join("\n");
  return tool(callId, name, { path: `/tmp/file-${callId}.txt` }, content);
};

function makeScenario(messages) {
  const body = { model: "x/model", messages, tools: [{ type: "function", function: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } } }] };
  return body;
}

function measure(label, body, prunerCfg) {
  const before = breakdownTokens(body);
  const pruned = pruneToolHistory(body, prunerCfg);
  const after = breakdownTokens(body);
  return { label, before, after, pruner: pruned, totalAfter: after.total };
}

const configs = {
  safe: { enabled: false },
  balanced: { enabled: true, maxToolTurns: 16, maxCharsPerResult: 30000, maxTotalChars: 150000, preserveErrors: true },
  aggressive: { enabled: true, maxToolTurns: 8, maxCharsPerResult: 15000, maxTotalChars: 80000, preserveErrors: true },
};

describe("token bench", () => {
  it("prints scenario table", () => {
    const scenarios = {};

    // 1. Simple single-turn
    scenarios["1-simple coding request"] = makeScenario([
      { role: "user", content: "Write a fib function" },
    ]);

    // 2. Multi-file edit (5 tool turns)
    const multi = [];
    for (let i = 0; i < 5; i++) multi.push(...tool(`c${i}`, "write_file", { path: `/src/f${i}.js` }, `// file ${i}\n${"code ".repeat(200)}`));
    scenarios["2-multi-file edit"] = makeScenario([...multi, { role: "user", content: "done, review" }]);

    // 3. Heavy tool usage (20 reads, 10 greps)
    const heavy = [];
    for (let i = 0; i < 20; i++) heavy.push(...bigToolResult(`r${i}`, "read_file", 120));
    for (let i = 0; i < 10; i++) heavy.push(...tool(`g${i}`, "grep", { p: "foo" }, `/src/f.txt:${i}: matched line ${i}\n`.repeat(25)));
    scenarios["3-heavy tool usage"] = makeScenario(heavy);

    // 4. Large terminal output (single 100KB)
    scenarios["4-large terminal output"] = makeScenario([
      ...tool("t1", "run_command", { cmd: "build" }, "\n".repeat(2000) + "ERROR\n" + "\n".repeat(2000)),
      { role: "user", content: "fix it" },
    ]);

    // 5. Repeated file reads (same file 10x)
    let repeated = [];
    for (let i = 0; i < 10; i++) repeated.push(...tool(`dup${i}`, "read_file", { path: "/same.txt" }, "SAME CONTENT\n".repeat(80)));
    scenarios["5-repeated file reads"] = makeScenario(repeated);

    // 6. Long tool history (30 turns)
    const long = [];
    for (let i = 0; i < 30; i++) long.push(...bigToolResult(`l${i}`, "run_command", 60));
    scenarios["7-long tool history"] = makeScenario(long);

    // Calculate savings per config
    for (const [cfgName, cfg] of Object.entries(configs)) {
      console.log(`\n=== PROFILE ${cfgName.toUpperCase()} ===`);
      console.log("scenario".padEnd(26) + "beforeT".padEnd(9) + "afterT".padEnd(9) + "sav%".padEnd(7) + "pruned".padEnd(8) + "bytesSaved");
      let sumBefore = 0, sumAfter = 0;
      for (const [label, body] of Object.entries(scenarios)) {
        const m = measure(label, body, cfg);
        const pct = m.before.total > 0 ? ((m.before.total - m.totalAfter) / m.before.total * 100).toFixed(1) : "0";
        sumBefore += m.before.total;
        sumAfter += m.totalAfter;
        console.log(
          label.padEnd(26) +
          String(m.before.total).padEnd(9) +
          String(m.totalAfter).padEnd(9) +
          pct.padEnd(7) +
          String(m.pruner?.prunedCount ?? 0).padEnd(8) +
          String(m.pruner?.bytesSaved ?? 0)
        );
      }
      const totalPct = sumBefore > 0 ? ((sumBefore - sumAfter) / sumBefore * 100).toFixed(1) : "0";
      console.log(`${"TOTAL".padEnd(26)}${String(sumBefore).padEnd(9)}${String(sumAfter).padEnd(9)}${totalPct.padEnd(7)}`);
    }
  });
});
