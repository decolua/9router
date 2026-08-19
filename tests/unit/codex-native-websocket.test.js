import http from "node:http";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";

const require = createRequire(import.meta.url);
const {
  attachCodexNativeGateway,
  codexCompactionHttpBody,
  codexRequestIsCompaction,
  isNativeUpgrade,
  safeHandshakeHeaders,
  semanticEvent,
} = require("../../server/codexNativeGateway.cjs");

const servers = [];
const listen = (server) => new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => {
    servers.push(server);
    resolve(server.address().port);
  });
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise((resolve) => server.close(() => resolve()))
  ));
});

describe("Codex Native WebSocket gateway", () => {
  it("detects compaction from per-turn metadata and strips only the HTTP envelope", () => {
    const metadata = (requestKind, trigger = "auto") => JSON.stringify({
      request_kind: requestKind,
      compaction: { trigger },
    });
    const manual = {
      type: "response.create",
      model: "gpt-native",
      input: [{ role: "user", content: "full transcript" }],
      client_metadata: { "x-codex-turn-metadata": metadata("compaction", "manual") },
    };
    const automatic = {
      ...manual,
      client_metadata: { "x-codex-turn-metadata": metadata(" COMPACTION ") },
    };

    expect(codexRequestIsCompaction(manual)).toBe(true);
    expect(codexRequestIsCompaction(automatic)).toBe(true);
    expect(codexRequestIsCompaction({
      ...manual,
      client_metadata: { "x-codex-turn-metadata": metadata("turn") },
    })).toBe(false);
    expect(codexRequestIsCompaction({
      ...manual,
      client_metadata: { "x-codex-turn-metadata": "not-json" },
    })).toBe(false);
    expect(codexRequestIsCompaction({ ...manual, client_metadata: {} })).toBe(false);

    const httpBody = JSON.parse(codexCompactionHttpBody(manual));
    expect(httpBody.type).toBeUndefined();
    expect(httpBody.stream).toBe(true);
    expect(httpBody.input).toEqual(manual.input);
    expect(httpBody.client_metadata).toEqual(manual.client_metadata);
  });

  it("routes only the compaction turn over HTTP and keeps the WebSocket reusable", async () => {
    const upstreamHttp = http.createServer();
    const upstreamWss = new WebSocketServer({ server: upstreamHttp });
    const upstreamPort = await listen(upstreamHttp);
    const upstreamFrames = [];
    upstreamWss.on("connection", (socket) => {
      socket.on("message", (data) => {
        const event = JSON.parse(data.toString());
        upstreamFrames.push(event);
        socket.send(JSON.stringify({
          type: "response.completed",
          response: { id: `ws-${upstreamFrames.length}` },
        }));
      });
    });

    const actions = [];
    const fakeFetch = async (url, options) => {
      const action = new URL(url).pathname.split("/").pop();
      const payload = JSON.parse(options.body);
      actions.push({ action, payload });
      if (action === "acquire") {
        return Response.json({
          leaseId: "lease-http-compaction",
          connectionId: "account-http-compaction",
          upstreamHeaders: { authorization: "Bearer upstream-token" },
          proxy: { enabled: false },
        });
      }
      return Response.json({ success: true, valid: true });
    };

    const httpRequests = [];
    const httpFetch = async (url, options) => {
      httpRequests.push({ url, options });
      const encoder = new TextEncoder();
      const payload = [
        'data: {"type":"response.output_text.delta","delta":"summary"}\r\n\r\n',
        'data: {"type":"response.completed","response":{"id":"compact-1"}}\r\n\r\n',
        "data: [DONE]\r\n\r\n",
      ].join("");
      return new Response(new ReadableStream({
        start(controller) {
          const split = Math.floor(payload.length / 2);
          controller.enqueue(encoder.encode(payload.slice(0, split)));
          controller.enqueue(encoder.encode(payload.slice(split)));
          controller.close();
        },
      }), { headers: { "content-type": "text/event-stream" } });
    };

    const gatewayHttp = http.createServer();
    attachCodexNativeGateway(gatewayHttp, {
      secret: "secret",
      fetch: fakeFetch,
      httpFetch,
      upstreamUrl: `ws://127.0.0.1:${upstreamPort}`,
    });
    const gatewayPort = await listen(gatewayHttp);
    const socket = new WebSocket(`ws://127.0.0.1:${gatewayPort}/v1/codex/responses`, {
      headers: {
        authorization: "Bearer client-api-key",
        "openai-beta": "responses_websockets=2026-02-06",
        "session-id": "session-compaction",
      },
    });
    const queuedMessages = [];
    const messageWaiters = [];
    socket.on("message", (data) => {
      const value = data.toString();
      const waiter = messageWaiters.shift();
      if (waiter) waiter(value);
      else queuedMessages.push(value);
    });
    const nextMessage = () => queuedMessages.length
      ? Promise.resolve(queuedMessages.shift())
      : new Promise((resolve) => messageWaiters.push(resolve));
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });

    const firstTurn = {
      type: "response.create",
      model: "gpt-native",
      input: [{ role: "user", content: "normal turn" }],
    };
    socket.send(JSON.stringify(firstTurn));
    expect(JSON.parse(await nextMessage()).type).toBe("response.completed");

    const transcript = "x".repeat(256 * 1024);
    const compactTurn = {
      type: "response.create",
      model: "gpt-native",
      input: [{ role: "user", content: transcript }],
      client_metadata: {
        "x-codex-turn-metadata": JSON.stringify({
          request_kind: "compaction",
          compaction: { trigger: "auto", reason: "context_limit" },
        }),
      },
    };
    socket.send(JSON.stringify(compactTurn));
    expect(JSON.parse(await nextMessage())).toMatchObject({
      type: "response.output_text.delta",
      delta: "summary",
    });
    expect(JSON.parse(await nextMessage())).toMatchObject({
      type: "response.completed",
      response: { id: "compact-1" },
    });

    expect(upstreamFrames).toEqual([firstTurn]);
    expect(httpRequests).toHaveLength(1);
    expect(httpRequests[0].url).toContain("/v1/codex/responses");
    const forwardedCompact = JSON.parse(httpRequests[0].options.body);
    expect(forwardedCompact.type).toBeUndefined();
    expect(forwardedCompact.stream).toBe(true);
    expect(forwardedCompact.input[0].content).toBe(transcript);
    expect(httpRequests[0].options.headers.authorization).toBe("Bearer client-api-key");
    expect(httpRequests[0].options.headers.connection).toBeUndefined();
    expect(httpRequests[0].options.headers.upgrade).toBeUndefined();
    expect(httpRequests[0].options.headers["openai-beta"]).toBeUndefined();

    const finalTurn = {
      type: "response.create",
      model: "gpt-native",
      previous_response_id: "compact-1",
      input: [{ role: "user", content: "continue normally" }],
    };
    socket.send(JSON.stringify(finalTurn));
    expect(JSON.parse(await nextMessage())).toMatchObject({
      type: "response.completed",
      response: { id: "ws-2" },
    });
    expect(upstreamFrames).toEqual([firstTurn, finalTurn]);
    expect(actions.filter(({ action }) => action === "acquire")).toHaveLength(1);

    const closed = new Promise((resolve) => socket.once("close", resolve));
    socket.close(1000, "done");
    await closed;
  });

  it("propagates close 1009 after partial output without replay or account cooldown", async () => {
    const upstreamHttp = http.createServer();
    const upstreamWss = new WebSocketServer({ server: upstreamHttp });
    const upstreamPort = await listen(upstreamHttp);
    upstreamWss.on("connection", (socket) => {
      socket.once("message", () => {
        socket.send(JSON.stringify({
          type: "response.output_text.delta",
          delta: "partial",
        }));
        socket.close(1009, "message too big");
      });
    });

    let acquires = 0;
    const actions = [];
    const gatewayHttp = http.createServer();
    attachCodexNativeGateway(gatewayHttp, {
      secret: "secret",
      upstreamUrl: `ws://127.0.0.1:${upstreamPort}`,
      fetch: async (url) => {
        const action = new URL(url).pathname.split("/").pop();
        actions.push(action);
        if (action === "acquire") {
          acquires += 1;
          return Response.json({
            leaseId: `lease-${acquires}`,
            connectionId: `account-${acquires}`,
            upstreamHeaders: {},
            proxy: { enabled: false },
          });
        }
        return Response.json({ success: true, valid: true });
      },
    });
    const gatewayPort = await listen(gatewayHttp);
    const close = await new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${gatewayPort}/v1/codex/responses`);
      socket.on("open", () => socket.send(JSON.stringify({
        type: "response.create",
        model: "gpt-native",
        input: [{ role: "user", content: "oversized but unclassified" }],
      })));
      socket.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
      socket.on("error", reject);
    });

    expect(close.code).toBe(1009);
    expect(close.reason).toContain("message too big");
    expect(acquires).toBe(1);
    expect(actions).not.toContain("failure");
  });

  it("does not treat a close after partial semantic output as an idle disconnect", async () => {
    const upstreamHttp = http.createServer();
    const upstreamWss = new WebSocketServer({ server: upstreamHttp });
    const upstreamPort = await listen(upstreamHttp);
    upstreamWss.on("connection", (socket) => {
      socket.once("message", () => {
        socket.send(JSON.stringify({
          type: "response.output_text.delta",
          delta: "partial",
        }));
        socket.close(1011, "partial response failed");
      });
    });

    let acquires = 0;
    const actions = [];
    const gatewayHttp = http.createServer();
    attachCodexNativeGateway(gatewayHttp, {
      secret: "secret",
      upstreamUrl: `ws://127.0.0.1:${upstreamPort}`,
      fetch: async (url) => {
        const action = new URL(url).pathname.split("/").pop();
        actions.push(action);
        if (action === "acquire") {
          acquires += 1;
          return Response.json({
            leaseId: `lease-${acquires}`,
            connectionId: `account-${acquires}`,
            upstreamHeaders: {},
            proxy: { enabled: false },
          });
        }
        return Response.json({ success: true, valid: true });
      },
    });
    const gatewayPort = await listen(gatewayHttp);
    const close = await new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${gatewayPort}/v1/codex/responses`);
      socket.on("open", () => socket.send(JSON.stringify({
        type: "response.create",
        model: "gpt-native",
        input: [{ role: "user", content: "partial turn" }],
      })));
      socket.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
      socket.on("error", reject);
    });

    expect(close).toEqual({ code: 1011, reason: "partial response failed" });
    expect(acquires).toBe(1);
    expect(actions).toContain("failure");
  });

  it("reconnects after an idle upstream close without replaying a prior turn", async () => {
    const upstreamHttp = http.createServer();
    const upstreamWss = new WebSocketServer({ server: upstreamHttp });
    const upstreamPort = await listen(upstreamHttp);
    const connections = [];
    upstreamWss.on("connection", (socket) => {
      const record = { socket, frames: [] };
      connections.push(record);
      socket.on("message", (data) => {
        const event = JSON.parse(data.toString());
        record.frames.push(event);
        if (connections.length > 1) {
          socket.send(JSON.stringify({
            type: "response.completed",
            response: { id: "reconnected" },
          }));
        }
      });
    });

    let acquires = 0;
    const fakeFetch = async (url) => {
      const action = new URL(url).pathname.split("/").pop();
      if (action === "acquire") {
        acquires += 1;
        return Response.json({
          leaseId: `lease-${acquires}`,
          connectionId: `account-${acquires}`,
          upstreamHeaders: {},
          proxy: { enabled: false },
        });
      }
      return Response.json({ success: true, valid: true });
    };
    const httpFetch = async () => new Response(
      'data: {"type":"response.completed","response":{"id":"compact"}}\n\ndata: [DONE]\n\n',
      { headers: { "content-type": "text/event-stream" } }
    );

    const gatewayHttp = http.createServer();
    attachCodexNativeGateway(gatewayHttp, {
      secret: "secret",
      fetch: fakeFetch,
      httpFetch,
      upstreamUrl: `ws://127.0.0.1:${upstreamPort}`,
    });
    const gatewayPort = await listen(gatewayHttp);
    const socket = new WebSocket(`ws://127.0.0.1:${gatewayPort}/v1/codex/responses`, {
      headers: { "session-id": "idle-close-session" },
    });
    const messages = [];
    socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });

    const firstTurn = {
      type: "response.create",
      model: "gpt-native",
      input: [{ role: "user", content: "unfinished" }],
    };
    socket.send(JSON.stringify(firstTurn));
    await vi.waitFor(() => expect(connections[0]?.frames).toHaveLength(1));

    socket.send(JSON.stringify({
      type: "response.create",
      model: "gpt-native",
      input: [{ role: "user", content: "compact" }],
      client_metadata: {
        "x-codex-turn-metadata": JSON.stringify({ request_kind: "compaction" }),
      },
    }));
    await vi.waitFor(() => expect(messages.some((event) => event.type === "response.completed")).toBe(true));

    connections[0].socket.close(1000, "idle");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const finalTurn = {
      type: "response.create",
      model: "gpt-native",
      input: [{ role: "user", content: "continue" }],
    };
    socket.send(JSON.stringify(finalTurn));
    await vi.waitFor(() => expect(connections[1]?.frames).toEqual([finalTurn]));
    expect(connections[0].frames).toEqual([firstTurn]);
    expect(acquires).toBe(2);

    const closed = new Promise((resolve) => socket.once("close", resolve));
    socket.close(1000, "done");
    await closed;
  });

  it("returns a terminal failure when compaction HTTP ends without a terminal event", async () => {
    const upstreamHttp = http.createServer();
    const upstreamWss = new WebSocketServer({ server: upstreamHttp });
    const upstreamPort = await listen(upstreamHttp);
    upstreamWss.on("connection", () => {});
    const fakeFetch = async (url) => {
      const action = new URL(url).pathname.split("/").pop();
      if (action === "acquire") {
        return Response.json({
          leaseId: "lease-incomplete",
          connectionId: "account-incomplete",
          upstreamHeaders: {},
          proxy: { enabled: false },
        });
      }
      return Response.json({ success: true, valid: true });
    };
    const gatewayHttp = http.createServer();
    attachCodexNativeGateway(gatewayHttp, {
      secret: "secret",
      fetch: fakeFetch,
      httpFetch: async () => new Response(
        'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
        { headers: { "content-type": "text/event-stream" } }
      ),
      upstreamUrl: `ws://127.0.0.1:${upstreamPort}`,
    });
    const gatewayPort = await listen(gatewayHttp);
    const socket = new WebSocket(`ws://127.0.0.1:${gatewayPort}/v1/codex/responses`);
    const messages = [];
    socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.send(JSON.stringify({
      type: "response.create",
      model: "gpt-native",
      input: [{ role: "user", content: "compact" }],
      client_metadata: {
        "x-codex-turn-metadata": JSON.stringify({ request_kind: "compaction" }),
      },
    }));
    await vi.waitFor(() => expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "response.output_text.delta" }),
      expect.objectContaining({ type: "response.failed" }),
    ])));
    const closed = new Promise((resolve) => socket.once("close", resolve));
    socket.close(1000, "done");
    await closed;
  });

  it("aborts a pending HTTP compaction without replaying or cooling down an account", async () => {
    const upstreamHttp = http.createServer();
    const upstreamWss = new WebSocketServer({ server: upstreamHttp });
    const upstreamPort = await listen(upstreamHttp);
    upstreamWss.on("connection", () => {});
    const actions = [];
    let httpStarted;
    const httpStartedPromise = new Promise((resolve) => { httpStarted = resolve; });
    let aborted = false;
    const fakeFetch = async (url, options) => {
      const action = new URL(url).pathname.split("/").pop();
      const payload = options?.body ? JSON.parse(options.body) : {};
      actions.push({ action, payload });
      if (action === "acquire") {
        return Response.json({
          leaseId: "lease-cancel",
          connectionId: "account-cancel",
          upstreamHeaders: {},
          proxy: { enabled: false },
        });
      }
      return Response.json({ success: true, valid: true });
    };
    const gatewayHttp = http.createServer();
    attachCodexNativeGateway(gatewayHttp, {
      secret: "secret",
      fetch: fakeFetch,
      httpFetch: async (_url, options) => {
        httpStarted();
        return await new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            aborted = true;
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
      },
      upstreamUrl: `ws://127.0.0.1:${upstreamPort}`,
    });
    const gatewayPort = await listen(gatewayHttp);
    const socket = new WebSocket(`ws://127.0.0.1:${gatewayPort}/v1/codex/responses`);
    const messages = [];
    socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.send(JSON.stringify({
      type: "response.create",
      model: "gpt-native",
      input: [{ role: "user", content: "compact" }],
      client_metadata: {
        "x-codex-turn-metadata": JSON.stringify({ request_kind: "compaction" }),
      },
    }));
    await httpStartedPromise;
    socket.send(JSON.stringify({ type: "response.cancel" }));
    await vi.waitFor(() => expect(aborted).toBe(true));
    await vi.waitFor(() => expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "response.failed" }),
    ])));
    expect(actions.some(({ action }) => action === "failure")).toBe(false);
    const closed = new Promise((resolve) => socket.once("close", resolve));
    socket.close(1000, "done");
    await closed;
  });

  it("relays text frames, compression, handshake metadata, ping/pong, and rebuilt credentials", async () => {
    const upstreamHttp = http.createServer();
    const upstreamWss = new WebSocketServer({ server: upstreamHttp, perMessageDeflate: true });
    upstreamWss.on("headers", (headers) => {
      headers.push("x-models-etag: upstream-models-v2");
      headers.push("x-reasoning-included: true");
      headers.push("set-cookie: do-not-relay=1");
    });
    const upstreamPort = await listen(upstreamHttp);

    let capturedHeaders;
    let capturedFrame;
    let upstreamPong;
    upstreamWss.on("connection", (socket, request) => {
      capturedHeaders = request.headers;
      socket.on("message", (data) => {
        capturedFrame = data.toString();
        socket.send(data.toString());
        socket.ping("health");
      });
      upstreamPong = new Promise((resolve) => socket.once("pong", resolve));
    });

    let leaseCounter = 0;
    const actions = [];
    const fakeFetch = async (url, options) => {
      const action = new URL(url).pathname.split("/").pop();
      const payload = JSON.parse(options.body);
      actions.push({ action, payload });
      if (action === "acquire") {
        leaseCounter += 1;
        return Response.json({
          leaseId: `lease-${leaseCounter}`,
          connectionId: "account-1",
          upstreamHeaders: {
            authorization: "Bearer upstream-token",
            "chatgpt-account-id": "upstream-account",
            "session-id": payload.requestHeaders["session-id"],
            "x-codex-future": payload.requestHeaders["x-codex-future"],
          },
          proxy: { enabled: false, url: "", strict: false },
        });
      }
      if (action === "validate-model") return Response.json({ valid: true });
      return Response.json({ success: true });
    };

    const gatewayHttp = http.createServer((_request, response) => response.end("ok"));
    attachCodexNativeGateway(gatewayHttp, {
      secret: "process-secret",
      fetch: fakeFetch,
      upstreamUrl: `ws://127.0.0.1:${upstreamPort}`,
    });
    const gatewayPort = await listen(gatewayHttp);

    const frame = JSON.stringify({
      type: "response.create",
      model: "gpt-native",
      input: [],
      generate: false,
      previous_response_id: "resp-1",
      future_field: { untouched: true },
    });
    let upgradeHeaders;
    let clientSocket;
    const responseFrame = await new Promise((resolve, reject) => {
      clientSocket = new WebSocket(`ws://127.0.0.1:${gatewayPort}/v1/codex/responses`, {
        headers: {
          authorization: "Bearer client-api-key",
          "session-id": "session-1",
          "x-codex-future": "v2",
        },
        perMessageDeflate: true,
      });
      clientSocket.on("upgrade", (response) => { upgradeHeaders = response.headers; });
      clientSocket.on("open", () => clientSocket.send(frame));
      clientSocket.on("message", (data) => {
        resolve({ value: data.toString(), extensions: clientSocket.extensions });
      });
      clientSocket.on("error", reject);
    });

    await upstreamPong;
    const clientClosed = new Promise((resolve) => clientSocket.once("close", resolve));
    clientSocket.close(1000, "test complete");
    await clientClosed;
    expect(responseFrame.value).toBe(frame);
    expect(responseFrame.extensions).toContain("permessage-deflate");
    expect(capturedFrame).toBe(frame);
    expect(capturedHeaders.authorization).toBe("Bearer upstream-token");
    expect(capturedHeaders.authorization).not.toContain("client-api-key");
    expect(capturedHeaders["chatgpt-account-id"]).toBe("upstream-account");
    expect(capturedHeaders["session-id"]).toBe("session-1");
    expect(capturedHeaders["x-codex-future"]).toBe("v2");
    expect(upgradeHeaders["x-models-etag"]).toBe("upstream-models-v2");
    expect(upgradeHeaders["x-reasoning-included"]).toBe("true");
    expect(upgradeHeaders["set-cookie"]).toBeUndefined();
    expect(actions.some(({ action }) => action === "validate-model")).toBe(true);
  });

  it("switches to a model-compatible metadata cohort before sending the first frame", async () => {
    const upstreamHttp = http.createServer();
    const upstreamWss = new WebSocketServer({ server: upstreamHttp });
    const upstreamPort = await listen(upstreamHttp);
    const upstreamConnections = [];
    upstreamWss.on("connection", (socket, request) => {
      const record = { authorization: request.headers.authorization, frames: [] };
      upstreamConnections.push(record);
      socket.on("message", (data) => {
        record.frames.push(data.toString());
        socket.send(data.toString());
      });
    });

    const actions = [];
    const fakeFetch = async (url, options) => {
      const action = new URL(url).pathname.split("/").pop();
      const payload = JSON.parse(options.body);
      actions.push({ action, payload });
      if (action === "acquire") {
        const compatible = payload.model === "gpt-cohort";
        return Response.json({
          leaseId: compatible ? "lease-compatible" : "lease-handshake",
          connectionId: compatible ? "account-compatible" : "account-handshake",
          upstreamHeaders: {
            authorization: `Bearer ${compatible ? "compatible" : "handshake"}`,
          },
          proxy: { enabled: false },
        });
      }
      if (action === "validate-model" && payload.leaseId === "lease-handshake") {
        return Response.json({ valid: false }, { status: 409 });
      }
      return Response.json({ success: true, valid: true });
    };

    const gatewayHttp = http.createServer();
    attachCodexNativeGateway(gatewayHttp, {
      secret: "secret",
      fetch: fakeFetch,
      upstreamUrl: `ws://127.0.0.1:${upstreamPort}`,
    });
    const port = await listen(gatewayHttp);
    const frame = JSON.stringify({
      type: "response.create",
      model: "gpt-cohort",
      input: [],
    });

    const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/codex/responses`);
    const echoed = await new Promise((resolve, reject) => {
      socket.on("open", () => socket.send(frame));
      socket.on("message", (data) => resolve(data.toString()));
      socket.on("error", reject);
    });
    const closed = new Promise((resolve) => socket.once("close", resolve));
    socket.close(1000, "done");
    await closed;

    expect(echoed).toBe(frame);
    expect(actions.filter(({ action }) => action === "acquire")).toHaveLength(2);
    expect(actions.find(({ action, payload }) =>
      action === "acquire" && payload.model === "gpt-cohort"
    )).toBeTruthy();
    expect(upstreamConnections.find(({ authorization }) =>
      authorization === "Bearer handshake"
    )?.frames).toEqual([]);
    expect(upstreamConnections.find(({ authorization }) =>
      authorization === "Bearer compatible"
    )?.frames).toEqual([frame]);
  });

  it("rejects binary client frames with the Codex-compatible unsupported-data close code", async () => {
    const upstreamHttp = http.createServer();
    const upstreamWss = new WebSocketServer({ server: upstreamHttp });
    const upstreamPort = await listen(upstreamHttp);
    upstreamWss.on("connection", () => {});

    const gatewayHttp = http.createServer();
    attachCodexNativeGateway(gatewayHttp, {
      secret: "secret",
      upstreamUrl: `ws://127.0.0.1:${upstreamPort}`,
      fetch: async (url) => {
        const action = new URL(url).pathname.split("/").pop();
        if (action === "acquire") {
          return Response.json({
            leaseId: "lease-binary",
            connectionId: "account-1",
            upstreamHeaders: {},
            proxy: { enabled: false },
          });
        }
        return Response.json({ success: true });
      },
    });
    const port = await listen(gatewayHttp);

    const close = await new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/codex/responses`);
      socket.on("open", () => socket.send(Buffer.from([1, 2, 3])));
      socket.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
      socket.on("error", reject);
    });
    expect(close.code).toBe(1003);
    expect(close.reason).toContain("Binary");
  });

  it("claims only the native responses path and recognizes semantic output", () => {
    expect(isNativeUpgrade({ url: "/v1/codex/responses?transport=v2" })).toBe(true);
    expect(isNativeUpgrade({ url: "/_next/webpack-hmr" })).toBe(false);
    expect(semanticEvent({ type: "response.function_call_arguments.delta" })).toBe(true);
    expect(semanticEvent({ type: "response.created" })).toBe(false);
    expect(safeHandshakeHeaders({
      "x-codex-turn-state": "turn",
      "x-models-etag": "etag",
      "set-cookie": "secret",
      authorization: "secret",
    })).toEqual({
      "x-codex-turn-state": "turn",
      "x-models-etag": "etag",
    });
  });
});
