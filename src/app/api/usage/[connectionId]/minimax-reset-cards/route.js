// MiniMax reset-card API — redemption is irreversible: server/journal card identity only,
// journal persisted before the single POST, reads force-refresh once per explicit 401/403
// but POSTs never retry, and responses are sanitized (pool/DB/refresh internals stay server-side).
import "open-sse/index.js";

import { getProviderConnectionById } from "@/lib/db/index.js";
import { getMiniMaxResetCardFlows, getMiniMaxResetCards, redeemMiniMaxResetCard } from "open-sse/services/usage.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "../route.js";
import { assertMiniMaxResetAccount, canonicalMiniMaxResetCard, createMiniMaxResetPending, loadMiniMaxResetState, miniMaxAccountKey, publicMiniMaxResetCard, publicMiniMaxResetPending, readMiniMaxResetPending, writeMiniMaxResetPending } from "@/lib/miniMaxResetState";

const UNKNOWN_OUTCOME = "Reset card redemption outcome is unknown. Verify on the provider dashboard before retrying.";
const KNOWN_REJECTS = ["EXPIRED", "NOT_FOUND", "RETRYABLE_FAIL"];
const inFlight = new Map(); // per-connection exclusion (best-effort, per-process)
const isBounded = (value, max = 256) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const acquireLock = (id) => { const key = `minimax:${id}`; return inFlight.has(key) ? null : (inFlight.set(key, 1), key); };

function recoveryResponse(code, message, pending = null, status = 409, uncertain = !!pending) {
  return Response.json({ reset: false, alreadyUsed: false, uncertain, error: message, code, message, pending: publicMiniMaxResetPending(pending) }, { status });
}

function failureResponse(error, pending) {
  if (error?.isMiniMaxResetStateError) return recoveryResponse(error.code, error.message, error.pending ?? pending, error.status, true);
  const status = Number(error?.status); // sanitized service read errors / constant credential failure only
  return recoveryResponse("read_failed", error.message, pending, status === 401 || status === 403 ? 401 : Number.isInteger(status) && status >= 400 && status < 500 ? status : 502);
}

const busyResponse = () => recoveryResponse("reset_in_progress", "A reset-card operation is already in progress for this connection.", null, 409, true);

async function resolveMiniMaxConnection(connectionId) {
  const connection = await getProviderConnectionById(connectionId);
  if (!connection) return { response: recoveryResponse("not_found", "Connection not found.", null, 404) };
  const pending = readMiniMaxResetPending(connection);
  if (pending) assertMiniMaxResetAccount(connection, pending.accountKey, pending);
  const guard = connection.provider !== "minimax-code-global" ? ["unsupported_provider", "MiniMax reset cards are only available for MiniMax Code (Global) connections."]
    : connection.authType !== "oauth" ? ["unsupported_auth", "MiniMax reset cards require an OAuth connection."]
    : !connection.accessToken ? ["missing_credential", "MiniMax connection has no stored access token."] : null;
  if (guard) return { response: recoveryResponse(guard[0], guard[1], null, 400) };
  const accountKey = miniMaxAccountKey(connection.accessToken);
  assertMiniMaxResetAccount(connection, accountKey, pending);
  const proxyOptions = { ...(await resolveConnectionProxyConfig(connection.providerSpecificData)), strictProxy: false }; // pool stays server-side
  return { connection, pending, accountKey, proxyOptions };
}

// Parent usage-route refresh, re-used directly. The durable state is loaded
// first: the parent re-reads the latest credentials internally, so the
// account must be asserted BEFORE a refresh can run for a changed connection.
async function ensureFreshCredentials(connection, proxyOptions, accountKey, pending, force = false) {
  await loadMiniMaxResetState(connection.id, accountKey, pending);
  let refreshed;
  try {
    refreshed = (await refreshAndUpdateCredentials(connection, force, proxyOptions))?.connection || connection;
  } catch {
    console.error("[MiniMax Reset Cards] credential refresh failed");
    throw Object.assign(new Error("Credential refresh failed. Please re-authorize the connection."), { status: 401 });
  }
  assertMiniMaxResetAccount(refreshed, accountKey, pending);
  return refreshed;
}

// One upstream read bracketed by a durable-state re-check after it; a single
// force-refresh retry is allowed ONLY on an explicit 401/403 (never POSTs).
async function readResetData(connection, proxyOptions, accountKey, pending, cards) {
  const read = async (conn) => {
    const data = cards
      ? (await getMiniMaxResetCards(conn.accessToken, conn.provider, proxyOptions))?.cards
      : await getMiniMaxResetCardFlows(conn.accessToken, conn.provider, proxyOptions);
    await loadMiniMaxResetState(conn.id, accountKey, pending);
    if (cards && !Array.isArray(data)) throw Object.assign(new Error("Invalid reset-card inventory response"), { status: 502 });
    return cards ? { availableCount: data.length, cards: data.map(canonicalMiniMaxResetCard) } : data;
  };
  try {
    return { value: await read(connection), connection };
  } catch (error) {
    if (error?.isMiniMaxResetStateError || !connection.refreshToken || ![401, 403].includes(Number(error?.status))) throw error;
    const refreshed = await ensureFreshCredentials(connection, proxyOptions, accountKey, pending, true);
    return { value: await read(refreshed), connection: refreshed };
  }
}

// Exact cardId/USE event is the only proof of redemption; malformed history fails closed.
const isCardUsed = (flows, cardId) => {
  if (!Array.isArray(flows)) throw Object.assign(new Error("Invalid reset-card history response"), { status: 502 });
  return flows.some((flow) => flow?.cardId === cardId && flow?.eventType === "USE");
};
// Fail closed: unknown or malformed expiry blocks the mutation.
const isCardExpired = (card, now = Date.now()) => typeof card?.expiresAt !== "string" || !Number.isFinite(Date.parse(card.expiresAt)) || Date.parse(card.expiresAt) <= now;

export async function GET(request, { params }) {
  let lockKey = null;
  let pending = null;
  try {
    const { connectionId } = await params;
    const cardId = new URL(request.url).searchParams.get("cardId");
    if (cardId !== null && !isBounded(cardId)) return recoveryResponse("invalid_card_id", "cardId must be a non-blank string.", null, 400);
    if (!(lockKey = acquireLock(connectionId))) return busyResponse();
    const resolved = await resolveMiniMaxConnection(connectionId);
    if (resolved.response) return resolved.response;
    let { connection } = resolved;
    const { accountKey, proxyOptions } = resolved;
    pending = resolved.pending;
    try {
      connection = await ensureFreshCredentials(connection, proxyOptions, accountKey, pending);
      if (cardId === null) {
        const read = await readResetData(connection, proxyOptions, accountKey, pending, true);
        return Response.json({ availableCount: read.value.availableCount, cards: read.value.cards.map(publicMiniMaxResetCard), pending: publicMiniMaxResetPending(pending) });
      }
      const used = isCardUsed((await readResetData(connection, proxyOptions, accountKey, pending, false)).value, cardId);
      if (used && pending?.card.cardId === cardId && pending.state === "uncertain") {
        pending = (await writeMiniMaxResetPending(connectionId, accountKey, pending, { ...pending, state: "refreshing" })).pending; // exact proof promotes
      }
      return Response.json({ used, pending: publicMiniMaxResetPending(pending) });
    } catch (error) {
      return failureResponse(error, pending);
    }
  } catch (error) {
    if (error?.isMiniMaxResetStateError) return failureResponse(error, pending);
    console.warn("[MiniMax Reset Cards] internal read error");
    return recoveryResponse("internal_error", "Internal server error.", pending, 500, true);
  } finally {
    if (lockKey) inFlight.delete(lockKey);
  }
}

export async function POST(request, { params }) {
  let lockKey = null;
  let pending = null;
  try {
    // CSRF/JSON guard: a present Origin must be a pathless browser serialization whose
    // host[:port] equals the Host header authority (fallback: request URL) and whose protocol
    // matches — https Origin over plain http additionally requires the JS-unforgeable
    // Sec-Fetch-Site: same-origin marker (TLS-terminating proxy). Content-Type media type
    // must be exactly application/json. Checked before any DB or upstream work.
    const origin = request.headers.get("origin");
    if (origin) {
      let sameOrigin = false;
      try {
        const o = new URL(origin);
        const u = new URL(request.url);
        let host = (request.headers.get("host") || "").trim().toLowerCase();
        if ((o.protocol === "http:" && host.endsWith(":80")) || (o.protocol === "https:" && host.endsWith(":443"))) host = host.slice(0, host.lastIndexOf(":"));
        sameOrigin = !o.username && !o.password && (o.pathname === "/" || o.pathname === "") && !o.search && !o.hash
          && (o.protocol === u.protocol || (o.protocol === "https:" && u.protocol === "http:" && request.headers.get("sec-fetch-site") === "same-origin"))
          && o.host === (host || u.host);
      } catch { /* malformed Origin — rejected below */ }
      if (!sameOrigin) return recoveryResponse("cross_origin", "Cross-origin request rejected.", null, 403);
    }
    if ((request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "") !== "application/json") {
      return recoveryResponse("invalid_content_type", "Content-Type must be application/json.", null, 400);
    }
    const { connectionId } = await params;
    const body = await request.json().catch(() => null);
    const isObject = !!body && typeof body === "object" && !Array.isArray(body);
    if (!isObject || !isBounded(body.cardId)) {
      return recoveryResponse(isObject ? "invalid_card_id" : "invalid_body", isObject ? "cardId must be a non-blank string." : "Request body must be a JSON object.", null, 400);
    }
    if ((body.retry !== undefined && typeof body.retry !== "boolean") || (body.acknowledge !== undefined && typeof body.acknowledge !== "boolean")
      || (body.retry && body.acknowledge) || ((body.retry || body.acknowledge) && !isBounded(body.attemptId))) {
      return recoveryResponse("invalid_body", "Invalid reset recovery request.", null, 400);
    }
    if (!(lockKey = acquireLock(connectionId))) return busyResponse();
    const resolved = await resolveMiniMaxConnection(connectionId);
    if (resolved.response) return resolved.response;
    let { connection } = resolved;
    const { accountKey, proxyOptions } = resolved;
    pending = resolved.pending;

    if (body.acknowledge) {
      // Non-consuming: only the exact confirmed (refreshing) attempt clears, after a fresh inventory succeeds.
      if (!pending || pending.attemptId !== body.attemptId || pending.card.cardId !== body.cardId || pending.state !== "refreshing") {
        return recoveryResponse("attempt_changed", "Only the matching confirmed reset can be acknowledged.", pending, 409, true);
      }
      try {
        await readResetData(await ensureFreshCredentials(connection, proxyOptions, accountKey, pending), proxyOptions, accountKey, pending, true);
        await writeMiniMaxResetPending(connectionId, accountKey, pending, null);
        pending = null;
        return Response.json({ reset: false, alreadyUsed: true, confirmed: true, pending: null });
      } catch (error) {
        return failureResponse(error, pending);
      }
    }

    if (pending && (!body.retry || pending.state !== "uncertain" || pending.card.cardId !== body.cardId || pending.attemptId !== body.attemptId)) {
      return recoveryResponse("reset_pending", "Recover the previous reset before selecting another card.", pending);
    }
    if (body.retry && !pending) return recoveryResponse("no_pending", "There is no uncertain MiniMax reset to retry.", null, 409);

    try {
      connection = await ensureFreshCredentials(connection, proxyOptions, accountKey, pending);
      if (!pending) {
        const read = await readResetData(connection, proxyOptions, accountKey, pending, true);
        connection = read.connection;
        const card = read.value.cards.find((entry) => entry.cardId === body.cardId);
        if (!card) {
          let used = false; // a history read failure is not proof; never substitute another card
          try {
            used = isCardUsed((await readResetData(connection, proxyOptions, accountKey, pending, false)).value, body.cardId);
          } catch (error) {
            if (error?.isMiniMaxResetStateError) throw error;
          }
          if (used) return Response.json({ reset: false, alreadyUsed: true, code: "already_used", message: "Reset card was already used.", pending: null });
          return recoveryResponse("not_found", "Reset card is no longer available on this account.");
        }
        if (isCardExpired(card)) return recoveryResponse("expired", "Reset card has expired.");
        ({ pending, connection } = await writeMiniMaxResetPending(connectionId, accountKey, null, createMiniMaxResetPending(accountKey, card)));
      }
      if (isCardExpired(pending.card)) return recoveryResponse("expired", "Reset card has expired; the previous outcome still needs confirmation.", pending);
      ({ connection } = await loadMiniMaxResetState(connectionId, accountKey, pending)); // last durable/account check before the only irreversible call
    } catch (error) {
      return failureResponse(error, pending);
    }

    let result;
    try {
      result = await redeemMiniMaxResetCard(connection.accessToken, connection.provider, pending.card, proxyOptions);
    } catch {
      result = { ok: false, alreadyUsed: false, uncertain: true, status: 502, code: "mutation_failed", message: "Reset outcome is not confirmed." };
    }
    // Only canonical terminal outcomes release or promote the durable identity.
    const success = result?.attempted !== false && result?.uncertain === false
      && ((result?.code === "SUCCESS" && result?.ok === true) || (result?.code === "REPLAYED" && result?.alreadyUsed === true));
    const knownReject = result?.attempted !== false && result?.uncertain === false && result?.ok !== true && result?.alreadyUsed !== true && KNOWN_REJECTS.includes(result?.code);
    try {
      pending = (await writeMiniMaxResetPending(connectionId, accountKey, pending, success ? { ...pending, state: "refreshing" } : knownReject ? null : pending)).pending;
    } catch (error) {
      return failureResponse(error, pending);
    }
    const outcome = success
      ? { status: 200, reset: result.ok === true && result.alreadyUsed !== true, alreadyUsed: result.alreadyUsed === true, uncertain: false, code: result.code, message: result.message || (result.alreadyUsed ? "Reset card was already used." : "Reset card redeemed.") }
      : knownReject
        ? { status: 409, reset: false, alreadyUsed: false, uncertain: false, code: result.code, message: result.message || "Reset card redemption was rejected." }
        : { status: 502, reset: false, alreadyUsed: false, uncertain: true, code: result?.code || "uncertain", message: result?.message || UNKNOWN_OUTCOME };
    const { status, ...outcomeBody } = outcome;
    return Response.json({ ...outcomeBody, pending: publicMiniMaxResetPending(pending) }, { status });
  } catch (error) {
    if (error?.isMiniMaxResetStateError) return failureResponse(error, pending);
    console.warn("[MiniMax Reset Cards] internal mutation error");
    return recoveryResponse("internal_error", "Internal server error.", pending, 500, true);
  } finally {
    if (lockKey) inFlight.delete(lockKey);
  }
}
