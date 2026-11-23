import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectObscuraBrowser } from "open-sse/services/obscura.js";
import { launchChromiumWithFallback } from "open-sse/executors/browserExecutableCheck.js";
import { MuseWebExecutor } from "open-sse/executors/muse-web.js";
import { renewSession } from "open-sse/executors/muse-web/session.js";
import {
  acquireBrowserContext,
  getBrowserPoolStatus,
  openPage,
  releaseBrowserContext,
  shutdownPool,
} from "open-sse/services/browserPool.js";

vi.mock("open-sse/services/obscura.js", () => ({ connectObscuraBrowser: vi.fn() }));
vi.mock("open-sse/services/lazyRuntime.js", () => ({ loadRuntimeDep: async () => ({ chromium: {} }) }));
vi.mock("open-sse/services/virtualDisplay.js", () => ({
  ensureVirtualDisplay: async () => null,
  stopVirtualDisplay: () => {},
}));
vi.mock("open-sse/executors/browserExecutableCheck.js", () => ({
  launchChromiumWithFallback: vi.fn(),
  resolveSystemChromeExecutable: () => null,
  isMissingBrowserExecutable: () => false,
}));
vi.mock("open-sse/executors/muse-web/session.js", async (importOriginal) => ({
  ...await importOriginal(),
  renewSession: vi.fn(),
}));

const MINUTE = 60_000;

// Only the external browser is fake: acquisition, idle/eviction timers and
// explicit lifecycle operations all run through the real pool.
function createBrowser({ pageError } = {}) {
  let connected = true;
  const contexts = [];
  return {
    isConnected: () => connected,
    async newContext() {
      let closed = false;
      const pages = [];
      const context = {
        isClosed: () => closed,
        pages: () => pages,
        async addCookies() {},
        async newPage() {
          let pageClosed = false;
          const page = {
            isClosed: () => pageClosed,
            async goto() { if (pageError) throw pageError; },
            async evaluate() { return "page unavailable"; },
            async close() { pageClosed = true; },
          };
          pages.push(page);
          return page;
        },
        async close() {
          closed = true;
          await Promise.all(pages.map(page => page.close()));
        },
      };
      contexts.push(context);
      return context;
    },
    async close() {
      connected = false;
      await Promise.all(contexts.map(context => context.close()));
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T00:00:00Z"));
  connectObscuraBrowser.mockImplementation(async () => ({ browser: createBrowser() }));
  launchChromiumWithFallback.mockImplementation(async () => createBrowser());
  renewSession.mockResolvedValue({ cookieHeader: "hatch_sess=test", meta: {} });
});

afterEach(async () => {
  await shutdownPool("test-cleanup");
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function acquireWithWarmup(key) {
  const pending = acquireBrowserContext(key, { warmupUrl: "https://example.test/" });
  await vi.advanceTimersByTimeAsync(1500);
  return pending;
}

describe("browser pool active pages (#5649)", () => {
  it.each([true, false])("keeps a long-running job open through idle and TTL checks (headless=%s)", async (headless) => {
    const pooled = await acquireBrowserContext("video", { headless });
    const page = await openPage(pooled);

    await vi.advanceTimersByTimeAsync(16 * MINUTE);

    expect(page.isClosed()).toBe(false);
    expect(pooled.context.isClosed()).toBe(false);
    expect(getBrowserPoolStatus()).toMatchObject({ contexts: 1, browserRunning: true });

    await page.close();
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(getBrowserPoolStatus()).toMatchObject({ contexts: 0, browserRunning: false });
  });

  it("still shuts down a context with no pages after the idle timeout", async () => {
    const pooled = await acquireBrowserContext("idle", {});
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(pooled.context.isClosed()).toBe(true);
    expect(getBrowserPoolStatus().browserRunning).toBe(false);
  });

  it("does not let a warmup page keep an unused pool alive", async () => {
    const pooled = await acquireWithWarmup("warmup-only");
    expect(pooled.warmupPage.isClosed()).toBe(false);
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(pooled.warmupPage.isClosed()).toBe(true);
    expect(getBrowserPoolStatus()).toMatchObject({ contexts: 0, browserRunning: false });
  });

  it("keeps an active request alive alongside its warmup page", async () => {
    const pooled = await acquireWithWarmup("warm-video");
    const page = await pooled.context.newPage();
    await vi.advanceTimersByTimeAsync(16 * MINUTE);
    expect(page.isClosed()).toBe(false);
    expect(pooled.warmupPage.isClosed()).toBe(false);
  });

  it("ignores closed request pages when deciding whether the pool is busy", async () => {
    const pooled = await acquireBrowserContext("done", {});
    const page = await openPage(pooled);
    await page.close();
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(getBrowserPoolStatus()).toMatchObject({ contexts: 0, browserRunning: false });
  });

  it("evicts a stale idle context while another context has an active page", async () => {
    const idle = await acquireWithWarmup("idle-neighbor");
    const busy = await acquireBrowserContext("busy-neighbor", {});
    const page = await openPage(busy);
    await vi.advanceTimersByTimeAsync(11 * MINUTE);
    expect(idle.context.isClosed()).toBe(true);
    expect(page.isClosed()).toBe(false);
    expect(getBrowserPoolStatus()).toMatchObject({ contexts: 1, browserRunning: true });
  });

  it("still allows explicit release of an active context", async () => {
    const pooled = await acquireBrowserContext("released", {});
    const page = await openPage(pooled);
    await releaseBrowserContext("released");
    expect(page.isClosed()).toBe(true);
    expect(getBrowserPoolStatus()).toMatchObject({ contexts: 0, browserRunning: false });
  });

  it("still allows an explicit pool shutdown during an active request", async () => {
    const pooled = await acquireBrowserContext("stopped", {});
    const page = await openPage(pooled);
    await shutdownPool("operator-requested");
    expect(page.isClosed()).toBe(true);
    expect(getBrowserPoolStatus()).toMatchObject({ contexts: 0, browserRunning: false });
  });

  it.each(["navigation", "readiness"])("cleans up a Muse page after %s setup fails", async (phase) => {
    const setupError = new Error("thread setup failed");
    const browser = createBrowser(phase === "navigation" ? { pageError: setupError } : {});
    let context;
    const newContext = browser.newContext;
    browser.newContext = async () => (context = await newContext());
    connectObscuraBrowser.mockResolvedValue({ browser });

    const failedSetup = expect(new MuseWebExecutor()._openThreadPage({ apiKey: "hatch_sess=test" }, {}))
      .rejects.toThrow(phase === "navigation" ? "thread setup failed" : "page did not become ready");
    await vi.advanceTimersByTimeAsync(MINUTE);
    await failedSetup;

    expect(context.pages()[0].isClosed()).toBe(true);
    await vi.advanceTimersByTimeAsync(16 * MINUTE);
    expect(getBrowserPoolStatus()).toMatchObject({ contexts: 0, browserRunning: false });
  });
});
