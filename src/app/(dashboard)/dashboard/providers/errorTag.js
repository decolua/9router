import { getErrorCode } from "@/shared/utils";

export function getConnectionErrorTag(connection) {
  if (!connection) return null;

  const reasonCode = connection.reasonCode;
  const routingStatus = connection.routingStatus;
  const reasonDetail = connection.reasonDetail || "";

  if (reasonCode === "quota_threshold") return "429";
  if (reasonCode === "quota_exhausted") return "429";
  if (reasonCode === "auth_invalid" || reasonCode === "auth_missing") return "AUTH";
  if (reasonCode === "upstream_rate_limited") return "429";
  if (reasonCode === "upstream_unavailable" || reasonCode === "upstream_unhealthy") return "5XX";
  if (reasonCode === "network_error") return "NET";
  if (reasonCode === "runtime_error") return "RUNTIME";

  const normalizedReason = reasonDetail.toLowerCase();
  if (normalizedReason.includes("unauthorized") || normalizedReason.includes("invalid") || normalizedReason.includes("revoked")) return "AUTH";
  if (normalizedReason.includes("quota") || normalizedReason.includes("rate limit")) return "429";
  if (normalizedReason.includes("unavailable") || normalizedReason.includes("unhealthy") || normalizedReason.includes("timeout")) return "5XX";
  if (normalizedReason.includes("runtime") || normalizedReason.includes("not installed")) return "RUNTIME";

  if (routingStatus === "blocked") return "AUTH";
  if (routingStatus === "exhausted") return "429";
  if (routingStatus === "unknown") return "ERR";
  if (routingStatus === "disabled") return null;

  return "ERR";
}
