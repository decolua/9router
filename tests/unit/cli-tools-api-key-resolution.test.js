import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseTOML } from "confbox";
import { writePrivateFile } from "../../src/app/api/cli-tools/privateSettingsFile.js";
import { resolveCliApiKey } from "../../src/app/api/cli-tools/resolveApiKey.js";

const loaders = import.meta.glob("../../src/app/api/cli-tools/*-settings/route.js");
let home;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "cli-panel-key-"));
  vi.stubEnv("DATA_DIR", path.join(home, "data"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
  for (const env of ["HOME", "USERPROFILE", "APPDATA", "XDG_CONFIG_HOME"]) vi.stubEnv(env, home);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(home, { recursive: true, force: true });
});

it.each(["crush", "codewhale", "forge", "smelt", "copilot", "opencode", "pi", "omp", "deepseek-tui", "grok-build"])(
  "%s: explicit key, same-endpoint reuse, unchanged file after refused switch, explicit replacement", async tool => {
    const { POST, GET } = await loaders[`../../src/app/api/cli-tools/${tool}-settings/route.js`]();
    const apply = (baseUrl, apiKey) => POST({ json: async () => ({ baseUrl, apiKey, model: "fixture", models: ["fixture"] }) });
    const original = "https://one.invalid/v1", other = "https://two.invalid/v1";
    expect((await apply(original, "")).status).toBe(400);
    const initial = await apply(original, "fixture-first-key");
    expect(initial.status).toBe(200);
    const file = (await initial.json()).configPath;
    expect(file.startsWith(home + path.sep)).toBe(true);
    expect((await apply(original, "")).status).toBe(200);
    const before = await fs.readFile(file, "utf8");
    expect(before).toContain("fixture-first-key");
    expect((await apply(other, "")).status).toBe(400);
    expect(await fs.readFile(file, "utf8")).toBe(before);
    expect((await apply(other, "fixture-second-key")).status).toBe(200);
    const after = await fs.readFile(file, "utf8");
    expect(after).toContain("fixture-second-key");
    expect(after).not.toContain("fixture-first-key");
    expect(await (await GET()).text()).not.toContain("fixture-second-key");
  }
);

it("rejects a masked selection rather than silently substituting the stored key", () => {
  expect(() => resolveCliApiKey("abc…xyz", "a", "a", "fixture")).toThrow();
  expect(resolveCliApiKey("sk_9router", "a", "a", "fixture")).toBe("fixture");
});

it.each(["claude", "codex"])("%s binds saved credentials to the endpoint and keeps them out of panel status", async tool => {
  const { POST, GET, DELETE } = await loaders[`../../src/app/api/cli-tools/${tool}-settings/route.js`]();
  const claude = tool === "claude";
  const file = path.join(home, claude ? ".claude/settings.json" : ".codex/config.toml");
  const sidecar = path.join(home, claude ? ".claude.json" : ".codex/auth.json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  const independent = JSON.stringify({ other: "independent-account" });
  await fs.writeFile(sidecar, independent);
  const apply = (url, key) => POST({ json: async () => claude
    ? { env: { ANTHROPIC_BASE_URL: url, ANTHROPIC_AUTH_TOKEN: key, ANTHROPIC_DEFAULT_SONNET_MODEL: "fixture" } }
    : { baseUrl: url, apiKey: key, model: "fixture" } });
  const a = "https://one.invalid/v1", b = "https://two.invalid/v1";
  expect((await apply(a, "")).status).toBe(400);
  expect((await apply(a, "first-test-token")).status).toBe(200);
  expect((await apply(a, "")).status).toBe(200);
  const before = await fs.readFile(file, "utf8");
  const sideBefore = await fs.readFile(sidecar, "utf8");
  expect(before).toContain("first-test-token");
  const status = await (await GET()).json();
  expect(JSON.stringify(status)).toContain("fixture");
  expect(JSON.stringify(status)).not.toContain("first-test-token");
  expect((await apply(b, "")).status).toBe(400);
  expect(await fs.readFile(file, "utf8")).toBe(before);
  expect(await fs.readFile(sidecar, "utf8")).toBe(sideBefore);
  expect((await apply(b, "second-test-token")).status).toBe(200);
  const after = await fs.readFile(file, "utf8");
  expect(after).toContain("second-test-token");
  expect(after).not.toContain("first-test-token");
  expect((await DELETE()).status).toBe(200);
  expect(JSON.parse(await fs.readFile(sidecar, "utf8"))).toEqual(JSON.parse(independent));
});

it.each(["cline", "kilo"])("%s checks the endpoint before changing either config file", async tool => {
  const { POST } = await loaders[`../../src/app/api/cli-tools/${tool}-settings/route.js`]();
  const apply = (baseUrl, apiKey, model) => POST({ json: async () => ({ baseUrl, apiKey, model }) });
  const cline = tool === "cline";
  const files = (cline ? [".cline/data/globalState.json", ".cline/data/secrets.json"] :
    [".local/share/kilo/auth.json", ".config/Code/User/settings.json"]).map(rel => path.join(home, rel));
  for (const file of files) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ unrelated: "keep" }));
  }
  const snapshot = () => Promise.all(files.map(f => fs.readFile(f, "utf8")));
  const a = "https://a.invalid/v1", b = "https://b.invalid/v1";
  expect((await apply(a, "first-credential", "m1")).status).toBe(200);
  expect((await apply(a, "", "m2")).status).toBe(200);
  const before = await snapshot();
  expect(before.join(" ")).toContain("first-credential");
  expect((await apply(b, "", "m3")).status).toBe(400);
  expect(await snapshot()).toEqual(before);
  expect((await apply(b, "replacement-credential", "m3")).status).toBe(200);
  const after = await snapshot();
  expect(after.join(" ")).toContain("replacement-credential");
  expect(after.join(" ")).not.toContain("first-credential");
  expect(after.every(raw => JSON.parse(raw).unrelated === "keep")).toBe(true);
});

const firstUrl = "https://first.invalid/v1", nextUrl = "https://next.invalid/v1";
const request = (baseUrl, apiKey, models, activeModel) => ({ json: async () => ({ baseUrl, apiKey, models, activeModel }) });
const read = file => fs.readFile(file, "utf8");
const mode = async file => (await fs.stat(file)).mode & 0o777;
async function fixture(relative, content) {
  const file = path.join(home, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, { mode: 0o644 });
  return file;
}

const linkedSettings = [
  ["droid", ".factory/settings.json", "{}"],
  ["jcode", "jcode/provider-9router.env", "# managed by dotfiles\n"],
];

it.each(linkedSettings)("%s updates the dotfile target and preserves its relative symlink", async (tool, relative, content) => {
  const { POST } = await loaders[`../../src/app/api/cli-tools/${tool}-settings/route.js`]();
  const link = path.join(home, relative);
  const target = await fixture("dotfiles/" + path.basename(link), content);
  const to = path.relative(path.dirname(link), target);
  await fs.mkdir(path.dirname(link), { recursive: true });
  await fs.symlink(to, link);

  expect((await POST(request(firstUrl, "fixture-key", ["alpha"]))).status).toBe(200);
  expect(await fs.readlink(link)).toBe(to);
  expect(await read(target)).toContain("fixture-key");
  expect(await mode(target)).toBe(0o600);
});

it.each(linkedSettings)("%s refuses a broken settings symlink before writing any settings", async (tool, relative) => {
  const { POST } = await loaders[`../../src/app/api/cli-tools/${tool}-settings/route.js`]();
  const link = path.join(home, relative);
  const target = path.join(home, "missing-target");
  await fs.mkdir(path.dirname(link), { recursive: true });
  await fs.symlink(target, link);

  await expect(writePrivateFile(link, "fixture")).rejects.toThrow(/broken settings symlink/i);
  expect((await POST(request(firstUrl, "fixture-key", ["alpha"]))).status).toBe(500);
  expect(await fs.readlink(link)).toBe(target);
  await expect(fs.lstat(target)).rejects.toMatchObject({ code: "ENOENT" });
  if (tool === "jcode") await expect(fs.lstat(path.join(home, ".jcode/config.toml"))).rejects.toMatchObject({ code: "ENOENT" });
});

it.each([[61, 200], [59, 409]])("Jcode lock aged %i seconds returns %i", async (age, status) => {
  const { POST } = await loaders["../../src/app/api/cli-tools/jcode-settings/route.js"]();
  const config = path.join(home, ".jcode/config.toml");
  const lock = config + ".9router-lock";
  await fs.mkdir(lock, { recursive: true });
  const timestamp = new Date(Date.now() - age * 1000);
  await fs.utimes(lock, timestamp, timestamp);

  expect((await POST(request(firstUrl, "fixture-key", ["alpha"]))).status).toBe(status);
  if (status === 200) {
    expect(parseTOML(await read(config)).providers["9router"].default_model).toBe("alpha");
    await expect(fs.lstat(lock)).rejects.toMatchObject({ code: "ENOENT" });
  } else {
    expect((await fs.lstat(lock)).isDirectory()).toBe(true);
    await expect(fs.lstat(config)).rejects.toMatchObject({ code: "ENOENT" });
  }
});

it("Droid keeps keys with their models across reorder, and never borrows another entry's key", async () => {
  const { GET, POST, DELETE } = await loaders["../../src/app/api/cli-tools/droid-settings/route.js"]();
  const other = { id: "custom:9Router-personal", index: 42, model: "new", baseUrl: firstUrl, apiKey: "user-key" };
  const file = await fixture(".factory/settings.json", JSON.stringify({ theme: "dark", customModels: [
    other, { id: "custom:9Router-0", model: "alpha", apiKey: "alpha-key", baseUrl: firstUrl, maxOutputTokens: 73 },
    { id: "custom:9Router-1", model: "beta", apiKey: "beta-key", baseUrl: firstUrl, extra: "keep" },
  ] }));
  const apply = (url, key, models) => POST(request(url, key, models, "beta"));
  expect((await apply(firstUrl, "  ", ["alpha", "beta"])).status).toBe(200);
  const before = await read(file);
  expect(JSON.parse(before)).toMatchObject({ theme: "dark", customModels: [
    { model: "beta", apiKey: "beta-key", extra: "keep" },
    { model: "alpha", apiKey: "alpha-key", maxOutputTokens: 73 }, other,
  ] });
  expect(await mode(file)).toBe(0o600);
  const status = await (await GET()).text();
  expect(status).toContain("beta");
  expect(status).not.toMatch(/alpha-key|beta-key|user-key/);
  for (const [url, models] of [[firstUrl, ["alpha", "new"]], [nextUrl, ["beta"]]]) {
    expect((await apply(url, "", models)).status).toBe(400);
    expect(await read(file)).toBe(before);
  }
  const switched = await apply(nextUrl, "replacement-key", ["beta"]);
  expect(switched.status).toBe(200);
  expect(await switched.text()).not.toContain("replacement-key");
  expect(JSON.parse(await read(file)).customModels).toEqual([
    expect.objectContaining({ model: "beta", baseUrl: nextUrl, apiKey: "replacement-key" }), other,
  ]);
  expect((await DELETE()).status).toBe(200);
  expect(JSON.parse(await read(file))).toEqual({ theme: "dark", customModels: [other] });
});

it("Jcode keeps provider fields and unrelated environment lines across apply and reset", async () => {
  const { GET, POST, DELETE } = await loaders["../../src/app/api/cli-tools/jcode-settings/route.js"]();
  const file = await fixture(".jcode/config.toml", 'theme = "dark"\n[providers.mine]\napi_key = "personal-key"\n[providers.9router]\nextra = "keep"\n');
  const otherEnv = "# keep\r\nexport OTHER='x=y # data'\r\n";
  const env = await fixture("jcode/provider-9router.env", otherEnv + 'JCODE_9ROUTER_API_KEY="orphan-key"\r\n');
  const snapshot = () => Promise.all([read(file), read(env)]);
  const apply = (url, key, model) => POST(request(url, key, [model]));
  expect((await apply(firstUrl, "", "alpha")).status).toBe(400);
  expect((await apply(firstUrl, "first-key", "alpha")).status).toBe(200);
  expect((await apply(firstUrl, "", "beta")).status).toBe(200);
  const before = await snapshot();
  expect(before[1]).toContain(otherEnv);
  expect(before[1]).toContain('"first-key"');
  expect(await Promise.all([mode(file), mode(env)])).toEqual([0o600, 0o600]);
  const status = await (await GET()).text();
  expect(status).toContain("beta");
  expect(status).not.toMatch(/personal-key|first-key/);
  expect((await apply(nextUrl, "", "gamma")).status).toBe(400);
  expect(await snapshot()).toEqual(before);
  const switched = await apply(nextUrl, "next-key", "gamma");
  expect(switched.status).toBe(200);
  expect(await switched.text()).not.toContain("next-key");
  expect(parseTOML(await read(file))).toMatchObject({ theme: "dark", providers: {
    mine: { api_key: "personal-key" }, "9router": { extra: "keep", base_url: nextUrl, default_model: "gamma" },
  } });
  expect(await read(env)).toBe(otherEnv + 'JCODE_9ROUTER_API_KEY="next-key"\r\n');
  expect((await DELETE()).status).toBe(200);
  expect(parseTOML(await read(file))).toEqual({ theme: "dark", providers: { mine: { api_key: "personal-key" } } });
  expect(await read(env)).toBe(otherEnv);
});

it.each([
  ["droid", ".factory/settings.json", '{"apiKey":"secret-fixture",'],
  ["droid", ".factory/settings.json", '{"customModels":{}}'],
  ["jcode", ".jcode/config.toml", '[providers.9router\napi_key = "secret-fixture"'],
  ["jcode", "jcode/provider-9router.env", 'OTHER="unterminated-secret-fixture'],
])("%s refuses to overwrite malformed %s on apply or reset", async (tool, relative, broken) => {
  const { POST, DELETE } = await loaders[`../../src/app/api/cli-tools/${tool}-settings/route.js`]();
  const files = [];
  if (tool === "jcode") {
    files.push(await fixture(".jcode/config.toml", '[providers.9router]\nextra = "keep"'));
    files.push(await fixture("jcode/provider-9router.env", "OTHER=keep"));
  }
  const damaged = await fixture(relative, broken);
  if (!files.includes(damaged)) files.push(damaged);
  const contents = await Promise.all(files.map(read));
  const logs = [vi.spyOn(console, "error"), vi.spyOn(console, "log")];
  for (const mutate of [() => POST(request(nextUrl, "test-key", ["model"])), DELETE]) {
    const res = await mutate();
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/secret-fixture|test-key/);
    expect(await Promise.all(files.map(read))).toEqual(contents);
  }
  for (const log of logs) expect(log.mock.calls.flat().map(String).join(" ")).not.toMatch(/secret-fixture|test-key/);
});

it("Jcode revokes old key before publishing a changed endpoint, even if the final write fails", async () => {
  const { POST } = await loaders["../../src/app/api/cli-tools/jcode-settings/route.js"]();
  expect((await POST(request(firstUrl, "first-key", ["alpha"]))).status).toBe(200);
  const env = path.join(home, "jcode/provider-9router.env");
  const config = path.join(home, ".jcode/config.toml");
  const rename = fs.rename.bind(fs);
  vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
    if (to === config) expect(await read(env)).not.toContain("first-key");
    if (to === env && (await read(from)).includes("next-key")) throw new Error("write failed");
    return rename(from, to);
  });
  expect((await POST(request(nextUrl, "next-key", ["beta"]))).status).toBe(500);
  expect(parseTOML(await read(config)).providers["9router"].base_url).toBe(nextUrl);
  expect(await read(env)).not.toContain("first-key");
});

it("Droid refuses to carry custom headers to another endpoint even with an explicit key", async () => {
  const { POST } = await loaders["../../src/app/api/cli-tools/droid-settings/route.js"]();
  const raw = JSON.stringify({ customModels: [{ id: "custom:9Router-0", model: "model",
    baseUrl: firstUrl, apiKey: "one-key", extraHeaders: { Authorization: "Bearer separate-key" } }] });
  const file = await fixture(".factory/settings.json", raw);
  expect((await POST(request(nextUrl, "new-key", ["model"]))).status).toBe(400);
  expect(await read(file)).toBe(raw);
});

it("Jcode never borrows an unreferenced env key or moves inline credentials to another endpoint", async () => {
  const { POST } = await loaders["../../src/app/api/cli-tools/jcode-settings/route.js"]();
  const raw = `[providers.9router]\nbase_url = "${firstUrl}"\napi_key_env = "OTHER"\nenv_file = "other.env"\napi_key = "inline-key"\n`;
  const file = await fixture(".jcode/config.toml", raw);
  const env = await fixture("jcode/provider-9router.env", "JCODE_9ROUTER_API_KEY=unrelated-key");
  expect((await POST(request(firstUrl, "", ["m"]))).status).toBe(400);
  expect((await POST(request(nextUrl, "new-key", ["m"]))).status).toBe(400);
  expect(await read(file)).toBe(raw);
  expect(await read(env)).toBe("JCODE_9ROUTER_API_KEY=unrelated-key");
});
