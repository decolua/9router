import { AsyncLocalStorage } from "node:async_hooks";



const storage = new AsyncLocalStorage();



export function runWithUserId(userId, fn) {

  const prev = storage.getStore() || {};

  return storage.run({ ...prev, userId: userId || null }, fn);

}



export function runWithOrgId(orgId, fn) {

  const prev = storage.getStore() || {};

  return storage.run({ ...prev, orgId: orgId || null }, fn);

}



export function runWithContext({ userId, orgId }, fn) {

  return storage.run({ userId: userId || null, orgId: orgId || null }, fn);

}



export function getRuntimeUserId() {

  return storage.getStore()?.userId ?? null;

}



export function getRuntimeOrgId() {

  return storage.getStore()?.orgId ?? null;

}



export async function resolveScopedUserId(explicitUserId) {

  if (explicitUserId) return explicitUserId;

  return getRuntimeUserId();

}



/** Wrap Next.js route handlers with authenticated user context. */

export function withAuthUser(handler) {

  return async (request, routeContext) => {

    const { requireRequestUser } = await import("./requestContext.js");

    const { user, error } = await requireRequestUser(request);

    if (error) return error;

    return runWithContext({ userId: user.id, orgId: user.orgId }, () => handler(request, routeContext, user));

  };

}



export function withAdminUser(handler) {

  return async (request, routeContext) => {

    const { requireAdminUser } = await import("./requestContext.js");

    const { user, error } = await requireAdminUser(request);

    if (error) return error;

    return runWithContext({ userId: user.id, orgId: user.orgId }, () => handler(request, routeContext, user));

  };

}



/** Authenticated usage routes: members see own data; admins may pass ?scope=all for org-wide. */

export function withUsageUser(handler) {

  return async (request, routeContext) => {

    const { requireRequestUser } = await import("./requestContext.js");

    const { resolveUsageFilterUserId } = await import("./usageScope.js");

    const { user, error } = await requireRequestUser(request);

    if (error) return error;

    const { searchParams } = new URL(request.url);

    const filterUserId = resolveUsageFilterUserId(user, searchParams.get("scope"));

    const usageScope = { filterUserId, isOrgWide: filterUserId === null };

    return runWithContext({ userId: user.id, orgId: user.orgId }, () => handler(request, routeContext, user, usageScope));

  };

}

