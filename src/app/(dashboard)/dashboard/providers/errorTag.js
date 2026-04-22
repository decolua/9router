import { getErrorCode } from "@/shared/utils";

export function getConnectionErrorTag(connection) {
  if (!connection) return null;

  const reasonCode = connection.reasonCode;
  const routingStatus = connection.routingStatus;
  const explicitType = connection.lastErrorType;

  if (
    reasonCode === "auth_invalid"
    || reasonCode === "auth_missing"
    || reasonCode === "token_refresh_failed"
    || reasonCode === "token_expired"
    || reasonCode === "upstream_auth_error"
  )
    return "AUTH";
  if (reasonCode === "quota_exhausted" || reasonCode === "upstream_rate_limited")
    return "429";
  if (reasonCode === "upstream_unhealthy" || reasonCode === "upstream_unavailable")
    return "5XX";
  if (reasonCode === "network_error") return "NET";
  if (reasonCode === "runtime_error") return "RUNTIME";

  if (routingStatus === "blocked_auth") return "AUTH";
  if (routingStatus === "exhausted" || routingStatus === "blocked_quota" || routingStatus === "cooldown") return "429";
  if (routingStatus === "blocked_health") return "5XX";

  if (explicitType === "runtime_error") return "RUNTIME";
  if (
    explicitType === "upstream_auth_error"
    || explicitType === "auth_invalid"
    || explicitType === "auth_missing"
    || explicitType === "token_refresh_failed"
    || explicitType === "token_expired"
  )
    return "AUTH";
  if (explicitType === "upstream_rate_limited") return "429";
  if (explicitType === "upstream_unavailable") return "5XX";
  if (explicitType === "network_error") return "NET";

  const numericCode = Number(connection.errorCode);
  if (Number.isFinite(numericCode) && numericCode >= 400)
    return String(numericCode);

  const fromMessage = getErrorCode(connection.lastError);
  if (fromMessage === "401" || fromMessage === "403") return "AUTH";
  if (fromMessage && fromMessage !== "ERR") return fromMessage;

  const msg = (connection.lastError || "").toLowerCase();
  if (
    msg.includes("runtime")
    || msg.includes("not runnable")
    || msg.includes("not installed")
  )
    return "RUNTIME";
  if (
    msg.includes("invalid api key")
    || msg.includes("token invalid")
    || msg.includes("revoked")
    || msg.includes("unauthorized")
  )
    return "AUTH";

  return "ERR";
}
