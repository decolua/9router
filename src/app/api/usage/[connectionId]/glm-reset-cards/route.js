import "open-sse/index.js";
import { getProviderConnectionById } from "@/lib/db/index.js";
import { getGlmResetCards, redeemGlmResetCard } from "open-sse/services/usage.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "../route.js";

const inFlight = new Set();
const credential = (connection) => connection.apiKey || connection.accessToken || "";
const validId = (value) => Number.isSafeInteger(value) || (typeof value === "string" && value.trim().length > 0 && value.length <= 512);
const failure = (code, message, status = 400, uncertain = false) => Response.json({ reset: false, alreadyUsed: false, uncertain, error: message, code, message }, { status });
const safeText = (value, fallback) => typeof value === "string" && value.trim() ? value.trim().slice(0, 400) : fallback;

function mutationGuard(request) {
  const origin = request.headers.get("origin");
  if (origin) {
    let sameOrigin = false;
    try {
      const source = new URL(origin);
      const target = new URL(request.url);
      let host = (request.headers.get("host") || target.host).trim().toLowerCase();
      if ((source.protocol === "http:" && host.endsWith(":80")) || (source.protocol === "https:" && host.endsWith(":443"))) host = host.slice(0, host.lastIndexOf(":"));
      // TLS termination is accepted only with matching authority and browser-set same-origin metadata.
      const protocolMatches = source.protocol === target.protocol || (source.protocol === "https:" && target.protocol === "http:" && request.headers.get("sec-fetch-site") === "same-origin");
      sameOrigin = protocolMatches && source.host === host && !source.username && !source.password && source.pathname === "/" && !source.search && !source.hash;
    } catch {}
    if (!sameOrigin) return failure("cross_origin", "Cross-origin request rejected.", 403);
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return failure("invalid_content_type", "Content-Type must be application/json.");
  return null;
}

async function resolveConnection(connectionId) {
  const connection = await getProviderConnectionById(connectionId);
  if (!connection) return { response: failure("not_found", "Connection not found.", 404) };
  if (connection.provider !== "glm") return { response: failure("unsupported_provider", "GLM reset cards are only available for GLM connections.") };
  if (!["oauth", "apikey", "api_key"].includes(connection.authType)) return { response: failure("unsupported_auth", "GLM reset cards require an OAuth or API-key connection.") };
  if (!credential(connection)) return { response: failure("missing_credential", "GLM connection has no stored credential.") };
  return { connection, proxyOptions: { ...(await resolveConnectionProxyConfig(connection.providerSpecificData)), strictProxy: false } };
}

async function refresh(connection, force, proxyOptions) {
  try {
    return (await refreshAndUpdateCredentials(connection, force, proxyOptions))?.connection || connection;
  } catch {
    throw Object.assign(new Error("Credential refresh failed. Please re-authorize the connection."), { status: 401, credentialFailure: true });
  }
}

async function readInventory(connection, proxyOptions) {
  if (connection.authType === "oauth") connection = await refresh(connection, false, proxyOptions);
  let inventory;
  try {
    inventory = await getGlmResetCards(credential(connection), proxyOptions);
  } catch (error) {
    if (connection.authType !== "oauth" || !connection.refreshToken || ![401, 403].includes(Number(error?.status))) throw error;
    connection = await refresh(connection, true, proxyOptions);
    inventory = await getGlmResetCards(credential(connection), proxyOptions);
  }
  if (!Array.isArray(inventory?.cards)) throw new Error("Invalid reset-card inventory response");
  return { connection, inventory };
}

function readFailure(error, mutation = false) {
  const code = Number(error?.status);
  const status = [401, 403].includes(code) ? 401 : Number.isInteger(code) && code >= 400 && code < 500 ? code : 502;
  const message = error?.credentialFailure ? "Credential refresh failed. Please re-authorize the connection." : "Could not load GLM reset cards.";
  return mutation ? failure("read_failed", message, status) : Response.json({ error: message }, { status });
}

export async function GET(_request, { params }) {
  try {
    const { connectionId } = await params;
    const resolved = await resolveConnection(connectionId);
    if (resolved.response) return resolved.response;
    try {
      return Response.json((await readInventory(resolved.connection, resolved.proxyOptions)).inventory);
    } catch (error) {
      return readFailure(error);
    }
  } catch {
    return Response.json({ error: "Internal server error." }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  let lockKey;
  try {
    const guard = mutationGuard(request);
    if (guard) return guard;
    let body;
    try { body = await request.json(); } catch { return failure("invalid_body", "Invalid JSON body."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return failure("invalid_body", "Request body must be a JSON object.");
    if (!validId(body.recordId)) return failure("invalid_record_id", "recordId must be a safe integer or non-blank string.");
    if (!["FIVE_HOUR", "WEEK"].includes(body.type)) return failure("invalid_type", "type must be FIVE_HOUR or WEEK.");
    const { connectionId } = await params;
    const resolved = await resolveConnection(connectionId);
    if (resolved.response) return resolved.response;
    const key = resolved.connection.id || connectionId;
    if (inFlight.has(key)) return failure("reset_in_progress", "A reset-card redemption is already in progress for this connection.", 409, true);
    inFlight.add(key);
    lockKey = key;
    let read;
    try { read = await readInventory(resolved.connection, resolved.proxyOptions); } catch (error) { return readFailure(error, true); }
    const card = read.inventory.cards.find((entry) => entry.type === body.type && validId(entry.recordId) && String(entry.recordId) === String(body.recordId));
    if (!card) return failure("no_card", "Selected reset card is no longer available.", 409);
    if (typeof card.expiresAt !== "string" || !Number.isFinite(Date.parse(card.expiresAt)) || Date.parse(card.expiresAt) <= Date.now()) return failure("expired", "Selected reset card has expired.", 409);
    let result;
    // Never retry the consuming request, including after authentication or transport failure.
    try { result = await redeemGlmResetCard(credential(read.connection), card, resolved.proxyOptions); } catch {}
    if (result?.ok === true && result.alreadyUsed !== true && result.uncertain !== true) {
      return Response.json({ reset: true, alreadyUsed: false, code: safeText(result.code, "SUCCESS"), message: safeText(result.message, "GLM usage reset successfully.") });
    }
    const localRejection = result?.ok === false && result.uncertain === false && Number.isInteger(result.status) && result.status >= 400 && result.status < 500;
    return Response.json({ reset: false, alreadyUsed: false, uncertain: !localRejection, code: safeText(result?.code, localRejection ? "rejected" : "uncertain"), message: safeText(result?.message, "Reset outcome is unknown. Check the Z.ai dashboard before trying again.") }, { status: localRejection ? result.status : 502 });
  } catch {
    return Response.json({ error: "Internal server error." }, { status: 500 });
  } finally {
    if (lockKey !== undefined) inFlight.delete(lockKey);
  }
}
