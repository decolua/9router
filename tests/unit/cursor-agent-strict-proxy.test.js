import { describe, it, expect, vi } from "vitest";

import { CursorExecutor } from "../../open-sse/executors/cursor.js";

const credentials = {
  accessToken: "test-token",
  providerSpecificData: { machineId: "a".repeat(64) },
};

function stubSession(executor) {
  let opened = 0;
  const connect = vi.fn(() => {
    opened += 1;
    return {
      responseHeaders: Promise.resolve({ ":status": 200 }),
      write() {},
      end() {},
      close() {},
      async read() { return { value: undefined, done: true }; },
    };
  });
  executor.openAgentHttp2Stream = connect;
  return { connect, opened: () => opened };
}

async function runAgent(executor, proxyOptions) {
  return executor.executeAgent({
    model: "gpt-5.2",
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: false,
    credentials,
    proxyOptions,
  });
}

describe("Cursor AgentService strict-proxy policy guard", () => {
  it("refuses to open any h2 session when a strict proxy is intended but unresolved", async () => {
    const executor = new CursorExecutor();
    const { connect } = stubSession(executor);
    await expect(runAgent(executor, {
      strictProxy: true,
      proxyPoolId: "pool-1",
      connectionProxyEnabled: true,
      connectionProxyUrl: "", // pool drained/inactive: nothing resolves
    })).rejects.toThrow(/strict proxy/u);
    expect(connect).not.toHaveBeenCalled();
  });

  it("fails closed when a strict pool id is present even without an explicit url", async () => {
    const executor = new CursorExecutor();
    const { connect } = stubSession(executor);
    await expect(runAgent(executor, {
      strictProxy: true,
      proxyPoolId: "pool-1",
    })).rejects.toThrow(/strict proxy/u);
    expect(connect).not.toHaveBeenCalled();
  });

  it("fails closed when strict is set via enabled+url", async () => {
    const executor = new CursorExecutor();
    const { connect } = stubSession(executor);
    await expect(runAgent(executor, {
      strictProxy: true,
      enabled: true,
      url: "http://127.0.0.1:9",
    })).rejects.toThrow(/strict proxy/u);
    expect(connect).not.toHaveBeenCalled();
  });

  it("fails closed when strict is set via connectionProxyEnabled+connectionProxyUrl", async () => {
    const executor = new CursorExecutor();
    const { connect } = stubSession(executor);
    await expect(runAgent(executor, {
      strictProxy: true,
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://127.0.0.1:9",
    })).rejects.toThrow(/strict proxy/u);
    expect(connect).not.toHaveBeenCalled();
  });

  it("non-strict proxy options keep today's direct h2 behavior", async () => {
    const executor = new CursorExecutor();
    const { connect } = stubSession(executor);
    await expect(runAgent(executor, {
      strictProxy: false,
      proxyPoolId: "pool-1",
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://127.0.0.1:9",
    })).resolves.toBeTruthy();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("no proxy options at all keeps the direct h2 path", async () => {
    const executor = new CursorExecutor();
    const { connect } = stubSession(executor);
    await expect(runAgent(executor, null)).resolves.toBeTruthy();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("strict without any proxy intent is not blocked (nothing to honor)", async () => {
    const executor = new CursorExecutor();
    const { connect } = stubSession(executor);
    await expect(runAgent(executor, { strictProxy: true })).resolves.toBeTruthy();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("a vercel-style relay is exempt: it rides fetch, not the h2 duplex", async () => {
    const executor = new CursorExecutor();
    const { connect } = stubSession(executor);
    await expect(runAgent(executor, {
      strictProxy: true,
      proxyPoolId: "relay-1",
      vercelRelayUrl: "https://relay.example/",
    })).resolves.toBeTruthy();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("execute() routes the failure through its connection_error envelope", async () => {
    const executor = new CursorExecutor();
    stubSession(executor);
    const result = await executor.execute({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials,
      proxyOptions: { strictProxy: true, proxyPoolId: "pool-1" },
    });
    expect(result.response.status).toBeGreaterThanOrEqual(500);
    const payload = await result.response.json();
    expect(payload.error.message).toMatch(/strict proxy/u);
    expect(payload.error.type).toBe("connection_error");
  });
});
