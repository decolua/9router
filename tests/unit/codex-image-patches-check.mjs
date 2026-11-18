import assert from "node:assert/strict";
import sharp from "sharp";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { fitCodexImage } from "../../open-sse/utils/codexImage.js";

const uri = (buffer) => `data:image/jpeg;base64,${buffer.toString("base64")}`;
const large = uri(await sharp({ create: { width: 4536, height: 8064, channels: 3, background: "white" } }).jpeg().toBuffer());
const small = uri(await sharp({ create: { width: 640, height: 480, channels: 3, background: "white" } }).jpeg().toBuffer());
const body = { input: [{ role: "user", content: [
  { type: "image_url", image_url: { url: large, detail: "original" } },
  { type: "input_image", image_url: large, detail: "high" },
  { type: "input_image", image_url: small, detail: "low" },
  { type: "input_text", text: "Compare these images" },
] }] };
await new CodexExecutor().prefetchImages(body);
for (const [index, image] of body.input[0].content.slice(0, 2).entries()) {
  const { width, height } = await sharp(Buffer.from(image.image_url.split(",")[1], "base64")).metadata();
  assert.ok(Math.ceil(width / 32) * Math.ceil(height / 32) <= 30000);
  assert.ok(width < 4536 && height < 8064);
  assert.ok(Math.abs(width / height - 4536 / 8064) < 0.001);
  assert.equal(image.type, "input_image");
  assert.equal(image.detail, index === 0 ? "original" : "high");
}
assert.equal(body.input[0].content[2].image_url, small);
assert.equal(body.input[0].content[3].text, "Compare these images");
assert.equal(await fitCodexImage("https://example.com/image.jpeg"), "https://example.com/image.jpeg");
assert.equal(await fitCodexImage("data:image/jpeg;base64,bad"), "data:image/jpeg;base64,bad");
const wide = uri(await sharp({ create: { width: 65500, height: 512, channels: 3, background: "white" } }).jpeg().toBuffer());
const fitted = await fitCodexImage(wide);
const wideMetadata = await sharp(Buffer.from(fitted.split(",")[1], "base64")).metadata();
assert.ok(Math.ceil(wideMetadata.width / 32) * Math.ceil(wideMetadata.height / 32) <= 30000);
console.log("Codex image patch checks passed");
