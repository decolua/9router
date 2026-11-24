import { AsyncLocalStorage } from "node:async_hooks";
import { audit, auditActor } from "./audit.js";

// Scope user-initiated connection changes (including OAuth callbacks/imports).
// Health probes and background token refreshes must not masquerade as admin edits.
const context = new AsyncLocalStorage();
export const withProviderAudit = handler => (request, ...args) =>
  context.run({ request }, () => handler(request, ...args));

export async function auditConnection(action, target) {
  const ctx = context.getStore();
  if (!ctx) return;
  ctx.identity ??= auditActor(ctx.request);
  await audit(ctx.request, "provider." + action, { identity: await ctx.identity, target });
}
