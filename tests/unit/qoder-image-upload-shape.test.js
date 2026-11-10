// The Qoder image upload must match qodercli's real request shape:
//   PUT {inference}/algo/api/v2/image/upload?request_id=<uuid hex>
//   JSON body { data: <base64>, mediaType }
// A multipart body is rejected by the gateway with
// 403 {"code":"101","message":"Signature invalid"} — a shape error that reads
// like an auth error, which is what this suite exists to prevent regressing.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockUndiciFetch } from "./helpers/mockUndiciFetch.js";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

async function loadAttachments() {
  vi.resetModules();
  return import("../../open-sse/shared/qoder/attachments.js");
}

function imageMessage() {
  return [
    {
      role: "user",
      content: [
        { type: "text", text: "what is this?" },
        { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_B64}` } },
      ],
    },
  ];
}

const credentials = {
  accessToken: "jt-test-token",
  providerSpecificData: { userId: "user-1", machineId: "machine-1" },
  displayName: "tester",
  email: "t@example.com",
};

describe("qoder image upload shape", () => {
  beforeEach(() => {
    vi.doUnmock("undici");
  });

  it("uploads as a COSY-signed JSON PUT, not multipart", async () => {
    const fetchMock = mockUndiciFetch(async () =>
      jsonResponse({ success: true, result: { imageUrls: ["https://oss.example/img.png"] } }),
    );
    const { rewriteQoderMessageAttachments } = await loadAttachments();

    const messages = imageMessage();
    const stats = await rewriteQoderMessageAttachments(messages, { credentials });

    expect(stats.uploaded).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("PUT");
    expect(String(url)).toContain("/algo/api/v2/image/upload?request_id=");

    const requestId = String(url).split("request_id=")[1];
    expect(requestId).toMatch(/^[0-9a-f]{32}$/);

    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.Authorization).toMatch(/^Bearer COSY\./);
    expect(init.headers["Cosy-Sigpath"]).toBe("/api/v2/image/upload");

    const body = JSON.parse(init.body.toString("utf8"));
    expect(Object.keys(body).sort()).toEqual(["data", "mediaType"]);
    expect(body.mediaType).toBe("image/png");
    expect(body.data).toBe(PNG_B64);

    // The rewritten message points at the uploaded URL, not the data URI.
    expect(messages[0].content[1]).toEqual({
      type: "image_url",
      image_url: { url: "https://oss.example/img.png" },
    });
  });

  it("falls back to inlining when the upload is rejected", async () => {
    mockUndiciFetch(async () => jsonResponse({ code: "500" }, 500));
    const { rewriteQoderMessageAttachments } = await loadAttachments();

    const messages = imageMessage();
    const stats = await rewriteQoderMessageAttachments(messages, { credentials });

    expect(stats.uploaded).toBe(0);
    expect(messages[0].content[1]).toEqual({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${PNG_B64}` },
    });
  });

  it("stubs images larger than the inline cap when the upload fails", async () => {
    mockUndiciFetch(async () => jsonResponse({ code: "500" }, 500));
    const { rewriteQoderMessageAttachments } = await loadAttachments();

    // 600 KB of base64 -> 450 KB of bytes, under the 512 KB inline cap? No:
    // build >512 KB of bytes so the fallback must stub instead of inline.
    const big = "A".repeat(800 * 1024);
    const messages = [
      { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${big}` } }] },
    ];
    await rewriteQoderMessageAttachments(messages, { credentials });

    expect(messages[0].content[0].type).toBe("text");
    expect(messages[0].content[0].text).toMatch(/upload failed/i);
  });
});
