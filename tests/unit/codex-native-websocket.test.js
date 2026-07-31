import http from "node:http";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";

const require = createRequire(import.meta.url);
const {
  attachCodexNativeGateway,
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
