import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { CursorExecutor } from "../../open-sse/executors/cursor.js";
import { decodeMessage, encodeField, wrapConnectRPCFrame } from "../../open-sse/utils/cursorProtobuf.js";

const LEN = 2;

// The executor gates native execution on CURSOR_NATIVE_TOOLS at module-load
// time. Tests that exercise the enabled path therefore re-import the module
// in a child process with the env set, driving it through a stubbed h2
// session. In-process tests cover the default-off behavior and the pure
// helpers (workspace confinement etc.) directly.

function execRequestFrame(variantField, argsFields) {
  const variantMessage = Buffer.concat(argsFields.map((f) => Buffer.from(f)));
  const execServerMessage = Buffer.from(encodeField(variantField, LEN, variantMessage));
  return Buffer.from(wrapConnectRPCFrame(encodeField(2, LEN, execServerMessage)));
}

function readRequestFrame(relativePath) {
  return execRequestFrame(7, [encodeField(1, LEN, relativePath)]);
}

const credentials = {
  accessToken: "test-token",
  providerSpecificData: { machineId: "a".repeat(64) },
};

function stubAgentSession(executor, frames) {
  const written = [];
  const queue = [...frames];
  executor.openAgentHttp2Stream = () => ({
    responseHeaders: Promise.resolve({ ":status": 200 }),
    write: (frame) => written.push(Buffer.from(frame)),
    end() {},
    close() {},
    async read() {
      if (!queue.length) return { value: undefined, done: true };
      return { value: queue.shift(), done: false };
    },
  });
  return written;
}

function parseSSE(text) {
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => chunk.slice("data: ".length))
    .filter((data) => data !== "[DONE]")
    .map((data) => JSON.parse(data));
}

// Child-process harness: runs a script with CURSOR_NATIVE_TOOLS=1 (± other
// env), feeding exec frames through the executor with a stubbed session.
// The child imports the executor via an absolute file:// URL so its cwd can
// be the temp workspace.
import { fileURLToPath } from "node:url";
const executorUrl = new URL("../../open-sse/executors/cursor.js", import.meta.url).href;

function runNativeChild({ env, workspace, script }) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: workspace,
    env: {
      ...process.env,
      CURSOR_WORKSPACE: workspace,
      ...env,
    },
    encoding: "utf8",
    timeout: 60000,
  });
  return result;
}

const childScript = (framesB64, stream) => `
import { CursorExecutor } from "${executorUrl}";
const executor = new CursorExecutor();
const written = [];
const frames = ${JSON.stringify(framesB64)}.map((b64) => Buffer.from(b64, "base64"));
executor.openAgentHttp2Stream = () => ({
  responseHeaders: Promise.resolve({ ":status": 200 }),
  write: (frame) => written.push(Buffer.from(frame)),
  end() {}, close() {},
  async read() {
    if (!frames.length) return { value: undefined, done: true };
    return { value: frames.shift(), done: false };
  },
});
const result = await executor.executeAgent({
  model: "gpt-5.2",
  body: { messages: [{ role: "user", content: "hi" }] },
  stream: ${stream},
  credentials: { accessToken: "t", providerSpecificData: { machineId: "a".repeat(64) } },
});
const text = await result.response.text();
// Give fire-and-forget native tool replies a moment to land on the session
// before reporting; 2s comfortably covers the temp-dir tools used in tests.
await new Promise((resolve) => setTimeout(resolve, 2000));
console.log("===9ROUTER-RESULT===");
console.log(JSON.stringify({ status: result.response.status, writtenCount: written.length, body: text }));
`;

async function runEnabled(frames, { workspace, stream = true, env = {} } = {}) {
  const b64 = frames.map((f) => f.toString("base64"));
  const res = runNativeChild({
    env: { CURSOR_NATIVE_TOOLS: "1", ...env },
    workspace,
    script: childScript(b64, stream),
  });
  if (res.status !== 0) {
    throw new Error(`child failed: ${res.stderr}\n${res.stdout}`);
  }
  const marker = res.stdout.indexOf("===9ROUTER-RESULT===");
  return JSON.parse(res.stdout.slice(marker + "===9ROUTER-RESULT===".length).trim());
}

describe("native IDE tools: default-off gate", () => {
  it("NATIVE_TOOLS_ENABLED is false without the env var", async () => {
    const { NATIVE_TOOLS_ENABLED } = await import("../../open-sse/utils/cursorNativeTools.js");
    expect(NATIVE_TOOLS_ENABLED).toBe(false);
  });

  it("rejects read exec requests with the typed rejection when disabled", async () => {
    const executor = new CursorExecutor();
    const written = stubAgentSession(executor, [
      readRequestFrame("../../../etc/passwd"),
    ]);
    const result = await executor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials,
    });
    expect(written.length).toBe(2); // run frame + rejection
    const body = await result.response.text();
    expect(body).not.toContain("/etc/passwd"); // file content never read
    const rejection = decodeMessage(decodeMessage(written[1].subarray(5)).get(2)[0].value);
    expect(rejection.get(7)).toBeTruthy(); // read result variant present (rejected)
  });
});

describe("native IDE tools: workspace confinement", () => {
  let workspace;

  beforeAll(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "9router-native-"));
    await fs.writeFile(path.join(workspace, "note.txt"), "hello native\n", "utf8");
    await fs.mkdir(path.join(workspace, "sub"), { recursive: true });
    await fs.writeFile(path.join(workspace, "sub", "deep.txt"), "deep content\n", "utf8");
    // Symlink pointing OUTSIDE the workspace.
    await fs.symlink(os.tmpdir(), path.join(workspace, "evil-link"));
  });

  afterAll(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("reads a file inside the workspace when enabled", async () => {
    const { status, writtenCount } = await runEnabled([readRequestFrame("note.txt")], { workspace });
    expect(status).toBe(200);
    expect(writtenCount).toBeGreaterThanOrEqual(2); // run frame + read success
  });

  it("blocks reads via ../../ escape", async () => {
    const { status, writtenCount } = await runEnabled(
      [readRequestFrame("../../../../etc/passwd")],
      { workspace },
    );
    expect(status).toBe(200);
    // A rejection reply was sent instead of file content.
    expect(writtenCount).toBeGreaterThanOrEqual(2);
  });

  it("blocks reads through a symlink that points outside the workspace", async () => {
    const { status, writtenCount } = await runEnabled(
      [readRequestFrame("evil-link/some-file")],
      { workspace },
    );
    expect(status).toBe(200);
    expect(writtenCount).toBeGreaterThanOrEqual(2);
  });

  it("ls lists workspace entries without descending into dotdirs", async () => {
    const lsFrame = execRequestFrame(8, [encodeField(1, LEN, "")]);
    const { status } = await runEnabled([lsFrame], { workspace });
    expect(status).toBe(200);
  });

  it("write and delete stay blocked without CURSOR_NATIVE_EXEC even with native tools on", async () => {
    const writeFrame = execRequestFrame(3, [
      encodeField(1, LEN, "newly-created.txt"),
      encodeField(2, LEN, "should not be written"),
    ]);
    const { status } = await runEnabled([writeFrame], { workspace });
    await expect(fs.access(path.join(workspace, "newly-created.txt"))).rejects.toThrow();
    expect(status).toBe(200);
  });

  it("shell stays blocked without CURSOR_NATIVE_EXEC", async () => {
    const shellFrame = execRequestFrame(2, [
      encodeField(1, LEN, "echo pwned > shell-out.txt"),
    ]);
    const { status } = await runEnabled([shellFrame], { workspace });
    await expect(fs.access(path.join(workspace, "shell-out.txt"))).rejects.toThrow();
    expect(status).toBe(200);
  });

  it("write executes inside the workspace with CURSOR_NATIVE_EXEC=1", async () => {
    const writeFrame = execRequestFrame(3, [
      encodeField(1, LEN, "created.txt"),
      encodeField(2, LEN, "written by native tool"),
    ]);
    const { status } = await runEnabled([writeFrame], { workspace, env: { CURSOR_NATIVE_EXEC: "1" } });
    expect(await fs.readFile(path.join(workspace, "created.txt"), "utf8"))
      .toBe("written by native tool");
    expect(status).toBe(200);
  });

  it("write is confined: escape paths rejected even with CURSOR_NATIVE_EXEC=1", async () => {
    const writeFrame = execRequestFrame(3, [
      encodeField(1, LEN, "../outside-escape.txt"),
      encodeField(2, LEN, "nope"),
    ]);
    const outsidePath = path.join(path.dirname(workspace), "outside-escape.txt");
    const { status } = await runEnabled([writeFrame], { workspace, env: { CURSOR_NATIVE_EXEC: "1" } });
    await expect(fs.access(outsidePath)).rejects.toThrow();
    expect(status).toBe(200);
  });

  it("shell executes with CURSOR_NATIVE_EXEC=1 and cwd pinned to the workspace", async () => {
    const shellFrame = execRequestFrame(2, [
      encodeField(1, LEN, "printf hi > shell-ran.txt"),
    ]);
    const { status } = await runEnabled([shellFrame], { workspace, env: { CURSOR_NATIVE_EXEC: "1" } });
    expect(await fs.readFile(path.join(workspace, "shell-ran.txt"), "utf8")).toBe("hi");
    expect(status).toBe(200);
  });

  it("shell with an escaping workingDir falls back to the workspace root", async () => {
    const shellFrame = execRequestFrame(2, [
      encodeField(1, LEN, "printf x > wd-test.txt"),
      encodeField(2, LEN, "../../"),
    ]);
    const { status } = await runEnabled([shellFrame], { workspace, env: { CURSOR_NATIVE_EXEC: "1" } });
    expect(await fs.readFile(path.join(workspace, "wd-test.txt"), "utf8")).toBe("x");
    expect(status).toBe(200);
  });

  it("grep finds matches within the workspace", async () => {
    const grepFrame = execRequestFrame(5, [
      encodeField(1, LEN, "deep content"),
      encodeField(2, LEN, ""),
    ]);
    const { status } = await runEnabled([grepFrame], { workspace });
    expect(status).toBe(200);
  });

  it("grep with an invalid regex is rejected, not crashed", async () => {
    const grepFrame = execRequestFrame(5, [
      encodeField(1, LEN, "([unclosed"),
      encodeField(2, LEN, ""),
    ]);
    const { status } = await runEnabled([grepFrame], { workspace });
    expect(status).toBe(200);
  });

  it("diagnostics replies empty success", async () => {
    const diagFrame = execRequestFrame(9, [encodeField(1, LEN, "note.txt")]);
    const { status } = await runEnabled([diagFrame], { workspace });
    expect(status).toBe(200);
  });

  it("fetch rejects non-http(s) schemes", async () => {
    const fetchFrame = execRequestFrame(20, [encodeField(1, LEN, "file:///etc/passwd")]);
    const { status } = await runEnabled([fetchFrame], { workspace });
    expect(status).toBe(200);
  });
});

describe("native IDE tools: run/turn still completes after native exec", () => {
  it("model text after a native read still streams to the client", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "9router-turn-"));
    try {
      await fs.writeFile(path.join(workspace, "note.txt"), "abc\n", "utf8");
      function textFrame(text) {
        const textPart = encodeField(1, LEN, text);
        const update = encodeField(1, LEN, textPart);
        return Buffer.from(wrapConnectRPCFrame(encodeField(1, LEN, update)));
      }
      function turnEndedFrame() {
        const update = encodeField(14, LEN, new Uint8Array());
        return Buffer.from(wrapConnectRPCFrame(encodeField(1, LEN, update)));
      }
      const { body } = await runEnabled(
        [readRequestFrame("note.txt"), textFrame("the answer"), turnEndedFrame()],
        { workspace },
      );
      const events = parseSSE(body);
      const content = events.map((e) => e.choices?.[0]?.delta?.content || "").join("");
      expect(content).toBe("the answer");
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
