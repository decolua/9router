import { Button, Card, Input } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import { OIDC_AUTH_MODE_OPTIONS } from "../utils/profileConstants";
import { ProfileStatus } from "./ProfileStatus";

export function ProfileOidcCard({
  settings,
  loading,
  oidcExpanded,
  setOidcExpanded,
  oidcForm,
  updateOidcForm,
  oidcClientSecret,
  setOidcClientSecret,
  oidcRedirectUri,
  oidcLoading,
  oidcTestLoading,
  oidcStatus,
  oidcTestStatus,
  saveOidcSettings,
  testOidcConnection,
}) {
  return (
    <Card>
      <button
        type="button"
        onClick={() => setOidcExpanded((value) => !value)}
        className="w-full flex items-center gap-3 text-left"
      >
        <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-500 shrink-0">
          <span className="material-symbols-outlined text-[20px]">lock_open</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base sm:text-lg font-semibold">OIDC Dashboard Login</h3>
          <p className="text-xs text-text-muted">
            {settings.authMode === "oidc"
              ? "OIDC active"
              : settings.authMode === "both"
                ? "Password + OIDC active"
                : "Optional SSO via Authentik/Keycloak/Google"}
          </p>
        </div>
        <span className="material-symbols-outlined text-text-muted shrink-0">
          {oidcExpanded ? "expand_less" : "expand_more"}
        </span>
      </button>
      {oidcExpanded && (
        <div className="flex flex-col gap-4 mt-4">
          <p className="text-xs sm:text-sm text-text-muted">
            Use Authentik or any OIDC provider to sign in to the dashboard. You can enable password-only,
            OIDC-only, or both for the dashboard; model API access still uses API keys.
          </p>

          <div className="flex flex-col gap-2">
            <label className="font-medium text-sm sm:text-base">Auth Mode</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {OIDC_AUTH_MODE_OPTIONS.map((option) => {
                const active = oidcForm.authMode === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => updateOidcForm("authMode", option.value)}
                    className={cn(
                      "text-left rounded-lg border p-3 transition-colors",
                      active ? "border-primary bg-primary/5" : "border-border bg-bg hover:bg-black/5 dark:hover:bg-white/5",
                    )}
                    disabled={loading || oidcLoading}
                  >
                    <p className="font-medium text-sm sm:text-base">{option.title}</p>
                    <p className="text-xs sm:text-sm text-text-muted mt-1">{option.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div className="flex flex-col gap-2">
              <label className="font-medium text-sm sm:text-base">Issuer URL</label>
              <Input
                placeholder="https://auth.example.com/application/o/9router/"
                value={oidcForm.oidcIssuerUrl}
                onChange={(e) => updateOidcForm("oidcIssuerUrl", e.target.value)}
                disabled={loading || oidcLoading}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="font-medium text-sm sm:text-base">Client ID</label>
              <Input
                placeholder="9router-dashboard"
                value={oidcForm.oidcClientId}
                onChange={(e) => updateOidcForm("oidcClientId", e.target.value)}
                disabled={loading || oidcLoading}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="font-medium text-sm sm:text-base">Client Secret</label>
              <Input
                type="password"
                placeholder="Leave blank to keep existing secret"
                value={oidcClientSecret}
                onChange={(e) => setOidcClientSecret(e.target.value)}
                disabled={loading || oidcLoading}
              />
              <p className="text-xs sm:text-sm text-text-muted">This value is write-only after saving.</p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="font-medium text-sm sm:text-base">Scopes</label>
              <Input
                placeholder="openid profile email"
                value={oidcForm.oidcScopes}
                onChange={(e) => updateOidcForm("oidcScopes", e.target.value)}
                disabled={loading || oidcLoading}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="font-medium text-sm sm:text-base">Login Button Label</label>
              <Input
                placeholder="Sign in with OIDC"
                value={oidcForm.oidcLoginLabel}
                onChange={(e) => updateOidcForm("oidcLoginLabel", e.target.value)}
                disabled={loading || oidcLoading}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-bg p-3 text-xs sm:text-sm text-text-muted">
            <p className="font-medium text-text-main mb-1">Redirect URI</p>
            <code className="block break-all font-mono">{oidcRedirectUri}</code>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-border/50">
            <Button
              type="button"
              variant="primary"
              loading={oidcLoading}
              onClick={() => saveOidcSettings()}
              className="w-full sm:w-auto"
            >
              Save auth mode
            </Button>
            <Button
              type="button"
              variant="outline"
              loading={oidcTestLoading}
              onClick={testOidcConnection}
              className="w-full sm:w-auto"
            >
              Test connection
            </Button>
          </div>

          <ProfileStatus status={oidcTestStatus} />
          <ProfileStatus status={oidcStatus} />

          {settings.authMode === "oidc" && (
            <p className="text-xs sm:text-sm text-amber-600 dark:text-amber-400">
              OIDC login is currently active. Password login is disabled until you switch back.
            </p>
          )}

          {settings.authMode === "both" && (
            <p className="text-xs sm:text-sm text-amber-600 dark:text-amber-400">
              Password and OIDC login are both active.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
