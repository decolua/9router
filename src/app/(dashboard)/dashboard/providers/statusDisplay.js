import { getConnectionStatusDetails } from "../../../../lib/connectionStatus.js";

export function getDashboardConnectionStatus(connection) {
  return getConnectionStatusDetails(connection).status;
}

export function getConnectionStatusReasonLabel(connection = {}, statusDetails = getConnectionStatusDetails(connection)) {
  let baseReason = "status unavailable";

  if (connection.isActive === false) {
    baseReason = "manually disabled";
  } else if (connection.authState && ["expired", "invalid", "revoked"].includes(connection.authState)) {
    baseReason = `auth: ${connection.authState}`;
  } else if (connection.healthStatus && ["error", "failed", "unhealthy", "down"].includes(connection.healthStatus)) {
    baseReason = `health: ${connection.healthStatus}`;
  } else if (connection.quotaState && ["exhausted", "blocked"].includes(connection.quotaState)) {
    baseReason = `quota: ${connection.quotaState}`;
  } else if (connection.routingStatus && ["eligible", "exhausted", "blocked", "unknown", "disabled"].includes(connection.routingStatus)) {
    baseReason = `routing: ${connection.routingStatus}`;
  } else if (connection.reasonCode) {
    baseReason = connection.reasonCode.replaceAll("_", " ");
  } else if (connection.reasonDetail) {
    baseReason = connection.reasonDetail;
  }

  if (statusDetails.status === "exhausted" && statusDetails.cooldownUntil) {
    return `${baseReason} · retry ${new Date(statusDetails.cooldownUntil).toLocaleTimeString()}`;
  }

  return baseReason;
}

export function getConnectionStatusPresentation(connection = {}) {
  const statusDetails = getConnectionStatusDetails(connection);

  const badge = (() => {
    switch (statusDetails.status) {
      case "eligible":
        return { status: "eligible", label: "Eligible", variant: "success" };
      case "exhausted":
        return { status: "exhausted", label: "Exhausted", variant: "warning" };
      case "blocked":
        return { status: "blocked", label: "Blocked", variant: "error" };
      case "disabled":
        return { status: "disabled", label: "Disabled", variant: "default" };
      default:
        return { status: "unknown", label: "Unknown", variant: "default" };
    }
  })();

  return {
    statusDetails,
    badge,
    reasonLabel: getConnectionStatusReasonLabel(connection, statusDetails),
  };
}

export function getStatusDisplayItems(connected, error, total, errorCode) {
  const items = [];
  if (connected > 0) {
    items.push({ key: "connected", variant: "success", dot: true, label: `${connected} Connected` });
  }
  if (error > 0) {
    items.push({
      key: "error",
      variant: "error",
      dot: true,
      label: errorCode ? `${error} Error (${errorCode})` : `${error} Error`,
    });
  }
  if (total > 0 && connected === 0 && error === 0) {
    items.push({ key: "saved", variant: "default", dot: false, label: `${total} Saved` });
  }
  return items;
}
