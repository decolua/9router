const zlib = require("node:zlib");

/**
 * Polyfill/Stub for Node.js <22.15.0 and <23.8.0 compatibility (Issue #5539).
 * undici@8.12.3 top-level executes createZstdDecompress.bind(...) in lib/interceptor/decompress.js.
 */
const isNativeZstdSupported = typeof zlib.createZstdDecompress === "function" && !zlib.createZstdDecompress._isStub;

if (!isNativeZstdSupported) {
  const stubZstd = function () {
    const err = new Error(
      "Zstandard decompression is not supported natively on Node.js <22.15.0. " +
      "Ensure Accept-Encoding does not advertise zstd to upstream."
    );
    err.code = "ERR_ZSTD_UNSUPPORTED";
    throw err;
  };
  stubZstd._isStub = true;
  zlib.createZstdDecompress = stubZstd;
}

/**
 * Strips 'zstd' from Accept-Encoding header if runtime lacks native zstd decompression.
 * Prevents upstream (Cloudflare/DeepSeek/Grok) from sending zstd-compressed payloads.
 *
 * @param {Headers|Record<string, string>|undefined} headers
 */
function sanitizeAcceptEncoding(headers) {
  if (isNativeZstdSupported || !headers) return headers;

  if (typeof headers.get === "function" && typeof headers.set === "function") {
    const ae = headers.get("accept-encoding");
    if (ae && /zstd/i.test(ae)) {
      const clean = ae.replace(/,?\s*zstd/gi, "").replace(/^,\s*/, "").trim();
      if (clean) headers.set("accept-encoding", clean);
      else headers.delete("accept-encoding");
    }
  } else {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "accept-encoding") {
        const ae = String(headers[key]);
        if (/zstd/i.test(ae)) {
          const clean = ae.replace(/,?\s*zstd/gi, "").replace(/^,\s*/, "").trim();
          if (clean) headers[key] = clean;
          else delete headers[key];
        }
      }
    }
  }
  return headers;
}

module.exports = {
  isNativeZstdSupported,
  sanitizeAcceptEncoding,
};
