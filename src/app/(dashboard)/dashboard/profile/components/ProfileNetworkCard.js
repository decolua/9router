import { Button, Card, Input, Toggle } from "@/shared/components";
import { ProfileStatus } from "./ProfileStatus";

export function ProfileNetworkCard({
  settings,
  loading,
  proxyForm,
  updateProxyForm,
  proxyStatus,
  proxyLoading,
  proxyTestLoading,
  updateOutboundProxyEnabled,
  updateOutboundProxy,
  testOutboundProxy,
}) {
  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500 shrink-0">
          <span className="material-symbols-outlined text-[20px]">wifi</span>
        </div>
        <h3 className="text-base sm:text-lg font-semibold">Network</h3>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-start sm:items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm sm:text-base">Outbound Proxy</p>
            <p className="text-xs sm:text-sm text-text-muted">Enable proxy for OAuth + provider outbound requests.</p>
          </div>
          <Toggle
            checked={settings.outboundProxyEnabled === true}
            onChange={() => updateOutboundProxyEnabled(!(settings.outboundProxyEnabled === true))}
            disabled={loading || proxyLoading}
          />
        </div>

        {settings.outboundProxyEnabled === true && (
          <form onSubmit={updateOutboundProxy} className="flex flex-col gap-4 pt-2 border-t border-border/50">
            <div className="flex flex-col gap-2">
              <label className="font-medium text-sm sm:text-base">Proxy URL</label>
              <Input
                placeholder="http://127.0.0.1:7897"
                value={proxyForm.outboundProxyUrl}
                onChange={(e) => updateProxyForm("outboundProxyUrl", e.target.value)}
                disabled={loading || proxyLoading}
              />
              <p className="text-xs sm:text-sm text-text-muted">Leave empty to inherit existing env proxy (if any).</p>
            </div>

            <div className="flex flex-col gap-2 pt-2 border-t border-border/50">
              <label className="font-medium text-sm sm:text-base">No Proxy</label>
              <Input
                placeholder="localhost,127.0.0.1"
                value={proxyForm.outboundNoProxy}
                onChange={(e) => updateProxyForm("outboundNoProxy", e.target.value)}
                disabled={loading || proxyLoading}
              />
              <p className="text-xs sm:text-sm text-text-muted">Comma-separated hostnames/domains to bypass the proxy.</p>
            </div>

            <div className="flex flex-col gap-2 pt-2 border-t border-border/50">
              <label className="font-medium text-sm sm:text-base">Proxy Timeout (ms)</label>
              <Input
                type="number"
                placeholder="30000"
                value={proxyForm.connectionProxyHeadersTimeoutMs}
                onChange={(e) => updateProxyForm("connectionProxyHeadersTimeoutMs", e.target.value)}
                disabled={loading || proxyLoading}
              />
              <p className="text-xs sm:text-sm text-text-muted">Timeout for connection proxy headers in milliseconds. Default is 30000 (30 seconds).</p>
            </div>

            <div className="pt-2 border-t border-border/50 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                loading={proxyTestLoading}
                disabled={loading || proxyLoading}
                onClick={testOutboundProxy}
                className="w-full sm:w-auto"
              >
                Test proxy URL
              </Button>
              <Button type="submit" variant="primary" loading={proxyLoading} className="w-full sm:w-auto">
                Apply
              </Button>
            </div>
          </form>
        )}

        <ProfileStatus status={proxyStatus} className="pt-2 border-t border-border/50" />
      </div>
    </Card>
  );
}
