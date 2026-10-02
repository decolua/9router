import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { once } from "node:events";
import { gzipSync } from "node:zlib";
import { createBridge, prepareHistory } from "../../public/9router-codex.mjs";
import { sealCompactionSummary } from "../../src/lib/chatgpt/compact.js";

const key = "router-key";
const compact = () => ({ id: "cmp_router", type: "compaction", encrypted_content: sealCompactionSummary("MARKER; orchard.js; tests passed.", key) });
const nativeCompact = { id: "cmp_native", type: "compaction", encrypted_content: "native-opaque" };
const tools = [
  { id: "fc_router", type: "function_call", call_id: "call_stable", name: "read_file", namespace: "functions", arguments: '{"path":"orchard.js"}' },
  { type: "function_call_output", call_id: "call_stable", output: "file contents" },
  { id: "msg_router", type: "message", role: "assistant", content: [{ type: "output_text", text: "Tests passed." }] },
];

describe("portable Codex history", () => {
  it("drops unresolvable reasoning IDs but preserves text, tool identity, namespaces and outputs", async () => {
    const body = { model: "gpt-6-sol", input: [{ type: "reasoning", id: "rs_router", summary: [{ type: "summary_text", text: "thinking" }] }, ...tools] };
    const original = structuredClone(body);
    const result = await prepareHistory(body, { external: false, apiKey: key });
    expect(result.input).toEqual(tools.map(({ id: _id, ...item }) => item));
    expect(body).toEqual(original);
  });
  it("preserves native encrypted reasoning and compaction on native routes", async () => {
    const body = { input: [{ type: "reasoning", id: "rs_native", encrypted_content: "native-encrypted", summary: [] }, nativeCompact] };
    expect(await prepareHistory(body, { external: false, apiKey: key })).toBe(body);
  });
  it("does not send native encrypted reasoning to an external provider", async () => {
    const body = { input: [{ type: "reasoning", id: "rs_native", encrypted_content: "native-secret", summary: [] }, ...tools] };
    const result = await prepareHistory(body, { external: true, apiKey: key });
    expect(JSON.stringify(result)).not.toContain("native-secret");
    expect(result.input[0].call_id).toBe("call_stable");
  });
  it("preserves public reasoning needed for router tool continuity", async () => {
    const item = { type: "reasoning", id: "rs_router", summary: [{ type: "summary_text", text: "Need to read orchard.js" }] };
    const result = await prepareHistory({ input: [item, ...tools] }, { external: true, apiKey: key });
    expect(result.input[0]).toEqual({ type: "reasoning", summary: item.summary });
    expect(result.input[1].call_id).toBe("call_stable");
  });
  it("decrypts the server's actual v1 compaction format locally when switching to GPT", async () => {
    const item = compact();
    const result = await prepareHistory({ input: [item] }, { external: false, apiKey: key });
    expect(result.input[0]).toMatchObject({ type: "message", role: "assistant", content: [{ type: "output_text", text: expect.stringContaining("MARKER; orchard.js; tests passed.") }] });
    expect(JSON.stringify(result)).not.toContain(item.encrypted_content);
  });
  it.each(["wrong-key", "tampered"])("fails without discarding history on %s router state", async mode => {
    const body = { input: [compact()] };
    if (mode === "tampered") body.input[0].encrypted_content += "!";
    const original = structuredClone(body);
    await expect(prepareHistory(body, { external: false, apiKey: mode === "wrong-key" ? "wrong" : key })).rejects.toThrow("saved history has not been changed");
    expect(body).toEqual(original);
  });
  it("keeps router compaction unchanged on the router route", async () => {
    const body = { input: [compact()] };
    expect(await prepareHistory(body, { external: true, apiKey: key })).toBe(body);
  });
  it("exports native compaction before switching without changing saved items", async () => {
    const exportNativeSummary = vi.fn(async () => "MARKER and task facts");
    const body = { input: [nativeCompact, ...tools] };
    const result = await prepareHistory(body, { external: true, apiKey: key, exportNativeSummary });
    expect(exportNativeSummary).toHaveBeenCalledWith(nativeCompact);
    expect(result.input[0].content[0].text).toContain("MARKER and task facts");
    expect(body.input[0]).toBe(nativeCompact);
  });
  it.each(["", null, "x".repeat(256 * 1024 + 1)])("rejects missing or oversized exported summaries", async text => {
    await expect(prepareHistory({ input: [nativeCompact] }, { external: true, exportNativeSummary: async () => text })).rejects.toThrow("complete portable summary");
  });
  it("leaves string input unchanged", async () => {
    const body = { input: "hello" };
    expect(await prepareHistory(body, { external: true })).toBe(body);
  });
});

describe("history transfer on actual bridge sockets", () => {
  const servers = [];
  afterEach(async () => Promise.all(servers.splice(0).map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }))));
  async function listen(server) { servers.push(server); server.listen(0, "127.0.0.1"); await once(server, "listening"); return `http://127.0.0.1:${server.address().port}`; }
  async function setup({ incomplete = false, stall = false } = {}) {
    const calls = []; let aborted;
    const closed = new Promise(resolve => { aborted = resolve; });
    const target = await listen(http.createServer(async (request, response) => {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      calls.at(-1).body = JSON.parse(Buffer.concat(chunks));
      if (calls.at(-1).url.startsWith("https://chatgpt.com")) {
        response.on("close", aborted);
        response.writeHead(200, { "content-type": "text/event-stream" });
        if (stall) { response.write(": waiting\n\n"); return; }
        const item = { type: "message", role: "assistant", content: [{ type: "output_text", text: "NATIVE_MARKER; orchard.js; tests passed" }] };
        response.end(`data: ${JSON.stringify({ type: "response.output_item.done", item })}\n\ndata: ${JSON.stringify({ type: incomplete ? "response.incomplete" : "response.completed", response: { status: incomplete ? "incomplete" : "completed", output: [] } })}\n\n`);
      } else response.end('{"ok":true}');
    }));
    const bridge = createBridge({ token: "token", routerUrl: "https://router.test/api/chatgpt/v1", apiKey: key, nativeDefault: "gpt-6-sol" }, {
      getManifest: async () => ({ version: 1, models: [{ id: "coding", slug: "9router/coding", contextWindow: 100000 }] }),
      requestUpstream: (url, init, callback) => { calls.push({ url: url.href, headers: init.headers }); return http.request(target, init, callback); },
    });
    return { url: `${await listen(bridge)}/token/v1/responses`, calls, closed };
  }
  const headers = { authorization: "Bearer native-token", "chatgpt-account-id": "native-account", "content-type": "application/json", "content-encoding": "gzip" };
  const request = (url, input, extra = {}) => fetch(url, { method: "POST", headers, body: gzipSync(JSON.stringify({ model: "9router/coding", input })), ...extra });
  it("exports once per account, keeps credentials separate and forwards an uncompressed portable history", async () => {
    const { url, calls } = await setup();
    expect((await request(url, [nativeCompact, ...tools])).status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(calls[0].headers.authorization).toBe("Bearer native-token");
    expect(calls[0].body.input[0]).toEqual(nativeCompact);
    expect(calls[1].headers.authorization).toBe("Bearer router-key");
    expect(calls[1].headers["chatgpt-account-id"]).toBeUndefined();
    expect(calls[1].headers["content-encoding"]).toBeUndefined();
    expect(calls[1].body.input[0].content[0].text).toContain("NATIVE_MARKER");
    expect(JSON.stringify(calls[1])).not.toMatch(/native-opaque|native-token|native-account/);
    await request(url, [nativeCompact]);
    expect(calls).toHaveLength(3);
    await request(url, [nativeCompact], { headers: { ...headers, "chatgpt-account-id": "another-account" } });
    expect(calls).toHaveLength(5);
  });
  it("never sends incomplete exported context to the router", async () => {
    const { url, calls } = await setup({ incomplete: true });
    const response = await request(url, [nativeCompact]);
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("saved history has not been changed");
    expect(calls).toHaveLength(1);
  });
  it("cancels the native export when the client disconnects", async () => {
    const { url, calls, closed } = await setup({ stall: true });
    const controller = new AbortController();
    const response = request(url, [nativeCompact], { signal: controller.signal }).catch(error => error);
    while (!calls[0]?.body) await new Promise(resolve => setTimeout(resolve, 5));
    controller.abort(); await response; await closed;
    expect(calls).toHaveLength(1);
  });
  it("rewrites compressed router compaction before forwarding to native OpenAI", async () => {
    const { url, calls } = await setup();
    const r = await fetch(url, { method: "POST", headers, body: gzipSync(JSON.stringify({ model: "gpt-6-sol", input: [compact(), ...tools] })) });
    expect(r.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].headers["content-encoding"]).toBeUndefined();
    expect(calls[0].body.input[0].content[0].text).toContain("MARKER");
    expect(calls[0].body.input[1].call_id).toBe("call_stable");
  });
});
