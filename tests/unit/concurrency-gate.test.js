import { describe, it, expect } from "vitest";
import { createConcurrencyGate } from "open-sse/utils/concurrencyGate.js";
import { resolveClaudeCliMaxConcurrency, CLAUDE_CLI_DEFAULT_MAX_CONCURRENCY } from "open-sse/config/claudeCli.js";
import { claudeCliGateStats } from "open-sse/executors/claude-cli.js";

const gate = (limit, queueTimeoutMs = 50) => createConcurrencyGate({ limit, queueTimeoutMs });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("concurrency gate", () => {
  it("admits up to the limit immediately", async () => {
    const g = gate(2);
    await g.acquire();
    await g.acquire();
    expect(g.stats()).toMatchObject({ active: 2, queued: 0, limit: 2 });
  });

  it("queues past the limit and admits in FIFO order as slots free", async () => {
    const g = gate(1, 5000);
    const releaseFirst = await g.acquire();

    const order = [];
    const second = g.acquire().then((r) => { order.push("second"); return r; });
    const third = g.acquire().then((r) => { order.push("third"); return r; });
    await tick();
    expect(g.stats()).toMatchObject({ active: 1, queued: 2 });

    releaseFirst();
    const releaseSecond = await second;
    expect(order).toEqual(["second"]);

    releaseSecond();
    await third;
    expect(order).toEqual(["second", "third"]);
  });

  it("never exceeds the limit under a burst", async () => {
    const g = gate(3, 5000);
    let peak = 0;
    const releases = [];
    await Promise.all(Array.from({ length: 10 }, async () => {
      const release = await g.acquire();
      peak = Math.max(peak, g.stats().active);
      releases.push(release);
      // Hold a moment so the peak is observable before anything is freed.
      await tick();
      release();
    }));
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("gives up with queue_timeout instead of piling up forever", async () => {
    const g = gate(1, 30);
    await g.acquire();
    await expect(g.acquire()).rejects.toMatchObject({ code: "queue_timeout" });
    // The abandoned waiter leaves the queue immediately, so a saturated gate
    // cannot accumulate dead entries.
    expect(g.stats().queued).toBe(0);
  });

  it("rejects a queued request when its client aborts", async () => {
    const g = gate(1, 5000);
    await g.acquire();
    const controller = new AbortController();
    const queued = g.acquire(controller.signal);
    await tick();
    controller.abort();
    await expect(queued).rejects.toMatchObject({ code: "aborted" });
  });

  it("rejects immediately for an already-aborted request", async () => {
    const g = gate(5);
    await expect(g.acquire(AbortSignal.abort())).rejects.toMatchObject({ code: "aborted" });
    expect(g.stats().active).toBe(0);
  });

  it("skips waiters that already gave up when handing over a slot", async () => {
    const g = gate(1, 20);
    const release = await g.acquire();
    const abandoned = g.acquire().catch((e) => e.code);
    expect(await abandoned).toBe("queue_timeout");

    // The slot must go to a live waiter, not be swallowed by the dead one.
    const live = g.acquire();
    release();
    await expect(live).resolves.toBeTypeOf("function");
  });
});

describe("claude-cli concurrency configuration", () => {
  it("defaults, and honours a valid CLI_CLAUDE_MAX_CONCURRENCY", () => {
    expect(resolveClaudeCliMaxConcurrency({})).toBe(CLAUDE_CLI_DEFAULT_MAX_CONCURRENCY);
    expect(resolveClaudeCliMaxConcurrency({ CLI_CLAUDE_MAX_CONCURRENCY: "8" })).toBe(8);
  });

  it("ignores nonsense values rather than disabling the gate", () => {
    for (const bad of ["0", "-3", "abc", "2.5", ""]) {
      expect(resolveClaudeCliMaxConcurrency({ CLI_CLAUDE_MAX_CONCURRENCY: bad })).toBe(CLAUDE_CLI_DEFAULT_MAX_CONCURRENCY);
    }
  });

  it("exposes a gate that starts idle", () => {
    expect(claudeCliGateStats()).toMatchObject({ active: 0, limit: CLAUDE_CLI_DEFAULT_MAX_CONCURRENCY });
  });
});

describe("claude-cli when no slot can be obtained", () => {
  it("returns a readable error frame instead of spawning or hanging", async () => {
    const { getExecutor } = await import("open-sse/executors/index.js");
    const { response } = await getExecutor("claude-cli").execute({
      model: "claude-cli-haiku",
      body: { messages: [{ role: "user", content: "hi" }] },
      signal: AbortSignal.abort(),
    });
    const text = await response.text();
    expect(text).toContain("aborted");
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true);
  });
});
