import { DEFAULT_OIDC_FORM } from "./profileConstants";

export function getOidcFormFromSettings(data = {}, fallback = DEFAULT_OIDC_FORM) {
  return {
    authMode: data?.authMode || fallback.authMode,
    oidcIssuerUrl: data?.oidcIssuerUrl || fallback.oidcIssuerUrl,
    oidcClientId: data?.oidcClientId || fallback.oidcClientId,
    oidcScopes: data?.oidcScopes || fallback.oidcScopes,
    oidcLoginLabel: data?.oidcLoginLabel || fallback.oidcLoginLabel,
  };
}

export function getOidcRedirectUri() {
  if (typeof window === "undefined") {
    return "/api/auth/oidc/callback";
  }

  return `${window.location.origin}/api/auth/oidc/callback`;
}
