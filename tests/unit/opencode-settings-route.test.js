import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fsPromises from "fs/promises";

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

vi.mock("fs/promises", () => ({
  default: {
    access: vi.fn(),
    readFile: vi.fn(),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
  },
  access: vi.fn(),
  readFile: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("child_process", () => ({
  exec: vi.fn((command, options, callback) => {
    callback?.(null, "/usr/bin/opencode\n", "");
  }),
}));

let GET;

describe("GET /api/cli-tools/opencode-settings", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../src/app/api/cli-tools/opencode-settings/route.js");
    GET = mod.GET;
  });

  it("returns installed response instead of 500 when config file is malformed JSON", async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue("{\n  \"provider\": {\n    bad: true,\n  }\n}");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.installed).toBe(true);
    expect(response.body.config).toBeNull();
  });
});
