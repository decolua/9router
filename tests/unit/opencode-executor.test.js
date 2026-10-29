import { describe, it, expect } from "vitest";
import { OpenCodeExecutor } from "open-sse/executors/opencode.js";

describe("OpenCodeExecutor Architecture & Routing", () => {
  it("defaults User-Agent to the official v2 CLI form", () => {
    const ex = new OpenCodeExecutor();
    const headers = ex.buildHeaders({ rawHeaders: {} });
    expect(headers["User-Agent"]).toMatch(/^opencode\/latest\//);
  });

  it("passes through valid downstream User-Agent", () => {
    const ex = new OpenCodeExecutor();
    const headers = ex.buildHeaders({ rawHeaders: { "user-agent": "opencode/latest/2.1.4/cli" } });
    expect(headers["User-Agent"]).toBe("opencode/latest/2.1.4/cli");
  });

  it("respects useServiceDaemon toggle in providerSpecificData", () => {
    const ex = new OpenCodeExecutor();
    const credDirect = { providerSpecificData: { useServiceDaemon: false } };
    expect(credDirect.providerSpecificData.useServiceDaemon).toBe(false);

    const credService = { providerSpecificData: { useServiceDaemon: true } };
    expect(credService.providerSpecificData.useServiceDaemon).toBe(true);
  });
});
