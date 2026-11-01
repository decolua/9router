import { describe, it, expect, beforeEach } from "vitest";

import { handleComboChat, resetComboRotation } from "../../open-sse/services/combo.js";

const log = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };
const models = ["p/a", "p/b", "p/c"];

function response(ok) {
  const json = ok
    ? { choices: [{ message: { role: "assistant", content: "ok" } }] }
    : { error: { message: "down" } };
  const make = () => ({ ok, status: ok ? 200 : 500, headers: new Headers({ "content-type": "application/json" }), clone: make, json: async () => json });
  return make();
}

async function first(sessionId, failing = new Set(), sessionSticky = true) {
  const tried = [];
  await handleComboChat({
    body: { messages: [{ role: "user", content: "hi" }] },
    models,
    handleSingleModel: async (_b, m) => { tried.push(m); return response(!failing.has(m)); },
    log,
    comboName: "rr",
    comboStrategy: "round-robin",
    sessionId,
    sessionSticky,
  });
  return tried;
}

describe("sticky round-robin combo", () => {
  beforeEach(() => resetComboRotation());

  it("rotates new sessions and keeps each session on its model", async () => {
    expect((await first("s1"))[0]).toBe("p/a");
    expect((await first("s2"))[0]).toBe("p/b");
    expect((await first("s1"))[0]).toBe("p/a");
    expect((await first("s2"))[0]).toBe("p/b");
    expect((await first("s3"))[0]).toBe("p/c");
  });

  it("re-pins a session after its model fails", async () => {
    await first("s1");
    expect(await first("s1", new Set(["p/a"]))).toEqual(["p/a", "p/b"]);
    expect((await first("s1"))[0]).not.toBe("p/a");
  });

  it("rotates per request without a session id or when disabled", async () => {
    expect((await first(null))[0]).toBe("p/a");
    expect((await first(null))[0]).toBe("p/b");
    expect((await first("s9", new Set(), false))[0]).toBe("p/c");
    expect((await first("s9", new Set(), false))[0]).toBe("p/a");
  });
});
