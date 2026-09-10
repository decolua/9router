import { describe, expect, it } from "vitest";
import { CommandCodeExecutor } from "../../open-sse/executors/commandcode.js";

describe("Command Code ZDR upstream header", () => {
  it("adds x-cmd-zdr only for a connection that explicitly enables ZDR", () => {
    const executor = new CommandCodeExecutor();

    expect(executor.buildHeaders({ apiKey: "test" })["x-cmd-zdr"]).toBeUndefined();
    expect(executor.buildHeaders({ apiKey: "test", providerSpecificData: {} })["x-cmd-zdr"]).toBeUndefined();
    expect(executor.buildHeaders({ apiKey: "test", providerSpecificData: { zdrEnabled: false } })["x-cmd-zdr"]).toBeUndefined();
    expect(executor.buildHeaders({ apiKey: "test", providerSpecificData: { zdrEnabled: "true" } })["x-cmd-zdr"]).toBeUndefined();
    expect(executor.buildHeaders({ apiKey: "test", providerSpecificData: { zdrEnabled: true } })["x-cmd-zdr"]).toBe("1");
  });
});
