import { getClientIp } from "@/lib/auth/loginLimiter.js";
import { recordAuditEvent } from "@/lib/db/repos/auditLogRepo.js";

export const AuditAction = {
  LOGIN_SUCCESS: "auth.login.success",
  LOGIN_FAILURE: "auth.login.failure",
  LOGOUT: "auth.logout",
  USER_CREATED: "user.created",
  USER_STATUS_CHANGED: "user.status_changed",
  USER_DELETED: "user.deleted",
  INVITE_CREATED: "user.invite_created",
  API_KEY_CREATED: "api_key.created",
  SETTINGS_CHANGED: "settings.changed",
  PASSWORD_CHANGED: "auth.password_changed",
};

export async function auditFromRequest(request, event) {
  return recordAuditEvent({
    ip: getClientIp(request),
    ...event,
  });
}
