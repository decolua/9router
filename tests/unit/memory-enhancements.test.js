import test from "node:test";
import assert from "node:assert/strict";

import { pruneHistoricalTools } from "../../open-sse/services/memory/toolPruner.js";
import { pruneHistoricalMedia } from "../../open-sse/services/memory/mediaPruner.js";
import { compactContextWindow } from "../../open-sse/services/memory/contextCompactor.js";
import { anchorPromptCache } from "../../open-sse/services/memory/cacheAnchor.js";
import { recordHandoff, getHandoff, injectPendingHandoff, consumeHandoff } from "../../open-sse/services/memory/handoffStore.js";
import { applyMemoryEnhancements } from "../../open-sse/services/memory/index.js";

test("Tool Pruner: preserves recent tool turns and truncates older ones", () => {
  const largeOutput1 = "Line 1: error in compilation\n".repeat(50);
  const largeOutput2 = "Line 2: git diff output\n".repeat(50);
  const recentOutput = "Line 3: active tool output with latest details\n".repeat(5);

  const body = {
    messages: [
      { role: "user", content: "Check code" },
      { role: "assistant", content: "Running check", tool_calls: [{ id: "c1", function: { name: "build" } }] },
      { role: "tool", tool_call_id: "c1", content: largeOutput1 },
      { role: "assistant", content: "Checking git diff", tool_calls: [{ id: "c2", function: { name: "git_diff" } }] },
      { role: "tool", tool_call_id: "c2", content: largeOutput2 },
      { role: "assistant", content: "Running latest check", tool_calls: [{ id: "c3", function: { name: "test" } }] },
      { role: "tool", tool_call_id: "c3", content: recentOutput },
      { role: "user", content: "What is next?" }
    ]
  };

  // Keep last 1 tool turn full, truncate older ones to 200 chars
  const res = pruneHistoricalTools(body, {
    enabled: true,
    keepRecentTurns: 1,
    maxHistoricalChars: 200
  });

  assert.equal(res.pruned, true);
  assert.equal(res.count, 2);
  assert.ok(res.savedChars > 500);

  // Older tools should contain the truncation notice
  assert.ok(body.messages[2].content.includes("Tool output truncated by 9router memory optimizer"));
  assert.ok(body.messages[4].content.includes("Tool output truncated by 9router memory optimizer"));

  // Recent tool (index 6) must remain completely intact
  assert.equal(body.messages[6].content, recentOutput);
});

test("Media Pruner: removes older base64 media while preserving trailing user media", () => {
  const oldBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const recentBase64 = "data:image/png;base64,RECENTIMAGE1234567890";

  const body = {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Look at this initial diagram" },
          { type: "image_url", image_url: { url: oldBase64 } }
        ]
      },
      { role: "assistant", content: "I see the initial diagram architecture." },
      {
        role: "user",
        content: [
          { type: "text", text: "Now check this new screenshot" },
          { type: "image_url", image_url: { url: recentBase64 } }
        ]
      }
    ]
  };

  const res = pruneHistoricalMedia(body, { enabled: true });
  assert.equal(res.pruned, true);
  assert.equal(res.savedItems, 1);

  // Turn 0 media replaced with placeholder
  assert.equal(body.messages[0].content[1].type, "text");
  assert.ok(body.messages[0].content[1].text.includes("Historical image_url omitted"));

  // Turn 2 (trailing user turn) must keep the image_url intact
  assert.equal(body.messages[2].content[1].type, "image_url");
  assert.equal(body.messages[2].content[1].image_url.url, recentBase64);
});

test("Context Compactor: compresses long conversation history exceeding threshold", () => {
  const messages = [
    { role: "system", content: "You are a senior coding assistant." }
  ];

  // Generate 25 turns with large text
  for (let i = 1; i <= 25; i++) {
    messages.push({ role: "user", content: `Step ${i}: Detailed requirement explanations and background data `.repeat(10) });
    messages.push({ role: "assistant", content: `Step ${i}: Executed operations and generated module `.repeat(10) });
  }

  const body = { messages };

  const res = compactContextWindow(body, {
    enabled: true,
    thresholdTokens: 500, // Small threshold for testing
    recentTurnsToKeep: 4
  });

  assert.equal(res.compacted, true);
  assert.ok(res.savedTokens > 0);

  // System message preserved at index 0
  assert.equal(body.messages[0].role, "system");
  // Next message is the compacted summary
  assert.ok(body.messages[1].content.includes("[Historical Context Summary by 9router Memory Optimizer]"));
  // Recent turns kept at the end
  assert.equal(body.messages.length, 1 + 2 + 4);
});

test("Prompt Cache Anchor: adds cache breakpoints to Claude format", () => {
  const body = {
    system: "System prompt for test",
    tools: [{ name: "bash", description: "Run bash commands" }],
    messages: [{ role: "user", content: "Hello" }]
  };

  const res = anchorPromptCache(body, { enabled: true, format: "claude" });
  assert.equal(res.anchored, true);
  assert.deepEqual(body.system[0].cache_control, { type: "ephemeral" });
  assert.deepEqual(body.tools[0].cache_control, { type: "ephemeral" });
});

test("Handoff Store: records, gets, and injects session handoff", () => {
  const projectKey = "/home/user/code/my-project";
  recordHandoff(projectKey, {
    summary: "Auth module migration completed. Next: Add JWT refresh token tests.",
    agent: "claude-code"
  });

  const stored = getHandoff(projectKey);
  assert.ok(stored);
  assert.ok(stored.summary.includes("Auth module migration"));

  const body = {
    messages: [
      { role: "user", content: "Start work on test suite" }
    ]
  };

  const res = injectPendingHandoff(body, { enabled: true, projectKey });
  assert.equal(res.injected, true);
  assert.ok(body.messages[0].content.includes("[Previous Agent Handoff Context (via 9router)]:"));
  assert.ok(body.messages[0].content.includes("Start work on test suite"));

  // After consumption, store is cleared
  assert.equal(getHandoff(projectKey), null);
});

test("ApplyMemoryEnhancements: defaults to safe non-lossy behavior (pruners disabled)", async () => {
  const body = {
    system: "You are a test assistant",
    messages: [
      { role: "user", content: "Check status" },
      { role: "assistant", content: "Checking", tool_calls: [{ id: "t1", function: { name: "status" } }] },
      { role: "tool", tool_call_id: "t1", content: "Status report: OK\n".repeat(60) },
      { role: "assistant", content: "Now running tests", tool_calls: [{ id: "t2", function: { name: "test" } }] },
      { role: "tool", tool_call_id: "t2", content: "Active test output" },
      { role: "user", content: "All done" }
    ]
  };

  const { stats } = await applyMemoryEnhancements(body, {
    settings: {},
    targetFormat: "claude"
  });

  assert.equal(stats.toolPruning.applied, false);
  assert.equal(stats.mediaPruning.applied, false);
  assert.equal(stats.compaction.applied, false);
  assert.equal(stats.cacheAnchor.applied, true);
});

test("ApplyMemoryEnhancements: master orchestrator handles all modular toggles when enabled", async () => {
  const body = {
    messages: [
      { role: "user", content: "Check status" },
      { role: "assistant", content: "Checking", tool_calls: [{ id: "t1", function: { name: "status" } }] },
      { role: "tool", tool_call_id: "t1", content: "Status report: OK\n".repeat(60) },
      { role: "assistant", content: "Now running tests", tool_calls: [{ id: "t2", function: { name: "test" } }] },
      { role: "tool", tool_call_id: "t2", content: "Active test output" },
      { role: "user", content: "All done" }
    ]
  };

  const { stats } = await applyMemoryEnhancements(body, {
    settings: {
      memoryToolPruningEnabled: true,
      memoryMaxToolTurnsKeepFull: 1,
      memoryMaxHistoricalToolChars: 200,
      memoryMediaPruningEnabled: true,
      memoryCompactionEnabled: false,
      memoryCacheAnchorEnabled: true
    },
    targetFormat: "claude"
  });

  assert.equal(stats.toolPruning.applied, true);
  assert.equal(stats.compaction.applied, false);
});

