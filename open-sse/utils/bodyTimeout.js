// Bound a non-streaming upstream body read.
//
// FETCH_CONNECT_TIMEOUT_MS only guarantees that response HEADERS arrive. An
// upstream that answers 200 and then stalls mid-body left `await response.json()`
// waiting with no deadline at all, so the caller blocked indefinitely on a request
// that was never going to finish — observed as 120s+ silent holds and client
// sockets stranded in CLOSE-WAIT. Streaming already bounds itself with
// first-chunk and stall timeouts; this is the non-streaming equivalent.
import { RESPONSE_BODY_TIMEOUT_MS } from "../config/runtimeConfig.js";

export class BodyReadTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Upstream did not finish sending the response body within ${timeoutMs}ms`);
    this.name = "BodyReadTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Read a fetch Response body with a deadline.
 *
 * @param {Response} response - upstream response whose headers already arrived
 * @param {"json"|"text"} kind - how to decode the body
 * @param {number} [timeoutMs] - deadline; <= 0 or non-finite disables the bound
 * @returns {Promise<any>} parsed body
 * @throws {BodyReadTimeoutError} when the body does not arrive in time
 */
export async function readBodyWithTimeout(response, kind = "json", timeoutMs = RESPONSE_BODY_TIMEOUT_MS) {
  const read = () => (kind === "text" ? response.text() : response.json());

  // Explicit opt-out keeps the previous unbounded behaviour available.
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return read();

  let timer = null;
  try {
    return await Promise.race([
      read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new BodyReadTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof BodyReadTimeoutError) {
      // Drop the half-read connection rather than leaking the socket.
      try {
        await response.body?.cancel();
      } catch {
        /* already torn down */
      }
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
