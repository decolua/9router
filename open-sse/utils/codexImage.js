import { parseDataUri } from "../translator/concerns/image.js";

const MAX_PATCHES = 30000;

export async function fitCodexImage(url) {
  const data = parseDataUri(url);
  if (!data) return url;
  const { default: sharp } = await import("sharp");
  const bytes = Buffer.from(data.base64, "base64");
  let metadata;
  try {
    metadata = await sharp(bytes).metadata();
  } catch {
    // Leave unsupported/invalid images to upstream validation, as before.
    return url;
  }
  let { width, height } = metadata;
  if (!width || !height) return url;
  if (metadata.orientation >= 5) [width, height] = [height, width];
  if (Math.ceil(width / 32) * Math.ceil(height / 32) <= MAX_PATCHES) return url;
  if (metadata.pages > 1) throw new Error("Codex image exceeds 30000 patches; resize animated images before uploading");
  const columns = Math.min(MAX_PATCHES, Math.max(1, Math.floor(Math.sqrt(MAX_PATCHES * width / height))));
  const rows = Math.floor(MAX_PATCHES / columns);
  let image = sharp(bytes).rotate().resize({ width: columns * 32, height: rows * 32, fit: "inside", withoutEnlargement: true });
  const format = metadata.format === "jpeg" ? "jpeg" : metadata.format === "webp" ? "webp" : "png";
  image = format === "jpeg" ? image.jpeg({ quality: 95 }) : format === "webp" ? image.webp({ quality: 95 }) : image.png();
  const { data: resized, info } = await image.toBuffer({ resolveWithObject: true });
  if (Math.ceil(info.width / 32) * Math.ceil(info.height / 32) > MAX_PATCHES) throw new Error("Failed to fit Codex image within 30000 patches");
  return `data:image/${format};base64,${resized.toString("base64")}`;
}
