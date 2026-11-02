import { isOidcConfigured } from "@/lib/auth/oidc";
import { isSamlConfigured } from "@/lib/auth/saml.js";

// SSO-only dashboard login: authMode sso/oidc/saml with the matching provider fully
// configured. Returns "saml" | "oidc" while enforced, null otherwise. An incomplete
// provider leaves non-SSO login open for recovery, matching the password route.
// Shared by every non-SSO sign-in route (password, passkey) so the rule cannot drift.
export function getEnforcedSsoType(settings) {
  const authMode = settings?.authMode;
  if (authMode !== "sso" && authMode !== "saml" && authMode !== "oidc") return null;
  const ssoType = settings.ssoType || (authMode === "saml" ? "saml" : "oidc");
  if (ssoType === "saml" && isSamlConfigured(settings)) return "saml";
  if (ssoType === "oidc" && isOidcConfigured(settings)) return "oidc";
  return null;
}
