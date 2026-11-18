import crypto from "node:crypto";

const SECRET_KEY = Symbol.for("9router.realtime.internal-secret");

export function getRealtimeInternalSecret() {
  return typeof globalThis[SECRET_KEY] === "string" ? globalThis[SECRET_KEY] : null;
}

export function isLoopbackAddress(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function isRealtimeInternalRequest(request) {
  const expected = getRealtimeInternalSecret();
  const supplied = request.headers.get("x-9r-realtime-secret");
  const peer = request.headers.get("x-9r-real-ip");
  if (!expected || !supplied || !isLoopbackAddress(peer)) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && crypto.timingSafeEqual(expectedBytes, suppliedBytes);
}