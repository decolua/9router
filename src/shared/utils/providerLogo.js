// Custom provider logos live inside the provider node record as a small data
// URL, so they travel with DB backups (and the automatic Telegram/GitHub
// backup) and need no asset route of their own. A value that is not a compact
// image data URL counts as "no logo", which keeps the built-in brand icon.

export const MAX_LOGO_BYTES = 5 * 1024 * 1024; // source file cap, read client side
const MAX_LOGO_CHARS = 512 * 1024; // stored data URL cap
const LOGO_PATTERN = /^data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,[\s\S]+$/i;

/** A logo value, or null when it is missing or not a storable image. */
export function isCustomLogo(value) {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if (!clean || clean.length > MAX_LOGO_CHARS) return null;
  return LOGO_PATTERN.test(clean) ? clean : null;
}

/** The node's own logo, or null when it has none. */
export function getCustomLogo(node) {
  return isCustomLogo(node?.logo);
}

/**
 * Server-side normalizer for an incoming logo value: "" clears it, a valid data
 * URL is returned as is, anything else yields undefined so the caller can 400.
 */
export function normalizeLogo(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") return undefined;
  const clean = value.trim();
  return LOGO_PATTERN.test(clean) && clean.length <= MAX_LOGO_CHARS ? clean : undefined;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read the file"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file is not a readable image"));
    img.src = src;
  });
}

/**
 * Turns a picked file into a square data URL no wider than `size` px: the
 * centre square is cropped, then scaled down, so any source lands at a few KB.
 * Throws a readable message instead of storing anything oversized.
 */
export async function readLogoFile(file, size = 96) {
  if (!file) throw new Error("Pick an image file");
  if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/i.test(file.type || "")) throw new Error("Use a PNG, JPEG, WebP or GIF image");
  if (file.size > MAX_LOGO_BYTES) throw new Error("Image is larger than 5 MB, pick a smaller one");

  const img = await loadImage(await readAsDataUrl(file));
  const source = Math.min(img.naturalWidth || 0, img.naturalHeight || 0);
  if (!source) throw new Error("That image has no size, it cannot be used");

  const target = Math.min(size, source);
  const sx = Math.floor((img.naturalWidth - source) / 2);
  const sy = Math.floor((img.naturalHeight - source) / 2);

  const canvas = document.createElement("canvas");
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, source, source, 0, 0, target, target);

  let dataUrl = canvas.toDataURL("image/png");
  if (dataUrl.length > MAX_LOGO_CHARS) {
    dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  }
  if (dataUrl.length > MAX_LOGO_CHARS) throw new Error("That image is too detailed to store, use a simpler one");
  return dataUrl;
}
