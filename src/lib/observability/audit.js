import { isIP } from "node:net";
import { getSettings, insertAuditEntry } from "@/lib/db/index.js";
import { hasTrustedPeerHeaders } from "../auth/trustedPeer.js";
import { redactLogValue } from "./logPrivacy.js";

export function sessionActor(claims) {
  if (!claims) return { actor: "anonymous", actorRole: "anonymous" };
  const kind = claims.oidc ? "oidc" : claims.saml ? "saml" : "password";
  if (kind === "password") return { actor: "password-admin", actorRole: claims.role };
  const email = claims.oidcEmail ?? claims.samlEmail;
  const masked = typeof email === "string" && /^[^@\s]+@[^@\s]+$/.test(email.trim())
    ? email.trim()[0] + "***@***" : "***";
  return { actor: kind + ":" + masked, actorRole: claims.role };
}

// Capture identity before password changes, imports and revocations invalidate the cookie.
export async function auditActor(request) {
  try {
    const { hasValidCliToken } = await import("../../dashboardGuard.js");
    if (request && await hasValidCliToken(request)) return { actor: "cli", actorRole: "admin" };
    const token = request?.cookies?.get("auth_token")?.value;
    if (token) {
      const { getDashboardAuthSession } = await import("../auth/dashboardSession.js");
      return sessionActor(await getDashboardAuthSession(token));
    }
    if (request && (await getSettings()).requireLogin === false)
      return { actor: "open-dashboard", actorRole: "admin" };
  } catch { console.warn("[audit] Could not resolve actor"); }
  return sessionActor(null);
}

// No free-form message, request payload, header dump or setting value enters this API.
export async function audit(request, action, { identity, target = null, fields, count, result = "success" } = {}) {
  try {
    const { actor, actorRole } = identity ?? await auditActor(request);
    const peer = request?.headers && hasTrustedPeerHeaders(request) && request.headers.get("x-9r-socket-ip");
    const detail = fields ? { fields: fields.slice(0, 128).map(k =>
      /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(k) ? redactLogValue(k) : "[REDACTED]") } : {};
    if (action === "key.connections" && Number.isSafeInteger(count) && count >= 0) detail.count = count;
    await insertAuditEntry({ actorRole, actor, action, target: target && redactLogValue(target), result,
      ip: typeof peer === "string" && isIP(peer) ? peer : null, detail });
  } catch { console.warn("[audit] Event could not be recorded:", action); }
}
