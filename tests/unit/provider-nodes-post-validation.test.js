/**
 * POST /api/provider-nodes — validation contract (DF-9ROUTER-37)
 *
 * Drives the REAL route module with a web `Request` and asserts the two-field
 * contract the README documents:
 *
 *   `type`    = the NODE KIND   (openai-compatible | anthropic-compatible | custom-embedding)
 *   `apiType` = the PROTOCOL    (chat | responses)
 *
 * Claim (a) — the rejection message must NAME the allowed set. At the revision
 * this was filed the route answered only "Invalid OpenAI compatible API type",
 * which asks about the api type without ever saying which values are legal and
 * so cannot lead a caller to the fix. That is the defect these tests pin.
 *
 * Claim (b) — an omitted `apiType` must never be turned into a stored node, and
 * no reachable path may invent a `prefix`/`apiType` the caller did not send.
 * The no-store half is ALREADY-FIXED at HEAD (route.js:49); the tests below keep
 * it as an explicit regression pin alongside the message half that is not.
 *
 * Claim (c) — `prefix` stays REQUIRED with the existing "Prefix is required"
 * text (route.js:41-42), likewise pinned.
 *
 * Persistence is mocked so the assertions can observe EXACTLY what the route
 * tried to store — and prove that nothing is stored on the rejected paths.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// The route imports { createProviderNode, getProviderNodes } from "@/models".
// Nothing else in the module graph touches persistence, so mocking this one
// module keeps the test off the DB adapter chain entirely.
const createProviderNode = vi.fn(async (data) => ({ ...data }));
const getProviderNodes = vi.fn(async () => []);

vi.mock("@/models", () => ({
  createProviderNode: (...args) => createProviderNode(...args),
  getProviderNodes: (...args) => getProviderNodes(...args),
}));

const { POST } = await import("@/app/api/provider-nodes/route.js");

function post(body) {
  return POST(
    new Request("http://localhost:20128/api/provider-nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

/** Arguments the route handed to the mocked persistence layer, flattened. */
function storedNode() {
  expect(createProviderNode).toHaveBeenCalledTimes(1);
  return createProviderNode.mock.calls[0][0];
}

/**
 * Every value bound to a `prefix` key anywhere in a response body. A stored-node
 * payload invented from the `type` string shows up here as a caller-unsent
 * value; an error message that merely mentions the word does not.
 */
function prefixValues(value, found = []) {
  if (Array.isArray(value)) {
    value.forEach((v) => prefixValues(v, found));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "prefix") found.push(v);
      prefixValues(v, found);
    }
  }
  return found;
}

beforeEach(() => {
  createProviderNode.mockClear();
  getProviderNodes.mockClear();
});

describe("POST /api/provider-nodes — apiType / type contract", () => {
  it("rejects an unsupported apiType and names the allowed set", async () => {
    const res = await post({
      name: "dogfood-lmstudio",
      prefix: "dlm",
      apiType: "openai", // the node KIND passed where the PROTOCOL belongs
      baseUrl: "http://localhost:1234/v1",
      type: "openai-compatible",
    });

    expect(res.status).toBe(400);
    const json = await res.json();

    // The message must name both legal protocol values so a caller can fix it.
    expect(json.error).toContain("chat");
    expect(json.error).toContain("responses");
    // …and must distinguish `apiType` (protocol) from `type` (node kind).
    expect(json.error).toContain("apiType");
    expect(json.error).toContain("type");

    // A rejected request must not reach persistence at all.
    expect(createProviderNode).not.toHaveBeenCalled();
    expect(json).not.toHaveProperty("node");
  });

  it("does not store a node when apiType is omitted (already-fixed pin)", async () => {
    const res = await post({
      name: "dogfood-lmstudio",
      prefix: "dlm",
      baseUrl: "http://localhost:1234/v1",
      type: "openai-compatible",
      // apiType intentionally absent — the row's repro inventing a node
    });

    expect(res.status).toBe(400);
    const json = await res.json();

    // No node was persisted, and the response carries no stored-node payload
    // with a `prefix` the caller did not send (the placeholder that used to be
    // derived from the word "openai-compatible").
    expect(createProviderNode).not.toHaveBeenCalled();
    expect(json).not.toHaveProperty("node");
    expect(prefixValues(json)).toEqual([]);
  });

  it("names the allowed set when apiType is omitted too", async () => {
    const res = await post({
      name: "dogfood-lmstudio",
      prefix: "dlm",
      baseUrl: "http://localhost:1234/v1",
      type: "openai-compatible",
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("chat");
    expect(json.error).toContain("responses");
    expect(json.error).toContain("apiType");
  });

  it("keeps prefix required with the existing message (already-fixed pin)", async () => {
    const res = await post({
      name: "dogfood-lmstudio",
      prefix: "   ",
      apiType: "chat",
      baseUrl: "http://localhost:1234/v1",
      type: "openai-compatible",
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Prefix is required");
    expect(createProviderNode).not.toHaveBeenCalled();
  });

  it("stores the caller's own prefix and apiType on the happy path", async () => {
    const res = await post({
      name: "dogfood-lmstudio",
      prefix: "dlm",
      apiType: "chat",
      baseUrl: "http://localhost:1234/v1",
      type: "openai-compatible",
    });

    expect(res.status).toBe(201);
    const json = await res.json();

    expect(json.node.prefix).toBe("dlm");
    expect(json.node.apiType).toBe("chat");
    // The placeholder that used to be invented must never appear.
    expect(json.node.prefix).not.toBe("compatible");
    expect(json.node.apiType).not.toBe("openai");

    // The persisted shape agrees with the response.
    const stored = storedNode();
    expect(stored.prefix).toBe("dlm");
    expect(stored.apiType).toBe("chat");
    expect(stored.type).toBe("openai-compatible");
    expect(stored.id).toMatch(/^openai-compatible-chat-/);
  });

  it("rejects an unknown type with its own message", async () => {
    const res = await post({
      name: "dogfood-lmstudio",
      prefix: "dlm",
      apiType: "chat",
      baseUrl: "http://localhost:1234/v1",
      type: "not-a-real-kind",
    });

    expect(res.status).toBe(400);
    expect(createProviderNode).not.toHaveBeenCalled();
  });
});
