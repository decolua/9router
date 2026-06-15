import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();

export function runWithUserId(userId, fn) {
  return storage.run({ userId: userId || null }, fn);
}

export function getRuntimeUserId() {
  return storage.getStore()?.userId ?? null;
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
    return storage.run({ userId: user.id }, () => handler(request, routeContext, user));
  };
}

export function withAdminUser(handler) {
  return async (request, routeContext) => {
    const { requireAdminUser } = await import("./requestContext.js");
    const { user, error } = await requireAdminUser(request);
    if (error) return error;
    return storage.run({ userId: user.id }, () => handler(request, routeContext, user));
  };
}
