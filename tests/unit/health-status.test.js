import { describe, expect, it, vi } from "vitest";
import { buildHealthStatus } from "@/lib/services/healthStatusService.js";

describe("buildHealthStatus", () => {
  it("returns healthy overall status when all active connections have no errors or rate limits", async () => {
    const mockConnections = [
      { id: "c1", provider: "groq", isActive: true, testStatus: "active", rateLimitedUntil: null, lastError: null },
      { id: "c2", provider: "cerebras", isActive: true, testStatus: "active", rateLimitedUntil: null, lastError: null },
    ];
    const mockCombos = [
      { id: "cb1", name: "fast", models: ["groq/llama-3", "cerebras/llama-3"] },
    ];

    const result = await buildHealthStatus({
      getConnections: async () => mockConnections,
      getCombos: async () => mockCombos,
      version: "0.5.112",
    });

    expect(result.status).toBe("healthy");
    expect(result.version).toBe("0.5.112");
    expect(typeof result.uptime).toBe("number");
    expect(result.timestamp).toBeTypeOf("string");

    // System metrics
    expect(result.system).toBeDefined();
    expect(typeof result.system.memoryUsagePercent).toBe("number");
    expect(typeof result.system.processMemoryMb).toBe("number");
    expect(typeof result.system.cpuCores).toBe("number");

    // Providers summary
    expect(result.providers.groq).toBeDefined();
    expect(result.providers.groq.status).toBe("healthy");
    expect(result.providers.groq.activeConnections).toBe(1);
    expect(result.providers.groq.rateLimited).toBe(false);

    // Combos summary
    expect(result.combos.fast).toBeDefined();
    expect(result.combos.fast.status).toBe("active");
    expect(result.combos.fast.modelCount).toBe(2);
  });

  it("marks provider and overall status degraded when a connection is rate-limited", async () => {
    const future = Date.now() + 60000;
    const mockConnections = [
      { id: "c1", provider: "groq", isActive: true, testStatus: "active", rateLimitedUntil: future, lastError: "Rate limit reached" },
      { id: "c2", provider: "cerebras", isActive: true, testStatus: "active", rateLimitedUntil: null, lastError: null },
    ];

    const result = await buildHealthStatus({
      getConnections: async () => mockConnections,
      getCombos: async () => [],
      version: "0.5.112",
    });

    expect(result.status).toBe("degraded");
    expect(result.providers.groq.status).toBe("degraded");
    expect(result.providers.groq.rateLimited).toBe(true);
    expect(result.providers.cerebras.status).toBe("healthy");
  });

  it("marks overall status unhealthy when all active connections have errors", async () => {
    const mockConnections = [
      { id: "c1", provider: "groq", isActive: true, testStatus: "error", rateLimitedUntil: null, lastError: "Invalid API key" },
    ];

    const result = await buildHealthStatus({
      getConnections: async () => mockConnections,
      getCombos: async () => [],
      version: "0.5.112",
    });

    expect(result.status).toBe("unhealthy");
    expect(result.providers.groq.status).toBe("unhealthy");
  });
});

describe("GET /api/health/status route", () => {
  it("exports GET and OPTIONS handlers", async () => {
    const route = await import("@/app/api/health/status/route.js");
    expect(typeof route.GET).toBe("function");
    expect(typeof route.OPTIONS).toBe("function");

    const optRes = await route.OPTIONS();
    expect(optRes.status).toBe(204);
    expect(optRes.headers.get("access-control-allow-origin")).toBe("*");
  });
});
