export const severity = Object.freeze({
  "key.quota.80": "warning", "key.quota.100": "critical", "key.expiring": "warning",
  "provider.unavailable": "critical", "provider.needs_reauth": "critical",
  "errors.high": "critical", "health.failed": "critical", "disk.critical": "critical", "backup.failed": "critical",
});
export const EVENT_TYPES = Object.keys(severity);
export const eventLabels = {
  "key.quota.80": "Key quota at 80%", "key.quota.100": "Key quota exhausted", "key.expiring": "Key expires within 72 hours",
  "provider.unavailable": "Provider unavailable for 15 minutes", "provider.needs_reauth": "Provider sign-in required",
  "errors.high": "High request error rate", "health.failed": "Gateway health check failed",
  "disk.critical": "Data disk at 90%", "backup.failed": "Backup failed",
};
