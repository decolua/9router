import { describe, expect, it } from "vitest";
import { persistOmpModelSelection } from "../../src/app/(dashboard)/dashboard/cli-tools/components/ompModelSelection.js";

const okResponse = { ok: true, json: async () => ({ success: true }) };

function recordingRequest(responses = []) {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    return responses.shift() || okResponse;
  };
  return { calls, request };
}

describe("persistOmpModelSelection", () => {
  it("deletes removed models before posting the current selection", async () => {
    const { calls, request } = recordingRequest();

    await persistOmpModelSelection({
      request,
      previousModels: ["old/model", "keep/model"],
      models: ["keep/model", "new/model"],
      payload: { baseUrl: "http://127.0.0.1:20128/v1", roles: { default: "keep/model" } },
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      url: "/api/cli-tools/omp-settings?model=old%2Fmodel",
      options: { method: "DELETE" },
    });
    expect(calls[1].url).toBe("/api/cli-tools/omp-settings");
    expect(calls[1].options.method).toBe("POST");
    expect(JSON.parse(calls[1].options.body)).toEqual({
      baseUrl: "http://127.0.0.1:20128/v1",
      roles: { default: "keep/model" },
      models: ["keep/model", "new/model"],
    });
  });

  it("deletes every previous model without an invalid empty POST", async () => {
    const { calls, request } = recordingRequest();

    await persistOmpModelSelection({
      request,
      previousModels: ["first/model", "second/model"],
      models: [],
      payload: {},
    });

    expect(calls.map(({ url, options }) => [options.method, url])).toEqual([
      ["DELETE", "/api/cli-tools/omp-settings?model=first%2Fmodel"],
      ["DELETE", "/api/cli-tools/omp-settings?model=second%2Fmodel"],
    ]);
  });

  it("stops and reports a failed model removal", async () => {
    const { calls, request } = recordingRequest([
      { ok: false, json: async () => ({ error: "models.yml is corrupt" }) },
    ]);

    await expect(persistOmpModelSelection({
      request,
      previousModels: ["old/model"],
      models: ["new/model"],
      payload: {},
    })).rejects.toThrow("models.yml is corrupt");
    expect(calls).toHaveLength(1);
  });

  it("reports a failed additive POST", async () => {
    const { request } = recordingRequest([
      { ok: false, json: async () => ({ error: "config.yml is corrupt" }) },
    ]);

    await expect(persistOmpModelSelection({
      request,
      previousModels: ["keep/model"],
      models: ["keep/model", "new/model"],
      payload: {},
    })).rejects.toThrow("config.yml is corrupt");
  });
});
