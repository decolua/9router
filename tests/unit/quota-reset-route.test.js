import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import http from "node:http";

let stored = {};
const connections = [{ id: "c1", provider: "claude", name: "me@x.com" }];

vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ ...stored }),
  updateSettings: async (patch) => { stored = { ...stored, ...patch }; return { ...stored }; },
  getProviderConnections: async () => connections,
}));

const { GET, PUT, POST } = await import("@/app/api/settings/quota-reset-notify/route.js");
const settingsRoute = await import("@/app/api/settings/route.js");

const json = (body, method = "PUT") =>
  new Request("http://localhost/api/settings/quota-reset-notify", { method, body: JSON.stringify(body) });

let received = [];
const server = http.createServer((req, res) => {
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => { received.push({ url: req.url, body: JSON.parse(data) }); res.statusCode = 202; res.end("{}"); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const hookUrl = `http://127.0.0.1:${server.address().port}/hooks/notify/SECRETTOKEN`;
afterAll(() => new Promise((r) => server.close(r)));

beforeEach(() => { stored = {}; received = []; });

describe("quota-reset-notify route", () => {
  it("saves a config and never returns the webhook url or bot token", async () => {
    const res = await PUT(json({
      enabled: false,
      targets: [
        { id: "g1", name: "Bot", type: "generic", url: hookUrl },
        { id: "t1", name: "TG", type: "telegram", botToken: "123456:ABCdef_ghijklmnop", chatId: "-100" },
      ],
    }));
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("SECRETTOKEN");
    expect(text).not.toContain("ABCdef");
    expect(text).toContain("127.0.0.1");
    expect(stored.quotaResetNotify.targets[0].url).toBe(hookUrl);   // stored in full…
    const read = JSON.stringify(await (await GET()).json());
    expect(read).not.toContain("SECRETTOKEN");                       // …but never read back
  });

  it("rejects an invalid target with 400 and stores nothing", async () => {
    const res = await PUT(json({ targets: [{ name: "x", type: "generic", url: "file:///etc/passwd" }] }));
    expect(res.status).toBe(400);
    expect(stored.quotaResetNotify).toBeUndefined();
  });

  it("keeps the stored url when an edit leaves it blank", async () => {
    await PUT(json({ targets: [{ id: "g1", name: "Bot", type: "generic", url: hookUrl }] }));
    await PUT(json({ targets: [{ id: "g1", name: "Renamed", type: "generic", url: "" }] }));
    expect(stored.quotaResetNotify.targets[0]).toMatchObject({ name: "Renamed", url: hookUrl });
  });

  it("the test action really POSTs {title,text,level} to the saved target", async () => {
    await PUT(json({ targets: [{ id: "g1", name: "Bot", type: "generic", url: hookUrl }] }));
    const res = await POST(json({ action: "test", targetId: "g1" }, "POST"));
    expect((await res.json()).sent).toBe(1);
    expect(received).toHaveLength(1);
    expect(received[0].url).toBe("/hooks/notify/SECRETTOKEN");
    expect(Object.keys(received[0].body).sort()).toEqual(["level", "text", "title"]);
    expect(received[0].body.title).toContain("[테스트]");
  });

  it("refuses unknown actions", async () => {
    expect((await POST(json({ action: "nope" }, "POST"))).status).toBe(400);
  });
});

describe("generic /api/settings route", () => {
  it("does not leak quotaResetNotify on GET and ignores it on PATCH", async () => {
    await PUT(json({ targets: [{ id: "g1", name: "Bot", type: "generic", url: hookUrl }] }));
    const got = JSON.stringify(await (await settingsRoute.GET()).json());
    expect(got).not.toContain("SECRETTOKEN");
    expect(got).not.toContain("quotaResetNotify");

    const before = JSON.stringify(stored.quotaResetNotify);
    await settingsRoute.PATCH(new Request("http://localhost/api/settings", {
      method: "PATCH", body: JSON.stringify({ quotaResetNotify: { enabled: true, targets: [] } }),
    }));
    expect(JSON.stringify(stored.quotaResetNotify)).toBe(before);
  });
});
