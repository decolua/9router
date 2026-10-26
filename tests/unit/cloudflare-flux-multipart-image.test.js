/**
 * Unit tests for the Cloudflare Flux-2 multipart img2img fix.
 *
 * Covers (part of #5190, gap 3): buildMultipartBody must forward the
 * reference image as `input_image_0` (binary), per the Workers AI REST
 * contract for flux-2-dev/klein. Previously the image was silently dropped.
 */

import { describe, it, expect } from "vitest";
import adapter from "../../open-sse/handlers/imageProviders/cloudflareAi.js";

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const DATA_URI = `data:image/png;base64,${TINY_PNG_B64}`;
const MODEL = "@cf/black-forest-labs/flux-2-dev";

describe("cloudflare flux-2 multipart body", () => {
  it("appends the reference image as input_image_0", async () => {
    const body = await adapter.buildBody(MODEL, { prompt: "edit", image: DATA_URI });
    expect(body).toBeInstanceOf(FormData);
    const file = body.get("input_image_0");
    expect(file).not.toBeNull();
    const buf = Buffer.from(await file.arrayBuffer());
    expect(buf.toString("base64")).toBe(TINY_PNG_B64);
  });

  it("omits input_image_0 when no image is provided", async () => {
    const body = await adapter.buildBody(MODEL, { prompt: "a sunset" });
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("input_image_0")).toBeNull();
    expect(body.get("prompt")).toBe("a sunset");
  });
});
