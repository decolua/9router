import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const section = read("src/app/(dashboard)/dashboard/providers/[id]/CompatibleModelsSection.js");
const route = read("src/app/api/providers/[id]/models/route.js");

describe("model import reports to the bell", () => {
  it("registers the run in the task store on start", () => {
    expect(section).toContain("useTaskStore");
    expect(section).toMatch(/start\(\{\s*id: taskId,\s*title: "Importing models"/);
  });

  it("reports progress into the store as models land", () => {
    expect(section).toContain("useTaskStore.getState().update(taskId");
    expect(section).toContain("useTaskStore.getState().finish(taskId)");
  });

  it("the bell picks it up without any extra wiring", () => {
    // NotifToast merges every store entry; a store row with an id the poll
    // does not know is shown verbatim. Lock the merge rule, not the page.
    const toast = read("src/shared/components/NotifToast.js");
    expect(toast).toMatch(/const seen = new Set\(tasks\.map\(\(t\) => t\.id\)\)/);
  });
});

describe("the model list fetch cannot hang the panel", () => {
  it("every direct outbound read races a fixed budget", () => {
    expect(route).toContain("MODELS_TIMEOUT_MS");
    expect(route).toContain("AbortSignal.timeout(MODELS_TIMEOUT_MS)");
    const direct = (route.match(/withModelTimeout\(/g) || []).length;
    // 2 provider-shape fetches + 1 generic config fetch, at minimum.
    expect(direct).toBeGreaterThanOrEqual(3);
  });

  it("custom resolvers run under the same ceiling", () => {
    expect(route).toContain("Promise.race([");
    expect(route).toContain("config.customResolver(connection, { signal: ctrl.signal })");
  });

  it("a timeout answers 504 with a plain sentence, not a crash 500", () => {
    expect(route).toContain('error?.name === "TimeoutError"');
    expect(route).toContain("status: 504");
    expect(route).toContain("did not answer within");
  });

  it("the client stops waiting on the route itself after 20s", () => {
    expect(section).toContain("LIST_TIMEOUT_MS = 20000");
    expect(section).toContain("new AbortController()");
    expect(section).toContain("controller.abort()");
    expect(section).toContain("timed out after 20 seconds");
  });
});
