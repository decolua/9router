import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeDiscoveredDevinModels, discoverDevinModels } from "open-sse/services/devinModels.js";

function varint(value) {
  const out = [];
  let current = BigInt(value);
  while (current > 127n) {
    out.push(Number(current & 127n) | 128);
    current >>= 7n;
  }
  out.push(Number(current));
  return Buffer.from(out);
}

function field(number, value) {
  const bytes = Buffer.from(value);
  return Buffer.concat([varint(BigInt(number << 3 | 2)), varint(bytes.length), bytes]);
}

function numberField(number, value) {
  return Buffer.concat([varint(BigInt(number << 3)), varint(value)]);
}

describe("Devin model discovery", () => {
  it("decodes enabled model configs and filters disabled entries", () => {
    const enabled = Buffer.concat([
      field(1, "SWE-1.7"), numberField(4, 0), numberField(5, 0), numberField(18, 200000), field(22, "swe-1-7"),
    ]);
    const disabled = Buffer.concat([
      field(1, "Disabled"), numberField(4, 1), field(22, "disabled"),
    ]);
    const payload = Buffer.concat([field(1, enabled), field(1, disabled)]);
    expect(decodeDiscoveredDevinModels(payload)).toEqual([{
      id: "swe-1-7",
      name: "SWE-1.7",
      contextLength: 200000,
      maxOutputTokens: 64000,
      input: ["text"],
      reasoning: false,
    }]);
  });

  it("decodes gzip-compressed discovery payloads", () => {
    const config = Buffer.concat([field(1, "SWE thinking"), numberField(4, 0), numberField(18, 100000), field(22, "swe-thinking")]);
    expect(decodeDiscoveredDevinModels(gzipSync(field(1, config)))[0]).toMatchObject({ id: "swe-thinking", reasoning: true, contextLength: 100000 });
  });

  it("posts the Devin auth metadata to the discovery endpoint", async () => {
    const config = Buffer.concat([field(1, "SWE-1.7"), numberField(4, 0), field(22, "swe-1-7")]);
    let request;
    const models = await discoverDevinModels("token", {
      fetchImpl: async (url, init) => {
        request = { url, init };
        return new Response(field(1, config), { status: 200 });
      },
    });
    expect(request.url).toContain("GetCliModelConfigs");
    expect(request.init.headers["content-type"]).toBe("application/proto");
    expect(request.init.body.toString("utf8")).toContain("3.2.23");
    expect(models[0].id).toBe("swe-1-7");
  });
});
