export const CONNECTION_STATUS = Object.freeze({
  ACTIVE: "active",
  SUCCESS: "success",
  ERROR: "error",
  EXPIRED: "expired",
  UNAVAILABLE: "unavailable",
  NEEDS_RELOGIN: "needs_relogin",
});

export function isConnectionErrorStatus(status) {
  return (
    status === CONNECTION_STATUS.ERROR ||
    status === CONNECTION_STATUS.EXPIRED ||
    status === CONNECTION_STATUS.UNAVAILABLE ||
    status === CONNECTION_STATUS.NEEDS_RELOGIN
  );
}
