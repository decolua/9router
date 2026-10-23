import { createHash, randomUUID } from "node:crypto";
import { getProviderConnectionById } from "@/lib/db/index.js";
import { getAdapter } from "@/lib/db/driver.js";

const isNonblankBoundedString = (value, maxLength = 256) => typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;

export function miniMaxResetStateError(code, message, pending = null, status = 409) {
  return Object.assign(new Error(message), { code, status, pending, isMiniMaxResetStateError: true });
}

// OAuth supplies the token; this only binds recovery to its stable identity, not its expiry.
export function miniMaxAccountKey(accessToken) {
  try {
    if (typeof accessToken !== "string" || accessToken.length > 65536) return null;
    const parts = accessToken.split(".");
    if (parts.length !== 3 || !parts.every((part) => /^[\w-]+$/.test(part))) return null;
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!claims || typeof claims !== "object" || Array.isArray(claims)) return null;
    if (claims.iss !== undefined && !isNonblankBoundedString(claims.iss, 4096)) return null;
    const field = ["sub", "email", "preferred_username"].find((key) => isNonblankBoundedString(claims[key], 4096));
    if (!field) return null;
    return createHash("sha256").update(JSON.stringify([claims.iss ?? null, field, claims[field]])).digest("hex");
  } catch {
    return null;
  }
}

const isIsoDate = (value) => typeof value === "string"
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function canonicalMiniMaxResetCard(card) {
  if (!card || typeof card !== "object" || Array.isArray(card)
    || !isNonblankBoundedString(card.cardId)
    || !isNonblankBoundedString(card.source_type, 4096)
    || !isNonblankBoundedString(card.out_biz_no, 4096)
    || card.type !== "FULL" || !isIsoDate(card.expiresAt)) {
    throw miniMaxResetStateError("invalid_card", "Invalid MiniMax reset card.", null, 502);
  }
  return {
    cardId: card.cardId,
    source_type: card.source_type,
    out_biz_no: card.out_biz_no,
    type: "FULL",
    expiresAt: card.expiresAt,
    ...(card.createdAt === null || isIsoDate(card.createdAt) ? { createdAt: card.createdAt } : {}),
  };
}

export function readMiniMaxResetPending(connection) {
  const pending = connection?.miniMaxResetPending;
  if (pending === undefined || pending === null) return null;
  try {
    if (typeof pending !== "object" || Array.isArray(pending)
      || !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(pending.attemptId)
      || typeof pending.accountKey !== "string" || !/^[\da-f]{64}$/.test(pending.accountKey)
      || !isIsoDate(pending.startedAt)
      || !["uncertain", "refreshing"].includes(pending.state)) throw new Error();
    return {
      attemptId: pending.attemptId,
      accountKey: pending.accountKey,
      card: canonicalMiniMaxResetCard(pending.card),
      startedAt: pending.startedAt,
      state: pending.state,
    };
  } catch {
    throw miniMaxResetStateError("invalid_pending", "Stored MiniMax reset recovery state is invalid; no reset was sent.");
  }
}

export function publicMiniMaxResetCard(card) {
  return { cardId: card.cardId, type: "FULL", expiresAt: card.expiresAt };
}

export function publicMiniMaxResetPending(pending) {
  return pending ? {
    attemptId: pending.attemptId,
    state: pending.state,
    card: publicMiniMaxResetCard(pending.card),
    startedAt: pending.startedAt,
  } : null;
}

export function assertMiniMaxResetAccount(connection, accountKey, pending = null) {
  if (connection?.provider !== "minimax-code-global" || connection.authType !== "oauth") {
    throw miniMaxResetStateError("account_changed", "MiniMax connection changed; sign in to the original account to recover this reset.", pending);
  }
  const currentKey = miniMaxAccountKey(connection.accessToken);
  if (!currentKey || !accountKey) {
    throw miniMaxResetStateError("account_unavailable", "MiniMax account identity is unavailable; re-authorize the original account.", pending);
  }
  if (currentKey !== accountKey || (pending && pending.accountKey !== accountKey)) {
    throw miniMaxResetStateError("account_changed", "MiniMax account changed; sign in to the original account to recover this reset.", pending);
  }
}

export function createMiniMaxResetPending(accountKey, card) {
  return readMiniMaxResetPending({ miniMaxResetPending: {
    attemptId: randomUUID(), accountKey, card, startedAt: new Date().toISOString(), state: "uncertain",
  } });
}

export async function loadMiniMaxResetState(connectionId, accountKey, expectedPending) {
  let connection;
  try {
    (await getAdapter()).flush?.();
    connection = await getProviderConnectionById(connectionId);
  } catch {
    throw miniMaxResetStateError("state_unavailable", "Could not read MiniMax reset recovery state; no further reset was sent.", expectedPending, 503);
  }
  const pending = readMiniMaxResetPending(connection);
  assertMiniMaxResetAccount(connection, accountKey, pending);
  if (JSON.stringify(pending) !== JSON.stringify(expectedPending)) {
    throw miniMaxResetStateError("attempt_changed", "MiniMax reset attempt changed; refresh recovery state before continuing.", pending);
  }
  return { connection, pending };
}

export async function writeMiniMaxResetPending(connectionId, accountKey, expectedPending, nextPending) {
  const next = readMiniMaxResetPending({ miniMaxResetPending: nextPending });
  if (next && (next.accountKey !== accountKey || (expectedPending && (
    next.attemptId !== expectedPending.attemptId || next.startedAt !== expectedPending.startedAt
    || JSON.stringify(next.card) !== JSON.stringify(expectedPending.card)
    || (expectedPending.state === "refreshing" && next.state !== "refreshing")
  )))) {
    throw miniMaxResetStateError("attempt_changed", "MiniMax reset identity cannot change during recovery.", expectedPending);
  }
  try {
    const db = await getAdapter();
    db.transaction(() => {
      const row = db.get("SELECT * FROM providerConnections WHERE id = ?", [connectionId]);
      if (!row) throw miniMaxResetStateError("account_changed", "MiniMax connection changed; refresh recovery state.", expectedPending);
      const data = JSON.parse(row.data);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid connection data");
      const current = { ...data, id: row.id, provider: row.provider, authType: row.authType };
      const pending = readMiniMaxResetPending(current);
      assertMiniMaxResetAccount(current, accountKey, pending);
      if (JSON.stringify(pending) !== JSON.stringify(expectedPending)) {
        throw miniMaxResetStateError("attempt_changed", "MiniMax reset attempt changed; refresh before continuing.", pending);
      }
      data.miniMaxResetPending = next;
      db.run("UPDATE providerConnections SET data = ?, updatedAt = ? WHERE id = ?", [JSON.stringify(data), new Date().toISOString(), connectionId]);
    });
    // Deferred adapters must finish the journal write before any redemption can be sent.
    db.flush?.();
  } catch (error) {
    if (error?.isMiniMaxResetStateError) throw error;
    throw miniMaxResetStateError("state_unavailable", "Could not save MiniMax reset recovery state. Refresh before continuing.", expectedPending || next, 503);
  }
  return loadMiniMaxResetState(connectionId, accountKey, next);
}
