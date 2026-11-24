import * as zlib from "node:zlib";
import { promisify } from "node:util";

// Bound expanded bodies, not just wire size, to avoid decompression bombs.
const MAX_DECOMPRESSED_BYTES = 100 * 1024 * 1024;
const decompressors = {
  gzip: promisify(zlib.gunzip),
  br: promisify(zlib.brotliDecompress),
  deflate: promisify(zlib.inflate),
  // Older Node releases can still serve ordinary JSON; zstd requires Node 22.15+.
  zstd: zlib.zstdDecompress ? promisify(zlib.zstdDecompress) : null,
};

/** Decode HTTP Content-Encoding before parsing JSON. Errors are handled by callers. */
export async function parseJsonBody(request, maxOutputLength = MAX_DECOMPRESSED_BYTES) {
  const encoding = (request.headers.get("content-encoding") || "identity").trim().toLowerCase();
  if (!encoding || encoding === "identity") return request.json();
  const decompress = Object.hasOwn(decompressors, encoding) && decompressors[encoding];
  if (!decompress) throw new Error(`Unsupported Content-Encoding: ${encoding}`);
  const bytes = Buffer.from(await request.arrayBuffer());
  const decoded = await decompress(bytes, { maxOutputLength });
  return JSON.parse(decoded.toString("utf8"));
}
