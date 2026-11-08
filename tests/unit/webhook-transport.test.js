/**
 * Task 4 RED contract; parent runs this only in the approved network=none sandbox
 * with isolated loopback enabled. No live DNS, provider, webhook or proxy probe.
 *
 * Required export: sendWebhook(request, internalDependencies?) from transport.js.
 * request = { url, body: string, headers?, allowPrivateNetwork?, timeoutMs?, signal?,
 *             acknowledgementKind?: "discord" | "slack" }.
 * Internal dependencies = { lookup }, matching dns.promises.lookup(host, { all: true }).
 * Never accept DNS/socket overrides from destination input. Default deadline: 10s.
 * Resolve { status, headers } after bounded drain; no response body retained.
 * Explicit acknowledgementKind adds only acknowledged:boolean, parsed from <=8KiB
 * ephemeral bytes; invalid/oversized/incomplete acknowledgements are false.
 * Reject Error with code WEBHOOK_POLICY / WEBHOOK_TIMEOUT / WEBHOOK_NETWORK /
 * WEBHOOK_ABORTED; messages, causes and enumerable properties must be secret-free.
 *
 * Public successes mock only https.request (no real public socket). That double
 * exercises the pinned lookup and checks Host/SNI/TLS options before answering;
 * it does NOT prove a TLS handshake. Private opt-in uses real native HTTP sockets
 * and an unresolvable .invalid hostname, so a second DNS lookup cannot pass.
 */
import http from "node:http";
import https from "node:https";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendWebhook } from "@/lib/webhooks/transport.js";

const BODY = '{"id":"dummy-event","text":"alert café"}';
const PUBLIC_V4 = { address: "93.184.216.34", family: 4 };
const PUBLIC_V6 = { address: "2606:4700:4700::1111", family: 6 };
const LOCAL = { address: "127.0.0.1", family: 4 };
const servers = [];
const timers = new Set();

function lookupOf(...answers) {
  return vi.fn(async () => answers);
}

function request(url, overrides = {}) {
  return { url, body: BODY, timeoutMs: 1000, ...overrides };
}

// A socket guard is distinct from a policy rejection: removing validation must
// produce WEBHOOK_NETWORK (or a thrown sentinel), never a false-positive pass.
function guardSockets() {
  const deny = () => { throw new Error("UNEXPECTED_SOCKET"); };
  const plain = vi.spyOn(http, "request").mockImplementation(deny);
  const secure = vi.spyOn(https, "request").mockImplementation(deny);
  return () => {
    expect(plain).not.toHaveBeenCalled();
    expect(secure).not.toHaveBeenCalled();
  };
}

async function fixture(handler) {
  const journal = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      journal.push({
        method: req.method, url: req.url, headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
        localAddress: req.socket.localAddress,
      });
      handler(req, res);
    });
  });
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  return { server, journal, port, url: `http://receiver.invalid:${port}/hook` };
}

function later(callback, ms) {
  const timer = setTimeout(() => { timers.delete(timer); callback(); }, ms);
  timers.add(timer);
}

async function within(promise, ms = 1500) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("FIXTURE_DEADLINE")), ms);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("GLOBAL_FETCH_FORBIDDEN"); }));
});

afterEach(async () => {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  })));
});

describe("webhook transport blocked public policy", () => {
  it.each([
    "127.0.0.1", "127.99.1.2", "10.0.0.1", "172.16.0.1", "172.31.255.254",
    "192.168.1.1", "100.64.0.1", "0.0.0.0", "0.1.2.3", "169.254.169.254",
    "169.254.1.1", "224.0.0.1", "239.255.255.255", "255.255.255.255",
    "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254",
    "::ffff:0.0.0.0", "::ffff:224.0.0.1", "0:0:0:0:0:ffff:c0a8:101",
  ])("blocks resolved non-public address %s before opening any socket", async (address) => {
    const untouched = guardSockets();
    const lookup = lookupOf({ address, family: address.includes(":") ? 6 : 4 });
    await expect(sendWebhook(request("https://receiver.invalid/hook"), { lookup }))
      .rejects.toMatchObject({ code: "WEBHOOK_POLICY" });
    expect(lookup).toHaveBeenCalledWith("receiver.invalid", { all: true });
    untouched();
  });

  it.each([
    "127.0.0.1", "2130706433", "0x7f000001", "0177.0.0.1", "10.0.0.1",
    "169.254.169.254", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    "[::1]", "[::]", "[fd00::1]", "[fe80::1]", "[ff02::1]",
    "[::ffff:127.0.0.1]", "[::ffff:a9fe:a9fe]",
  ])("blocks canonicalized literal %s without trusting injected public DNS", async (host) => {
    const untouched = guardSockets();
    const lookup = lookupOf(PUBLIC_V4);
    await expect(sendWebhook(request(`https://${host}/hook`), { lookup }))
      .rejects.toMatchObject({ code: "WEBHOOK_POLICY" });
    expect(lookup).not.toHaveBeenCalled();
    untouched();
  });

  it.each([
    [PUBLIC_V4, LOCAL], [LOCAL, PUBLIC_V4],
    [PUBLIC_V6, { address: "fd00::1", family: 6 }],
  ])("rejects every mixed DNS answer set, not just its selected first address (%j)", async (...answers) => {
    const untouched = guardSockets();
    await expect(sendWebhook(request("https://receiver.invalid/hook"), {
      lookup: lookupOf(...answers),
    })).rejects.toMatchObject({ code: "WEBHOOK_POLICY" });
    untouched();
  });

  it.each([[], [{ address: "not-an-ip", family: 4 }], [{ address: "127.1", family: 4 }]])
    ("fails closed for empty or malformed DNS results %j", async (...answers) => {
      const untouched = guardSockets();
      await expect(sendWebhook(request("https://receiver.invalid/hook"), {
        lookup: lookupOf(...answers),
      })).rejects.toMatchObject({ code: "WEBHOOK_POLICY" });
      untouched();
    });

  it("blocks plaintext HTTP even when DNS would return a public address", async () => {
    const untouched = guardSockets();
    await expect(sendWebhook(request("http://receiver.invalid/hook"), {
      lookup: lookupOf(PUBLIC_V4),
    })).rejects.toMatchObject({ code: "WEBHOOK_POLICY" });
    untouched();
  });
});

describe("webhook transport blocked in both network modes", () => {
  it.each([false, true])("never allows metadata/link-local/special addresses (private opt-in=%s)", async (allowPrivateNetwork) => {
    const untouched = guardSockets();
    for (const address of [
      "169.254.169.254", "169.254.170.2", "169.254.1.1", "100.100.100.200",
      "0.0.0.0", "0.1.2.3", "224.0.0.1", "255.255.255.255",
      "::", "fe80::1", "ff02::1", "::ffff:a9fe:a9fe", "::ffff:0:0",
      "::ffff:e000:1", "::ffff:ffff:ffff",
    ]) {
      await expect(sendWebhook(request("https://receiver.invalid/hook", { allowPrivateNetwork }), {
        lookup: lookupOf({ address, family: address.includes(":") ? 6 : 4 }),
      })).rejects.toMatchObject({ code: "WEBHOOK_POLICY" });
      const host = address.includes(":") ? `[${address}]` : address;
      const lookup = lookupOf(PUBLIC_V4);
      await expect(sendWebhook(request(`https://${host}/hook`, { allowPrivateNetwork }), { lookup }))
        .rejects.toMatchObject({ code: "WEBHOOK_POLICY" });
      expect(lookup).not.toHaveBeenCalled();
    }
    untouched();
  });

  it.each([false, true])("blocks known metadata hostnames despite a public DNS answer (private opt-in=%s)", async (allowPrivateNetwork) => {
    const untouched = guardSockets();
    for (const host of ["metadata.google.internal", "METADATA.GOOGLE.INTERNAL.", "instance-data.ec2.internal"]) {
      await expect(sendWebhook(request(`https://${host}/hook`, { allowPrivateNetwork }), {
        lookup: lookupOf(PUBLIC_V4),
      })).rejects.toMatchObject({ code: "WEBHOOK_POLICY" });
    }
    untouched();
  });

  it.each([
    "ftp://receiver.invalid/hook", "file:///etc/hosts", "not a url",
    "https://dummy-user:dummy-password@receiver.invalid/hook",
    "https://receiver.invalid/hook#dummy-fragment",
  ])("rechecks unsafe URL syntax at the transport boundary: %s", async (url) => {
    const untouched = guardSockets();
    await expect(sendWebhook(request(url, { allowPrivateNetwork: true }), {
      lookup: lookupOf(LOCAL),
    })).rejects.toMatchObject({ code: "WEBHOOK_POLICY" });
    untouched();
  });
});

describe("webhook transport allowed HTTPS without public sockets", () => {
  it.each([
    [PUBLIC_V4, false, 202], [PUBLIC_V6, false, 202], [PUBLIC_V4, false, 302],
    [{ address: "10.1.2.3", family: 4 }, true, 202],
    [{ address: "172.16.1.2", family: 4 }, true, 202],
    [{ address: "192.168.1.2", family: 4 }, true, 202],
    [{ address: "fd00::1", family: 6 }, true, 202],
  ])("pins validated address %j (private=%s, status=%s) and preserves TLS identity", async (answer, allowPrivateNetwork, status) => {
    const lookup = lookupOf(answer);
    const observed = {};
    const plain = vi.spyOn(http, "request").mockImplementation(() => {
      throw new Error("HTTP_DOWNGRADE_FORBIDDEN");
    });
    const secure = vi.spyOn(https, "request").mockImplementation((...args) => {
      const input = args[0];
      const url = typeof input === "string" || input instanceof URL ? new URL(input) : null;
      const options = url ? args[1] : input;
      const callback = args.find((arg) => typeof arg === "function");
      observed.options = options;
      observed.hostname = options.hostname ?? options.host ?? url?.hostname;
      observed.host = options.headers?.Host ?? options.headers?.host ?? observed.hostname;
      // ClientRequest finish ends the upload, not the connection awaiting a response.
      const outgoing = new PassThrough({ autoDestroy: false });
      const chunks = [];
      outgoing.on("data", (chunk) => chunks.push(chunk));
      if (callback) outgoing.once("response", callback);
      outgoing.once("finish", async () => {
        try {
          observed.body = Buffer.concat(chunks).toString("utf8");
          if (options.lookup) {
            observed.pinned = await new Promise((resolve, reject) => {
              options.lookup("receiver.invalid", { all: true }, (error, addresses) => {
                if (error) reject(error);
                else resolve(addresses);
              });
            });
          }
          const incoming = new PassThrough();
          incoming.statusCode = status;
          incoming.headers = { "retry-after": "9", location: "http://127.0.0.1/private" };
          expect(outgoing.destroyed).toBe(false);
          outgoing.emit("response", incoming);
          incoming.end("ignored");
        } catch (error) { outgoing.destroy(error); }
      });
      return outgoing;
    });

    const result = await within(sendWebhook(request("https://receiver.invalid/hook", {
      allowPrivateNetwork,
    }), { lookup }));

    expect(result).toMatchObject({ status, headers: { "retry-after": "9" } });
    expect(result).not.toHaveProperty("body");
    expect(secure).toHaveBeenCalledTimes(1);
    expect(plain).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledExactlyOnceWith("receiver.invalid", { all: true });
    expect(observed.options.method).toBe("POST");
    expect(observed.options.agent).toBe(false);
    expect(observed.options.servername).toBe("receiver.invalid");
    expect(observed.options.rejectUnauthorized).not.toBe(false);
    expect(observed.options.checkServerIdentity).toBeUndefined();
    expect(observed.host).toBe("receiver.invalid");
    expect(observed.body).toBe(BODY);
    if (observed.options.lookup) expect(observed.pinned).toEqual([answer]);
    else expect(observed.hostname).toBe(answer.address);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("does not retry certificate failures using HTTP or insecure TLS", async () => {
    const untouched = vi.spyOn(http, "request");
    const secure = vi.spyOn(https, "request").mockImplementation(() => {
      const outgoing = new PassThrough();
      queueMicrotask(() => outgoing.destroy(Object.assign(new Error("certificate rejected"), {
        code: "ERR_TLS_CERT_ALTNAME_INVALID",
      })));
      return outgoing;
    });
    await expect(sendWebhook(request("https://receiver.invalid/hook"), {
      lookup: lookupOf(PUBLIC_V4),
    })).rejects.toMatchObject({ code: "WEBHOOK_NETWORK" });
    expect(secure).toHaveBeenCalledTimes(1);
    expect(untouched).not.toHaveBeenCalled();
  });
});

describe("webhook transport allowed local fixture with explicit private opt-in", () => {
  it("uses the validated socket once while preserving original Host, path and POST bytes", async () => {
    const receiver = await fixture((_req, res) => res.writeHead(204).end());
    const lookup = lookupOf(LOCAL);
    lookup.mockResolvedValueOnce([LOCAL]).mockResolvedValue([PUBLIC_V4]);
    const result = await sendWebhook(request(`${receiver.url}?tenant=dummy`, {
      allowPrivateNetwork: true,
      headers: { Authorization: "Bearer dummy-auth", "X-Dummy": "fixture" },
    }), { lookup });
    expect(result.status).toBe(204);
    expect(receiver.journal).toHaveLength(1);
    expect(receiver.journal[0]).toMatchObject({
      method: "POST", url: "/hook?tenant=dummy", body: BODY, localAddress: "127.0.0.1",
      headers: {
        host: `receiver.invalid:${receiver.port}`, "content-type": "application/json",
        "content-length": String(Buffer.byteLength(BODY)),
        authorization: "Bearer dummy-auth", "x-dummy": "fixture",
      },
    });
    expect(lookup).toHaveBeenCalledExactlyOnceWith("receiver.invalid", { all: true });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("allows localhost HTTP only when opted in and does not resolve IP literals", async () => {
    const receiver = await fixture((_req, res) => res.writeHead(204).end());
    const lookup = lookupOf(LOCAL);
    expect((await sendWebhook(request(`http://localhost:${receiver.port}/hook`, {
      allowPrivateNetwork: true,
    }), { lookup })).status).toBe(204);
    expect(lookup).toHaveBeenCalledExactlyOnceWith("localhost", { all: true });
    lookup.mockClear();
    expect((await sendWebhook(request(`http://127.0.0.1:${receiver.port}/hook`, {
      allowPrivateNetwork: true,
    }), { lookup })).status).toBe(204);
    expect(lookup).not.toHaveBeenCalled();
    expect(receiver.journal).toHaveLength(2);
  });

  it("revalidates DNS on each attempt without reusing a stale pooled socket", async () => {
    const receiver = await fixture((_req, res) => res.writeHead(204).end());
    const lookup = lookupOf(LOCAL);
    lookup.mockResolvedValueOnce([LOCAL]).mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    const options = request(receiver.url, { allowPrivateNetwork: true });
    expect((await sendWebhook(options, { lookup })).status).toBe(204);
    await expect(sendWebhook(options, { lookup })).rejects.toMatchObject({ code: "WEBHOOK_POLICY" });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(receiver.journal).toHaveLength(1);
  });

  it.each([301, 302, 303, 307, 308])("returns redirect %s without forwarding the POST or credentials", async (status) => {
    const trap = await fixture((_req, res) => res.writeHead(204).end());
    const receiver = await fixture((_req, res) => res.writeHead(status, {
      Location: `http://127.0.0.1:${trap.port}/stolen`,
    }).end());
    const result = await sendWebhook(request(receiver.url, {
      allowPrivateNetwork: true, headers: { Authorization: "Bearer dummy-auth" },
    }), { lookup: lookupOf(LOCAL) });
    expect(result.status).toBe(status);
    expect(receiver.journal).toHaveLength(1);
    expect(trap.journal).toHaveLength(0);
  });

  it("ignores environment proxies and the globally patched fetch", async () => {
    const trap = await fixture((_req, res) => res.writeHead(502).end());
    const receiver = await fixture((_req, res) => res.writeHead(204).end());
    for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
      vi.stubEnv(name, `http://127.0.0.1:${trap.port}`);
    }
    vi.stubEnv("NO_PROXY", "");
    vi.stubEnv("no_proxy", "");
    expect((await sendWebhook(request(receiver.url, {
      allowPrivateNetwork: true,
    }), { lookup: lookupOf(LOCAL) })).status).toBe(204);
    expect(receiver.journal).toHaveLength(1);
    expect(trap.journal).toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("webhook transport bounded lifecycle", () => {
  it("destroys a connection that never reaches response headers within the total deadline", async () => {
    vi.useFakeTimers();
    const outgoing = new PassThrough({ autoDestroy: false });
    outgoing.resume();
    outgoing.on("error", () => {});
    vi.spyOn(https, "request").mockReturnValue(outgoing);
    let outcome;
    const sending = sendWebhook(request("https://receiver.invalid/hook", { timeoutMs: 80 }), {
      lookup: lookupOf(PUBLIC_V4),
    }).then((value) => { outcome = { value }; }, (error) => { outcome = { error }; });
    await vi.advanceTimersByTimeAsync(79);
    expect(outcome).toBeUndefined();
    expect(outgoing.destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome?.error).toMatchObject({ code: "WEBHOOK_TIMEOUT" });
    expect(outgoing.destroyed).toBe(true);
    await sending;
  });

  it.each([undefined, 80])("includes stalled DNS in the total deadline (timeoutMs=%s)", async (timeoutMs) => {
    vi.useFakeTimers();
    const untouched = guardSockets();
    let resolveLookup;
    const lookup = vi.fn(() => new Promise((resolve) => { resolveLookup = resolve; }));
    let outcome;
    const sending = sendWebhook(request("https://receiver.invalid/hook", { timeoutMs }), { lookup })
      .then((value) => { outcome = { value }; }, (error) => { outcome = { error }; });
    await vi.advanceTimersByTimeAsync(timeoutMs ?? 10_000);
    expect(outcome?.error).toMatchObject({ code: "WEBHOOK_TIMEOUT" });
    resolveLookup([PUBLIC_V4]);
    await vi.advanceTimersByTimeAsync(1);
    await sending;
    untouched();
  });

  it.each(["headers", "body"])("closes a slow %s socket at the total deadline, not just inactivity", async (phase) => {
    let closed;
    const disconnected = new Promise((resolve) => { closed = resolve; });
    const receiver = await fixture((_req, res) => {
      res.once("close", closed);
      if (phase === "body") {
        res.writeHead(200);
        const drip = () => {
          if (res.destroyed) return;
          res.write("x");
          later(drip, 20);
        };
        drip();
      }
    });
    const start = performance.now();
    await expect(within(sendWebhook(request(receiver.url, {
      allowPrivateNetwork: true, timeoutMs: 100,
    }), { lookup: lookupOf(LOCAL) }))).rejects.toMatchObject({ code: "WEBHOOK_TIMEOUT" });
    expect(performance.now() - start).toBeLessThan(1000);
    await within(disconnected);
    expect(receiver.journal).toHaveLength(1);
  });

  it("does not reset the deadline after DNS resolves", async () => {
    let closed;
    const disconnected = new Promise((resolve) => { closed = resolve; });
    const receiver = await fixture((_req, res) => {
      res.once("close", closed);
      res.writeHead(200);
      res.write("partial");
      later(() => res.end("late"), 300);
    });
    const lookup = vi.fn(() => new Promise((resolve) => later(() => resolve([LOCAL]), 150)));
    const start = performance.now();
    await expect(within(sendWebhook(request(receiver.url, {
      allowPrivateNetwork: true, timeoutMs: 250,
    }), { lookup }))).rejects.toMatchObject({ code: "WEBHOOK_TIMEOUT" });
    expect(performance.now() - start).toBeLessThan(375);
    await within(disconnected);
  });

  it.each([8192, 8193])("discards a %s-byte response without retaining its body or waiting for oversized EOF", async (size) => {
    let closed;
    const disconnected = new Promise((resolve) => { closed = resolve; });
    const receiver = await fixture((_req, res) => {
      res.once("close", closed);
      res.writeHead(202, { "retry-after": "7" });
      res.write(Buffer.alloc(size, "s"));
      if (size === 8192) res.end();
    });
    const result = await within(sendWebhook(request(receiver.url, {
      allowPrivateNetwork: true, timeoutMs: 800,
    }), { lookup: lookupOf(LOCAL) }));
    expect(result).toEqual({ status: 202, headers: expect.objectContaining({ "retry-after": "7" }) });
    await within(disconnected);
    expect(JSON.stringify(result)).not.toContain("ssssssss");
  });

  it("closes at the 8 KiB drain ceiling without waiting for another chunk or EOF", async () => {
    let closed;
    const disconnected = new Promise((resolve) => { closed = resolve; });
    const receiver = await fixture((_req, res) => {
      res.once("close", closed);
      res.writeHead(200);
      res.write(Buffer.alloc(8192, "s"));
    });
    const result = await within(sendWebhook(request(receiver.url, {
      allowPrivateNetwork: true, timeoutMs: 800,
    }), { lookup: lookupOf(LOCAL) }));
    expect(result.status).toBe(200);
    await within(disconnected);
  });

  it("aborts an in-flight socket without waiting for its response", async () => {
    const controller = new AbortController();
    let closed;
    const disconnected = new Promise((resolve) => { closed = resolve; });
    const receiver = await fixture((_req, res) => {
      res.once("close", closed);
      controller.abort();
    });
    await expect(within(sendWebhook(request(receiver.url, {
      allowPrivateNetwork: true, signal: controller.signal,
    }), { lookup: lookupOf(LOCAL) }))).rejects.toMatchObject({ code: "WEBHOOK_ABORTED" });
    await within(disconnected);
  });

  it("does not resolve DNS or open sockets for an already aborted request", async () => {
    const untouched = guardSockets();
    const controller = new AbortController();
    controller.abort();
    const lookup = lookupOf(PUBLIC_V4);
    await expect(sendWebhook(request("https://receiver.invalid/hook", {
      signal: controller.signal,
    }), { lookup })).rejects.toMatchObject({ code: "WEBHOOK_ABORTED" });
    expect(lookup).not.toHaveBeenCalled();
    untouched();
  });
});

describe("webhook transport secret-free errors", () => {
  it.each(["dns", "socket", "userinfo"])("never exposes URL, header or raw cause credentials on %s failure", async (failure) => {
    const url = failure === "userinfo"
      ? "https://dummy-user:dummy-password@receiver.invalid/dummy-token?key=dummy-query"
      : "https://receiver.invalid/dummy-token?key=dummy-query";
    const secretMessage = `${url} Bearer dummy-auth dummy-signature`;
    const lookup = failure === "dns"
      ? vi.fn(async () => { throw new Error(secretMessage); }) : lookupOf(PUBLIC_V4);
    const secure = vi.spyOn(https, "request").mockImplementation(() => {
      const outgoing = new PassThrough();
      queueMicrotask(() => outgoing.destroy(new Error(secretMessage)));
      return outgoing;
    });
    let caught;
    try {
      await sendWebhook(request(url, {
        headers: { Authorization: "Bearer dummy-auth", "webhook-signature": "dummy-signature" },
      }), { lookup });
    } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.code).toBe(failure === "userinfo" ? "WEBHOOK_POLICY" : "WEBHOOK_NETWORK");
    const exposed = JSON.stringify(caught, Object.getOwnPropertyNames(caught));
    for (const secret of [
      "dummy-user", "dummy-password", "dummy-token", "dummy-query", "dummy-auth", "dummy-signature",
    ]) {
      expect(String(caught)).not.toContain(secret);
      expect(exposed).not.toContain(secret);
      expect(String(caught.cause)).not.toContain(secret);
    }
    if (failure !== "socket") expect(secure).not.toHaveBeenCalled();
  });
});

describe("webhook transport bounded acknowledgement contract for task 5", () => {
  it.each([
    ["slack", 200, " \nok\t", true],
    ["slack", 200, "invalid_payload", false],
    ["slack", 202, "ok", false],
    ["slack", 204, "", false],
    ["discord", 200, '{"id":"dummy-message","content":"dummy-ack-secret"}', true],
    ["discord", 200, '{"id":123}', false],
    ["discord", 200, '{"id":""}', false],
    ["discord", 200, '{"content":"dummy-ack-secret"}', false],
    ["discord", 200, '[{"id":"dummy-message"}]', false],
    ["discord", 200, "null", false],
    ["discord", 200, "not json", false],
    ["discord", 204, "", false],
  ])("returns only acknowledgement for %s status=%s body=%j", async (acknowledgementKind, status, body, acknowledged) => {
    const receiver = await fixture((_req, res) => res.writeHead(status).end(body));
    const result = await sendWebhook(request(receiver.url, {
      allowPrivateNetwork: true, acknowledgementKind,
    }), { lookup: lookupOf(LOCAL) });
    expect(result).toEqual({ status, headers: expect.any(Object), acknowledged });
    expect(JSON.stringify(result)).not.toContain("dummy-ack-secret");
    expect(receiver.journal).toHaveLength(1);
  });

  it.each(["slack", "discord"])("rejects a valid-looking %s prefix when the response exceeds 8 KiB", async (acknowledgementKind) => {
    let closed;
    const disconnected = new Promise((resolve) => { closed = resolve; });
    const prefix = acknowledgementKind === "slack" ? "ok" : '{"id":"dummy-message"}';
    const receiver = await fixture((_req, res) => {
      res.once("close", closed);
      res.writeHead(200);
      res.write(prefix + " ".repeat(8193 - Buffer.byteLength(prefix)));
    });
    const result = await within(sendWebhook(request(receiver.url, {
      allowPrivateNetwork: true, acknowledgementKind, timeoutMs: 800,
    }), { lookup: lookupOf(LOCAL) }));
    expect(result).toEqual({ status: 200, headers: expect.any(Object), acknowledged: false });
    await within(disconnected);
  });

  it("does not acknowledge a valid prefix of an unfinished response at the ceiling", async () => {
    const receiver = await fixture((_req, res) => {
      res.writeHead(200);
      res.write("ok" + " ".repeat(8190));
    });
    const result = await within(sendWebhook(request(receiver.url, {
      allowPrivateNetwork: true, acknowledgementKind: "slack", timeoutMs: 800,
    }), { lookup: lookupOf(LOCAL) }));
    expect(result.acknowledged).toBe(false);
  });

  it("accepts a complete 8 KiB acknowledgement without retaining any response bytes", async () => {
    const receiver = await fixture((_req, res) => res.writeHead(200, {
      "content-length": "8192",
    }).end("ok" + " ".repeat(8190)));
    const result = await sendWebhook(request(receiver.url, {
      allowPrivateNetwork: true, acknowledgementKind: "slack",
    }), { lookup: lookupOf(LOCAL) });
    expect(result).toEqual({ status: 200, headers: expect.any(Object), acknowledged: true });
  });

  it("keeps the default result exactly status and headers even for a valid acknowledgement", async () => {
    const receiver = await fixture((_req, res) => res.writeHead(200).end('{"id":"dummy-ack-secret"}'));
    const result = await sendWebhook(request(receiver.url, {
      allowPrivateNetwork: true,
    }), { lookup: lookupOf(LOCAL) });
    expect(result).toEqual({ status: 200, headers: expect.any(Object) });
    expect(JSON.stringify(result)).not.toContain("dummy-ack-secret");
  });
});
