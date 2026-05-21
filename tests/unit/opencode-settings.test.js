import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const fs = {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  };

  return {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
    })),
    fs,
    os: {
      homedir: vi.fn(() => "/mock/home"),
      platform: vi.fn(() => "linux"),
    },
  };
});

vi.mock("next/server", () => ({
  NextResponse: {
    json: mocks.json,
  },
}));

vi.mock("fs/promises", () => ({
  ...mocks.fs,
  default: mocks.fs,
}));

vi.mock("os", () => ({
  ...mocks.os,
  default: mocks.os,
}));

const { POST } = await import("../../src/app/api/cli-tools/opencode-settings/route.js");

function makeRequest(body) {
  return {
    json: async () => body,
  };
}

describe("POST /api/cli-tools/opencode-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves an existing apiKey when no apiKey is provided", async () => {
    mocks.fs.readFile.mockResolvedValueOnce(
      JSON.stringify({
        provider: {
          "9router": {
            npm: "@ai-sdk/openai-compatible",
            options: {
              baseURL: "http://old.example/v1",
              apiKey: "sk-existing",
            },
            models: {
              alpha: { name: "alpha", modalities: { input: ["text"], output: ["text"] } },
            },
          },
        },
      })
    );

    const response = await POST(
      makeRequest({
        baseUrl: "http://localhost:3000",
        models: ["beta"],
      })
    );

    expect(response.body.success).toBe(true);
    expect(mocks.fs.writeFile).toHaveBeenCalledTimes(1);

    const [, written] = mocks.fs.writeFile.mock.calls[0];
    const config = JSON.parse(written);

    expect(config.provider["9router"].options.baseURL).toBe("http://localhost:3000/v1");
    expect(config.provider["9router"].options.apiKey).toBe("sk-existing");
    expect(config.provider["9router"].models.alpha).toBeDefined();
    expect(config.provider["9router"].models.beta).toBeDefined();
  });

  it("keeps the provided apiKey when one is supplied", async () => {
    mocks.fs.readFile.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

    const response = await POST(
      makeRequest({
        baseUrl: "http://localhost:3000",
        apiKey: "sk-provided",
        models: ["beta"],
      })
    );

    expect(response.body.success).toBe(true);
    const [, written] = mocks.fs.writeFile.mock.calls[0];
    const config = JSON.parse(written);

    expect(config.provider["9router"].options.apiKey).toBe("sk-provided");
  });
});
