import { NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { eventsFile } from "@/lib/piiGuard/observe.js";

export const dynamic = "force-dynamic";
const HASH = /^[0-9a-f]{12}$/;
// Captured OCR image by the 12-char sha256 prefix an OCR event carries.
// The path is in ALWAYS_PROTECTED (dashboardGuard.js), so it needs a login even when requireLogin is off.
// Files are named <sha256>.<ext> by the capture store and expire after the capture TTL (default 14 days).
const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
async function image(prefix) {
  if (!HASH.test(prefix || "")) return NextResponse.json({ error: "Invalid image id" }, { status: 400 });
  const dir = join(dirname(eventsFile()), "images");
  const name = (await readdir(dir).catch(() => [])).find((n) => n.startsWith(prefix) && /^[0-9a-f]{64}\.[a-z]+$/.test(n));
  const type = name && IMAGE_TYPES[name.split(".").pop()];
  if (!type) return NextResponse.json({ error: "Image expired" }, { status: 404 });
  const bytes = await readFile(join(dir, name)).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "Image expired" }, { status: 404 });
  return new NextResponse(bytes, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } });
}


export async function GET(request) {
  return image(new URL(request.url).searchParams.get("id"));
}
