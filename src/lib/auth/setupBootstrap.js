// Startup glue: mint + print a setup token when the instance is unclaimed.
import { getAuthBootstrapState } from "@/lib/auth/setupState";
import {
  issueSetupToken,
  clearSetupToken,
  printSetupBanner,
  hasMintedThisProcess,
} from "@/lib/auth/setupToken";

// Mints at most one token per process. A restart replaces a stale/expired token
// from an earlier run; nothing within a run can refresh the expiry window or
// invalidate a token another code path (e.g. the CLI password reset) just
// printed to the operator.
export async function ensureSetupToken({ reason = "first run" } = {}) {
  let state;
  try {
    state = await getAuthBootstrapState();
  } catch {
    return null;
  }

  if (state !== "setup") {
    // Stale token from an earlier unclaimed boot — nothing left to claim.
    clearSetupToken();
    if (state === "legacy") {
      console.warn(
        "[Auth] This install is still on the old default dashboard password. " +
        "You will be required to set a new one at next login."
      );
    }
    return null;
  }

  if (hasMintedThisProcess()) return null;

  const token = issueSetupToken();
  printSetupBanner(token, { reason });
  return token;
}
