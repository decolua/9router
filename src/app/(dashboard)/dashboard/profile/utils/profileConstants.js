export const EMPTY_STATUS = { type: "", message: "" };

export const DEFAULT_OIDC_FORM = {
  authMode: "password",
  oidcIssuerUrl: "",
  oidcClientId: "",
  oidcScopes: "openid profile email",
  oidcLoginLabel: "Sign in with OIDC",
};

export const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: "light_mode" },
  { value: "dark", label: "Dark", icon: "dark_mode" },
  { value: "system", label: "System", icon: "contrast" },
];

export const OIDC_AUTH_MODE_OPTIONS = [
  {
    value: "password",
    title: "Password only",
    desc: "Keep the legacy password login.",
  },
  {
    value: "oidc",
    title: "OIDC only",
    desc: "Require OIDC for dashboard access.",
  },
  {
    value: "both",
    title: "Both",
    desc: "Allow either password or OIDC.",
  },
];
