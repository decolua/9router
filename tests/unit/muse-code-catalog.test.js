import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/v1/muse-code/models/route.js";

describe("muse-code catalog endpoint", () => {
  it("returns the Muse schema with model entries", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("list");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(5);
    const entry = body.data.find((m) => m.id === "mc/muse-spark-1.2");
    expect(entry).toBeTruthy();
    expect(entry.object).toBe("model");
    expect(entry.owned_by).toBe("mc");
    const meta = entry.metadata["muse-code"];
    expect(meta).toBeTruthy();
    expect(meta.reasoning).toBe(true);
    expect(meta.tool_call).toBe(true);
    expect(meta.modalities.input).toContain("text");
    expect(meta.limit.context).toBe(1048576);
  });

  it("maps other providers (ocg) so Muse can reach any 9Router model", async () => {
    const res = await GET();
    const body = await res.json();
    const anyOcg = body.data.find((m) => m.owned_by === "opencode-go");
    expect(anyOcg).toBeTruthy();
  });
});
