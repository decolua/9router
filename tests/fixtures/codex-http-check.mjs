// Run against codex-http-server.cjs; never point this at a real deployment.
import assert from "node:assert/strict";
const base = `http://127.0.0.1:${process.env.FIXTURE_PORT || "20139"}`;
async function image(model, prompt = "fixture", options = {}) {
  return fetch(`${base}/v1/images/generations${options.binary ? "?response_format=binary" : ""}`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.key || "fixture-key"}`, ...(options.stream ? { Accept: "text/event-stream" } : {}) },
    body: JSON.stringify({ model, prompt }),
  });
}
let response = await image("cx/gpt-5.5-image", "fixture", { key: "wrong" });
assert.equal(response.status, 401);
console.log(`invalid API key: HTTP ${response.status}`);
response = await image("cx/gpt-5.5-image", "fixture", { binary: true });
assert.equal(response.status, 200);
const bytes = Buffer.from(await response.arrayBuffer());
assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
console.log(`configured legacy image alias: HTTP ${response.status}, ${bytes.length} PNG bytes`);
response = await image("cx/gpt-5.4-image");
assert.equal(response.status, 404);
console.log(`unavailable unmapped model: HTTP ${response.status}`);
const { connections } = await (await fetch(`${base}/api/providers`)).json();
assert.equal(connections[0].testStatus, "active");
assert.equal(connections[0].lastModelError.model, "gpt-5.4-image");
console.log(`connection remains ${connections[0].testStatus}; warning scoped to ${connections[0].lastModelError.model}`);
response = await image("cx/gpt-5.6-luna-image");
assert.equal(response.status, 200);
assert.ok((await response.json()).data[0].b64_json);
console.log(`same account, other model: HTTP ${response.status}`);
response = await image("cx/gpt-5.6-luna-image", "fixture-stream-error");
assert.equal(response.status, 400);
assert.match(await response.text(), /requires a newer version of Codex/);
console.log(`embedded client-version failure, JSON: HTTP ${response.status}`);
response = await image("cx/gpt-5.6-luna-image", "fixture-stream-error", { stream: true });
const stream = await response.text();
assert.equal(response.status, 200);
assert.match(stream, /event: error/);
assert.match(stream, /"status":400/);
assert.doesNotMatch(stream, /event: done/);
console.log(`embedded client-version failure, SSE: HTTP ${response.status}, error status 400, no done event`);
console.log("HTTP fixture checks passed");
