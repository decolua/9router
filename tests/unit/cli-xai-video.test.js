/**
 * Tests for the `9router xai video` CLI command (cli/src/cli/commands/xaiVideo.js)
 *
 * Uses a real local HTTP server standing in for the 9router gateway + video CDN.
 * No real credentials or upstream calls.
 *
 * Covers:
 *  - arg parsing (defaults, flags, unknown flag rejection)
 *  - full happy path: create → poll (pending → done) → MP4 download → atomic rename
 *  - x-connection-id pinning from the create response header
 *  - failed job → non-zero exit, no output file, no stray .part
 *  - poll timeout → non-zero exit
 *  - download failure cleans up the .part file
 *  - no Authorization/token material in output
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { run, parseArgs, downloadToFile, sanitizeText, imageInputToUrl } = require("../../cli/src/cli/commands/xaiVideo.js");

const MP4_BYTES = Buffer.from("FAKE-MP4-DATA-0123456789");

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

const closeServer = (server) => new Promise((r) => server.close(r));

let tmpDir;
let server;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xai-video-test-"));
});

afterEach(async () => {
  if (server) {
    await closeServer(server);
    server = null;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("parseArgs", () => {
  it("applies defaults", () => {
    const opts = parseArgs(["--prompt", "hi"]);
    expect(opts.prompt).toBe("hi");
    expect(opts.model).toBe("xai/grok-imagine-video");
    expect(opts.output).toBe("video.mp4");
    expect(opts.port).toBe(20128);
  });

  it("parses all documented flags", () => {
    const opts = parseArgs([
      "--prompt", "p", "--output", "o.mp4", "--model", "m",
      "--duration", "10", "--aspect-ratio", "16:9", "--resolution", "720p",
      "--image", "https://x/img.png", "--timeout", "30", "--port", "1234", "--api-key", "k",
    ]);
    expect(opts).toMatchObject({
      prompt: "p", output: "o.mp4", model: "m", duration: 10,
      aspectRatio: "16:9", resolution: "720p", image: "https://x/img.png",
      timeoutSec: 30, port: 1234, apiKey: "k",
    });
  });

  it("rejects unknown flags", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(/Unknown option/);
  });
});

describe("imageInputToUrl", () => {
  it("passes URLs and data URLs through", () => {
    expect(imageInputToUrl("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(imageInputToUrl("data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA");
  });

  it("converts a local file to a base64 data URL", () => {
    const p = path.join(tmpDir, "in.png");
    fs.writeFileSync(p, Buffer.from([1, 2, 3]));
    expect(imageInputToUrl(p)).toBe(`data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}`);
  });
});

describe("sanitizeText", () => {
  it("redacts bearer tokens from error output", () => {
    expect(sanitizeText("boom Bearer abcdefghijklmnop!")).toBe("boom Bearer [redacted]!");
  });
});

describe("run (against a mock gateway)", () => {
  it("creates, polls to done, downloads the MP4, and exits 0", async () => {
    let pollCount = 0;
    const seen = { createAuth: null, pollConnectionIds: [] };

    ({ server } = await startServer((req, res) => {
      if (req.method === "POST" && req.url === "/v1/videos/generations") {
        seen.createAuth = req.headers.authorization || null;
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          seen.createBody = JSON.parse(body);
          res.writeHead(200, { "Content-Type": "application/json", "x-9router-connection-id": "conn-42" });
          res.end(JSON.stringify({ request_id: "job-1" }));
        });
        return;
      }
      if (req.method === "GET" && req.url === "/v1/videos/job-1") {
        seen.pollConnectionIds.push(req.headers["x-connection-id"] || null);
        pollCount++;
        const port = server.address().port;
        const payload = pollCount < 3
          ? { status: "pending", progress: pollCount * 30 }
          : { status: "done", video: { url: `http://127.0.0.1:${port}/files/out.mp4`, duration: 8 } };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
        return;
      }
      if (req.method === "GET" && req.url === "/files/out.mp4") {
        res.writeHead(200, { "Content-Type": "video/mp4" });
        res.end(MP4_BYTES);
        return;
      }
      res.writeHead(404).end();
    }));

    const output = path.join(tmpDir, "result.mp4");
    const logs = [];
    vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a) => logs.push(a.join(" ")));

    const code = await run([
      "--prompt", "a neon city",
      "--output", output,
      "--port", String(server.address().port),
      "--api-key", "local-key-secret",
      "--timeout", "10",
      "--poll-interval-ms", "20",
    ]);

    expect(code).toBe(0);
    expect(fs.readFileSync(output)).toEqual(MP4_BYTES);
    expect(fs.existsSync(`${output}.part`)).toBe(false);

    // Model prefix forwarded as-is to the gateway (gateway strips it)
    expect(seen.createBody.model).toBe("xai/grok-imagine-video");
    expect(seen.createBody.prompt).toBe("a neon city");
    // Polls pinned to the connection that created the job
    expect(seen.pollConnectionIds.every((id) => id === "conn-42")).toBe(true);
    // No token material in user-facing output
    expect(logs.join("\n")).not.toContain("local-key-secret");
    expect(logs.join("\n")).not.toContain("Authorization");
  });

  it("exits non-zero when the job fails, without leaving files", async () => {
    ({ server } = await startServer((req, res) => {
      if (req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ request_id: "job-f" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "failed", error: { code: "invalid_argument", message: "bad prompt" } }));
    }));

    const output = path.join(tmpDir, "nope.mp4");
    const errors = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation((...a) => errors.push(a.join(" ")));

    const code = await run([
      "--prompt", "x", "--output", output,
      "--port", String(server.address().port),
      "--timeout", "10", "--poll-interval-ms", "10",
    ]);

    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("bad prompt");
    expect(fs.existsSync(output)).toBe(false);
    expect(fs.existsSync(`${output}.part`)).toBe(false);
  });

  it("exits non-zero when polling exceeds the timeout", async () => {
    ({ server } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(req.method === "POST" ? JSON.stringify({ request_id: "job-slow" }) : JSON.stringify({ status: "pending", progress: 1 }));
    }));

    vi.spyOn(console, "log").mockImplementation(() => {});
    const errors = [];
    vi.spyOn(console, "error").mockImplementation((...a) => errors.push(a.join(" ")));

    const code = await run([
      "--prompt", "x", "--output", path.join(tmpDir, "slow.mp4"),
      "--port", String(server.address().port),
      "--timeout", "1", "--poll-interval-ms", "50",
    ]);

    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/Timed out/i);
  }, 15000);

  it("reports a helpful error when no xAI account is connected", async () => {
    ({ server } = await startServer((req, res) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "No credentials for provider: xai", type: "invalid_request_error" } }));
    }));

    vi.spyOn(console, "log").mockImplementation(() => {});
    const errors = [];
    vi.spyOn(console, "error").mockImplementation((...a) => errors.push(a.join(" ")));

    const code = await run([
      "--prompt", "x", "--output", path.join(tmpDir, "n.mp4"),
      "--port", String(server.address().port),
    ]);

    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("No credentials");
    expect(errors.join("\n")).toContain("Connect an xAI account");
  });
});

describe("downloadToFile", () => {
  it("downloads via .part and renames atomically", async () => {
    ({ server } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "video/mp4" });
      res.end(MP4_BYTES);
    }));

    const out = path.join(tmpDir, "dl.mp4");
    await downloadToFile(`http://127.0.0.1:${server.address().port}/f.mp4`, out);
    expect(fs.readFileSync(out)).toEqual(MP4_BYTES);
    expect(fs.existsSync(`${out}.part`)).toBe(false);
  });

  it("follows redirects", async () => {
    ({ server } = await startServer((req, res) => {
      if (req.url === "/start") {
        res.writeHead(302, { Location: `/final` });
        res.end();
        return;
      }
      res.writeHead(200);
      res.end(MP4_BYTES);
    }));

    const out = path.join(tmpDir, "redir.mp4");
    await downloadToFile(`http://127.0.0.1:${server.address().port}/start`, out);
    expect(fs.readFileSync(out)).toEqual(MP4_BYTES);
  });

  it("removes the .part file when the download fails", async () => {
    ({ server } = await startServer((req, res) => {
      res.writeHead(500);
      res.end("nope");
    }));

    const out = path.join(tmpDir, "fail.mp4");
    await expect(downloadToFile(`http://127.0.0.1:${server.address().port}/f.mp4`, out)).rejects.toThrow(/HTTP 500/);
    expect(fs.existsSync(out)).toBe(false);
    expect(fs.existsSync(`${out}.part`)).toBe(false);
  });
});
