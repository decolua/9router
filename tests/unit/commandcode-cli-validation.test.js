import { EventEmitter } from "events";
import os from "os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const spawnMock = vi.fn();
const originalFetch = global.fetch;

vi.mock("child_process", () => ({ spawn: spawnMock }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init = {}) => new Response(JSON.stringify(body), {
      status: init.status || 200,
      headers: init.headers,
    }),
  },
}));
vi.mock("@/models", () => ({ getProviderNodeById: vi.fn() }));
vi.mock("@/shared/constants/providers", () => ({
  AI_PROVIDERS: { "commandcode-cli": { noAuth: true } },
  isOpenAICompatibleProvider: vi.fn(() => false),
  isAnthropicCompatibleProvider: vi.fn(() => false),
  isCustomEmbeddingProvider: vi.fn(() => false),
}));
vi.mock("@/shared/constants/config", () => ({ PROVIDER_ENDPOINTS: {} }));
vi.mock("@/lib/providerNormalization", () => ({ normalizeProviderId: (provider) => provider }));

const { POST } = await import("../../src/app/api/providers/validate/route.js");

function mockRequest(body) {
  return { json: () => Promise.resolve(body) };
}

function mockChildProcess({ stdout = "pong", stderr = "", code = 0, error = null } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();

  queueMicrotask(() => {
    if (error) {
      child.emit("error", error);
      return;
    }
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.emit("close", code);
  });

  return child;
}

describe("commandcode-cli provider validation", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("validates via local cmd and does not call the Command Code Provider API", async () => {
    spawnMock.mockImplementation(() => mockChildProcess({ stdout: "pong", code: 0 }));

    const response = await POST(mockRequest({ provider: "commandcode-cli" }));
    const json = await response.json();

    expect(json).toEqual({ valid: true, error: null });
    expect(spawnMock).toHaveBeenCalledWith("cmd", [
      "--model", "xiaomi/mimo-v2.5-pro",
      "-p", "Say pong only",
      "--skip-onboarding",
      "--trust",
      "--max-turns", "1",
    ], expect.objectContaining({ shell: false, windowsHide: true, cwd: os.tmpdir() }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("surfaces missing CLI as a validation failure", async () => {
    const enoent = new Error("spawn cmd ENOENT");
    enoent.code = "ENOENT";
    spawnMock.mockImplementation(() => mockChildProcess({ error: enoent }));

    const response = await POST(mockRequest({ provider: "commandcode-cli" }));
    const json = await response.json();

    expect(json.valid).toBe(false);
    expect(json.error).toBe("Command Code CLI not found. Install with: npm i -g command-code");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("surfaces missing CLI auth as a validation failure", async () => {
    spawnMock.mockImplementation(() => mockChildProcess({ stderr: "please run cmd login", code: 1 }));

    const response = await POST(mockRequest({ provider: "commandcode-cli" }));
    const json = await response.json();

    expect(json.valid).toBe(false);
    expect(json.error).toBe("Command Code CLI is not authenticated. Run: cmd login");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
