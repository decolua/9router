import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const base = "../../cli/src/cli/";
const input = require(base + "utils/input");
const clipboard = require(base + "utils/clipboard");
const oldKey = "sk-test-old-credential";
const newKey = "sk-test-new-credential";
const key = { id: "two", name: "Second", keyVersion: 4, key: oldKey };
let dir, api, output, confirm, copy, selectMenu;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-cli-rotate-"));
  vi.stubEnv("DATA_DIR", dir);
  fs.writeFileSync(path.join(dir, "machine-id"), "fixture");
  for (const mod of ["api/client", "utils/endpoint", "menus/apiKeys"]) {
    delete require.cache[require.resolve(base + mod)];
  }
  api = require(base + "api/client");
  output = vi.spyOn(console, "log").mockImplementation(() => {});
  selectMenu = vi.spyOn(input, "selectMenu").mockResolvedValue(0);
  vi.spyOn(input, "select").mockResolvedValue(1);
  confirm = vi.spyOn(input, "confirm").mockResolvedValue(true);
  vi.spyOn(input, "pause").mockResolvedValue();
  copy = vi.spyOn(clipboard, "copyToClipboard").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

function respond(statusCode, body) {
  let sent = "";
  const request = vi.spyOn(http, "request").mockImplementation((options, callback) => {
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.write = chunk => { sent += chunk; };
    req.end = () => {
      const res = Object.assign(new EventEmitter(), { statusCode });
      callback(res);
      res.emit("data", typeof body === "string" ? body : JSON.stringify(body));
      res.emit("end");
    };
    return req;
  });
  return { request, body: () => JSON.parse(sent) };
}

it.each([
  [200, { id: "two", key: newKey, keyVersion: 5 }],
  [409, { error: "Key version changed" }],
  [404, "<html>Not Found</html>"],
])("client sends the selected version and preserves HTTP %i", async (status, body) => {
  const wire = respond(status, body);
  const result = await api.rotateApiKey("id/2", 4);
  expect(wire.request.mock.calls[0][0]).toMatchObject({ method: "POST", path: "/api/keys/id%2F2/rotate" });
  expect(wire.body()).toEqual({ keyVersion: 4 });
  expect(result).toMatchObject({ success: status === 200, statusCode: status });
  if (status === 200) expect(result.data).toEqual(body);
  else expect(result.data).toBeUndefined();
});

function openMenu(status, body) {
  vi.spyOn(api, "getTunnelStatus").mockResolvedValue({ success: false });
  const keys = [ { id: "one", name: "First", keyVersion: 1 }, key ];
  const list = vi.spyOn(api, "getApiKeys")
    .mockResolvedValueOnce({ success: true, data: { keys } })
    .mockResolvedValue({ success: true, data: { keys: [{ ...key, name: "Refreshed", key: newKey, keyVersion: 5 }] } });
  selectMenu.mockImplementationOnce(async (_title, items) => items.findIndex(i => i.label === "Rotate Key (by number)"));
  const wire = respond(status, body);
  return { done: require(base + "menus/apiKeys").showApiKeysMenu(20128), list, wire };
}

it.each([true, false])("delivers the new key once; clipboard consent: %s", async wantsCopy => {
  confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(wantsCopy);
  const { done, wire } = openMenu(200, { id: key.id, key: newKey, keyVersion: 5 });
  await done;
  expect(input.select.mock.calls[0][1]).toEqual(["First", "Second"]);
  expect(confirm.mock.calls[0][0]).toMatch(/Second.*old key will stop working immediately/i);
  expect(wire.request.mock.calls[0][0].path).toBe("/api/keys/two/rotate");
  expect(wire.body()).toEqual({ keyVersion: 4 });
  const printed = output.mock.calls.flat().join("\n");
  expect(printed.split(newKey)).toHaveLength(2);
  expect(printed).not.toContain(oldKey);
  expect(confirm.mock.calls[1][0]).toMatch(/clipboard/i);
  if (wantsCopy) expect(copy).toHaveBeenCalledWith(newKey);
  else expect(copy).not.toHaveBeenCalled();
});

it.each([
  [409, { error: "Key version changed", key: newKey }, /changed elsewhere/i],
  [404, "<html>Not Found</html>", /does not support key rotation/i],
  [405, "", /does not support key rotation/i],
  [404, { error: "Key not found" }, /Key not found/],
  [503, { error: "Rotation requires native SQLite" }, /Rotation requires native SQLite/],
])("menu handles %i without revealing a key", async (status, body, message) => {
  const { done, list, wire } = openMenu(status, body);
  await done;
  expect(wire.request).toHaveBeenCalledTimes(1);
  expect(list).toHaveBeenCalledTimes(2);
  const labels = selectMenu.mock.calls[1][1].map(i => i.label).join("\n");
  expect(labels).toContain("Refreshed");
  const printed = output.mock.calls.flat().join("\n");
  expect(printed).toMatch(message);
  expect(printed + labels).not.toContain(oldKey);
  expect(printed + labels).not.toContain(newKey);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(copy).not.toHaveBeenCalled();
});

it("cancels before sending a rotation request", async () => {
  confirm.mockResolvedValueOnce(false);
  const { done, wire } = openMenu(200, {});
  await done;
  expect(wire.request).not.toHaveBeenCalled();
  expect(output).not.toHaveBeenCalled();
  expect(copy).not.toHaveBeenCalled();
});
