import { getRuntimeOrgId } from "../../auth/runtimeUserContext.js";
import { getDefaultOrgId } from "../repos/organizationsRepo.js";

/** Resolve org id from explicit value, AsyncLocalStorage, or default (on-prem). */
export async function resolveOrgId(explicitOrgId = null) {
  if (explicitOrgId) return explicitOrgId;
  const runtime = getRuntimeOrgId();
  if (runtime) return runtime;
  return getDefaultOrgId();
}

/** Sync variant — use when already inside a transaction or ALS is set. */
export function resolveOrgIdSync(explicitOrgId = null) {
  if (explicitOrgId) return explicitOrgId;
  return getRuntimeOrgId() || null;
}

export function pushOrgFilter(conds, params, orgId) {
  if (orgId) {
    conds.push("orgId = ?");
    params.push(orgId);
  }
}

export function pushUserFilter(conds, params, userId) {
  if (userId) {
    conds.push("userId = ?");
    params.push(userId);
  }
}

/** Build WHERE fragments for tenant tables (always org; optional user). */
export async function tenantFilters({ orgId, userId } = {}) {
  const resolvedOrg = await resolveOrgId(orgId);
  const conds = [];
  const params = [];
  pushOrgFilter(conds, params, resolvedOrg);
  pushUserFilter(conds, params, userId);
  return { conds, params, orgId: resolvedOrg };
}

export function tenantFiltersSync({ orgId, userId } = {}) {
  const resolvedOrg = resolveOrgIdSync(orgId);
  const conds = [];
  const params = [];
  pushOrgFilter(conds, params, resolvedOrg);
  pushUserFilter(conds, params, userId);
  return { conds, params, orgId: resolvedOrg };
}

export function userKvScope(scope, userId, orgId) {
  if (orgId) return `${scope}:org:${orgId}:user:${userId}`;
  return `${scope}:user:${userId}`;
}
