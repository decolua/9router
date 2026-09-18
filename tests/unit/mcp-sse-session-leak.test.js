/**
 * `/api/mcp/[plugin]/sse` registers a bridge session and releases it only from
 * `ReadableStream.cancel()`. The repo's other SSE route records why that is not
 * enough (src/app/api/translator/console-logs/stream/route.js:22):
 *
 *     // request.signal fires reliably on client disconnect; ReadableStream.cancel()
 *     // is not always invoked in Next.js, which caused listeners to accumulate.
 *
 * Here the leak is not a listener. `unregisterSession` is the only thing that ever
 * reaps the spawned child (src/lib/mcp/stdioSseBridge.js:156):
 *
 *     // No sessions left → kill child to avoid idle orphan process leak.
 *     if (entry.sessions.size === 0) { entry.proc.kill(); ... }
 *
 * A session that is never unregistered keeps `sessions.size > 0` forever, so the
 * child is never killed — the exact orphan the comment promises to prevent. The
 * stdout broadcast loop cannot expose it either: it swallows send failures
 * (`catch { /* ignore broken pipe *\/ }`), so a dead session looks alive.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = { sessions: new Map(), nextSid: 0 };

vi.mock("@/lib/mcp/stdioSseBridge", () => ({
  findPlugin: (name) => (name === "known" ? { name, command: "node", args: [] } : null),
  registerSession: (name, sendFn) => {
    const sid = `sid-${bridge.nextSid++}`;
    bridge.sessions.set(sid, { name, sendFn });
    return sid;
  },
  unregisterSession: (name, sid) => { bridge.sessions.delete(sid); },
}));

const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => { bridge.sessions.clear(); bridge.nextSid = 0; });
afterEach(() => { bridge.sessions.clear(); });

async function open(plugin = "known") {
  const { GET } = await import("@/app/api/mcp/[plugin]/sse/route.js");
  const controller = new AbortController();
  const response = await GET(
    new Request(`http://localhost/api/mcp/${plugin}/sse`, { signal: controller.signal }),
    { params: Promise.resolve({ plugin }) }
  );
  return { controller, response };
}

async function openAndHandshake(plugin = "known") {
  const { controller, response } = await open(plugin);
  const reader = response.body.getReader();
  await reader.read(); // the `event: endpoint` handshake frame
  return { controller, reader };
}

describe("/api/mcp/[plugin]/sse session release", () => {
  it("releases the bridge session when the client aborts", async () => {
    const { controller } = await openAndHandshake();
    expect(bridge.sessions.size).toBe(1);

    controller.abort();
    await settle();

    expect(bridge.sessions.size).toBe(0);
  });

  it("does not strand a session per reconnect", async () => {
    for (let i = 0; i < 10; i++) {
      const { controller } = await openAndHandshake();
      controller.abort();
      await settle();
    }

    // Every stranded session keeps sessions.size > 0, so the child is never reaped.
    expect(bridge.sessions.size).toBe(0);
  });

  it("still releases when the consumer cancels the stream instead", async () => {
    const { reader } = await openAndHandshake();
    expect(bridge.sessions.size).toBe(1);

    await reader.cancel();
    await settle();

    expect(bridge.sessions.size).toBe(0);
  });

  it("releases exactly once when abort and cancel both fire", async () => {
    const released = [];
    const { controller, reader } = await openAndHandshake();
    const sid = [...bridge.sessions.keys()][0];
    const realDelete = bridge.sessions.delete.bind(bridge.sessions);
    bridge.sessions.delete = (k) => { released.push(k); return realDelete(k); };

    controller.abort();
    await settle();
    await reader.cancel();
    await settle();

    expect(released).toEqual([sid]);
    bridge.sessions.delete = realDelete;
  });

  it("still 404s an unknown plugin without registering anything", async () => {
    const { response } = await open("nope");
    expect(response.status).toBe(404);
    expect(bridge.sessions.size).toBe(0);
  });
});
