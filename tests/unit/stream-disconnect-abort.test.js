import { describe, it, expect } from "vitest";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";

// #4914: client disconnect must abort the upstream fetch at once — every
// millisecond of delay is upstream tokens billed for a reader that is gone.
describe("createStreamController disconnect", () => {
  it("aborts the upstream signal synchronously on disconnect", () => {
    const ctrl = createStreamController({ provider: "openai", model: "m" });
    ctrl.handleDisconnect("client_closed");
    expect(ctrl.signal.aborted).toBe(true);
  });

  it("still reports the disconnect to the caller", () => {
    let seen = null;
    const ctrl = createStreamController({ provider: "openai", model: "m", onDisconnect: (e) => { seen = e; } });
    ctrl.handleDisconnect("cancelled");
    expect(seen?.reason).toBe("cancelled");
  });
});
