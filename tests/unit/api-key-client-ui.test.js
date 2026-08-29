import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const tablePath = path.join(
  root,
  "src/app/(dashboard)/dashboard/usage/components/ApiKeyClientsTable.js",
);
const statePath = path.join(
  root,
  "src/app/(dashboard)/dashboard/usage/components/apiKeyClientState.js",
);

const client = { apiKeyId: "key-id", seenRequests: 7 };
const summary = { apiKeyId: "key-id", activeClients: 1, distinctClients: 1 };

describe("API key client activity UI", () => {
  it("uses admitted requests, generic sources, accessible scrolling, and visible token detail", () => {
    const source = fs.readFileSync(tablePath, "utf8");

    expect(source).toContain("client.seenRequests");
    expect(source).not.toContain("client.requests)");
    expect(source).toContain('"cloudflare-worker": "Edge worker"');
    expect(source).not.toContain("Short Tunnel");
    expect(source).toContain('role="region"');
    expect(source).toContain("tabIndex={0}");
    expect(source).toContain('aria-label="API key client activity table"');
    expect(source).toContain("Input {fmt(client.promptTokens)}");
    expect(source).toContain("Output {fmt(client.completionTokens)}");
    expect(source).toContain("Reasoning {fmt(client.reasoningTokens)}");
    expect(source).toContain("Newest 2,000 clients shown");
  });

  it("clears old-period rows and restores them only as an explicit stale snapshot", async () => {
    expect(fs.existsSync(statePath)).toBe(true);
    if (!fs.existsSync(statePath)) return;
    const { createClientActivityState, reduceClientActivity } = await import(statePath);

    let state = createClientActivityState();
    state = reduceClientActivity(state, { type: "start", period: "24h" });
    state = reduceClientActivity(state, {
      type: "success",
      period: "24h",
      data: { clients: [client], summaries: [summary], truncated: false },
    });
    state = reduceClientActivity(state, { type: "start", period: "7d" });

    expect(state.loading).toBe(true);
    expect(state.clients).toEqual([]);

    state = reduceClientActivity(state, { type: "failure", period: "7d" });
    expect(state.clients).toEqual([client]);
    expect(state.requestedPeriod).toBe("7d");
    expect(state.snapshotPeriod).toBe("24h");
    expect(state.stale).toBe(true);
    expect(state.error).toBeTruthy();
  });

  it("contains distinct loading, error, stale-snapshot, and valid-empty states", () => {
    const source = fs.readFileSync(tablePath, "utf8");

    expect(source).toContain("Loading client activity");
    expect(source).toContain("Could not load client activity");
    expect(source).toContain("Showing last successful snapshot");
    expect(source).toContain("No API key client activity for this period");
  });
});
