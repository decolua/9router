import { getConnectionStatusDetails } from "../../../../lib/connectionStatus.js";

export function getDashboardConnectionStatus(connection) {
  const details = getConnectionStatusDetails(connection);
  if (details.source?.startsWith("legacy-")) {
    return "unknown";
  }
  return details.status;
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
