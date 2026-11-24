import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearConsoleLogs: vi.fn(),
  getConsoleLogSnapshot: vi.fn(),
  initConsoleLogCapture: vi.fn(),
}));

vi.mock("@/lib/consoleLogBuffer", () => mocks);

import { GET } from "@/app/api/translator/console-logs/route.js";

describe("console log REST snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConsoleLogSnapshot.mockReturnValue({
      logs: ["line"],
      revision: 7,
    });
  });

  it("returns an ETag with the current snapshot", async () => {
    const response = await GET(new Request("http://localhost/api/translator/console-logs"));

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('W/"console-7"');
    expect(await response.json()).toEqual({ success: true, logs: ["line"] });
  });

  it("returns 304 when snapshot revision is unchanged", async () => {
    const response = await GET(new Request("http://localhost/api/translator/console-logs", {
      headers: { "If-None-Match": 'W/"console-7"' },
    }));

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });
});
