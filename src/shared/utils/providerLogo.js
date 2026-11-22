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
 * Turns a picked file into a square data URL no wider than `size` px. The full
 * image is scaled to fit, leaving transparent padding instead of cropping a
 * wide or tall provider wordmark.
 * Throws a readable message instead of storing anything oversized.
 */
export async function readLogoFile(file, size = 96) {
  if (!file) throw new Error("Pick an image file");
  if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/i.test(file.type || "")) throw new Error("Use a PNG, JPEG, WebP or GIF image");
  if (file.size > MAX_LOGO_BYTES) throw new Error("Image is larger than 5 MB, pick a smaller one");

  const img = await loadImage(await readAsDataUrl(file));
  const sourceWidth = img.naturalWidth || 0;
  const sourceHeight = img.naturalHeight || 0;
  const longestSide = Math.max(sourceWidth, sourceHeight);
  if (!longestSide) throw new Error("That image has no size, it cannot be used");

  const target = Math.min(size, longestSide);
  const scale = target / longestSide;
  const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
  const drawHeight = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  const x = Math.floor((target - drawWidth) / 2);
  const y = Math.floor((target - drawHeight) / 2);
  ctx.drawImage(img, 0, 0, sourceWidth, sourceHeight, x, y, drawWidth, drawHeight);

  let dataUrl = canvas.toDataURL("image/png");
  if (dataUrl.length > MAX_LOGO_CHARS) {
    dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  }
  if (dataUrl.length > MAX_LOGO_CHARS) throw new Error("That image is too detailed to store, use a simpler one");
  return dataUrl;
}
