// The Qoder image upload must match the shape verified against production and
// qodercli 1.1.86:
//   host  center.qoder.sh                     (endpoint type "fn")
//   PUT   /algo/api/v2/image/upload?request_id=<32 hex>
//   body  multipart/form-data, field "file"
//   auth  Authorization: Bearer COSY.<payload>.<sig>
//   sig   COSY over String(body.length) — NOT the body bytes — while
//         Cosy-Bodylength carries the real multipart length.
// Signing the body bytes yields 403 {"code":"101","message":"Signature invalid"};
// pointing at api2/openapi yields 500/403. Both are covered here so the shape
// cannot silently regress.
import { createHash } from "node:crypto";
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

  it("PUTs multipart to center.qoder.sh signed over the body length", async () => {
    const fetchMock = mockUndiciFetch(async () =>
      jsonResponse({ result: { url: "https://oss.example/img.png" } }),
    );
    const { rewriteQoderMessageAttachments } = await loadAttachments();

    const messages = imageMessage();
    const stats = await rewriteQoderMessageAttachments(messages, { credentials });

    expect(stats.uploaded).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("PUT");
    expect(String(url)).toMatch(
      /^https:\/\/center\.qoder\.sh\/algo\/api\/v2\/image\/upload\?request_id=[0-9a-f]{32}$/,
    );

    const requestId = String(url).split("request_id=")[1];
    const body = init.body;
    expect(init.headers["Content-Type"]).toBe(
      `multipart/form-data; boundary=${/boundary=(----qodercli-[0-9a-f]+)/.exec(init.headers["Content-Type"])[1]}`,
    );
    expect(init.headers["Content-Type"]).toMatch(/^multipart\/form-data; boundary=----qodercli-[0-9a-f]+$/);
    expect(init.headers["Content-Length"]).toBe(String(body.length));

    // COSY: signature input is the length string, bodyhash is its md5, but the
    // length header describes the real multipart payload.
    const lengthString = String(body.length);
    expect(init.headers["Cosy-Bodylength"]).toBe(lengthString);
    expect(init.headers["Cosy-Bodyhash"]).toBe(
      createHash("md5").update(lengthString).digest("hex"),
    );
    expect(init.headers["Cosy-Sigpath"]).toBe("/api/v2/image/upload");
    expect(init.headers.Authorization).toMatch(/^Bearer COSY\.[A-Za-z0-9+/=]+\.[0-9a-f]{32}$/);
    expect(init.headers["X-Request-Id"]).toBe(requestId);

    // multipart field name the client uses
    const head = body.subarray(0, 200).toString("latin1");
    expect(head).toContain('name="file"');
    expect(head).toContain('filename="image.png"');
    expect(head).toContain("Content-Type: image/png");

    expect(messages[0].content[1]).toEqual({
      type: "image_url",
      image_url: { url: "https://oss.example/img.png" },
    });
  });

  it("never points the upload at the inference or openapi hosts", async () => {
    const fetchMock = mockUndiciFetch(async () => jsonResponse({ result: { url: "https://oss.example/x.png" } }));
    const { rewriteQoderMessageAttachments } = await loadAttachments();

    await rewriteQoderMessageAttachments(imageMessage(), { credentials });

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain("api2.qoder.sh");
    expect(String(url)).not.toContain("api3.qoder.sh");
    expect(String(url)).not.toContain("openapi.qoder.sh");
  });

  it("falls back to inlining when the upload is rejected", async () => {
    mockUndiciFetch(async () => jsonResponse({ code: "403" }, 403));
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

    const big = "A".repeat(800 * 1024);
    const messages = [
      { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${big}` } }] },
    ];
    await rewriteQoderMessageAttachments(messages, { credentials });

    expect(messages[0].content[0].type).toBe("text");
    expect(messages[0].content[0].text).toMatch(/upload failed/i);
  });
});
