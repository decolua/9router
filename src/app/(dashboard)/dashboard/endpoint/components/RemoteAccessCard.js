"use client";

import PropTypes from "prop-types";
import { Button, Card, Input, Toggle } from "@/shared/components";
import { EndpointRow } from "./EndpointRow";
import { SecurityWarning } from "./SecurityWarning";
import { Tooltip } from "./Tooltip";

export function RemoteAccessCard({
  currentEndpoint,
  copied,
  requireApiKey,
  tunnelDashboardAccess,
  remoteAccess,
  onCopy,
  onTunnelDashboardAccessChange,
}) {
  const {
    tunnelChecking,
    tunnelEnabled,
    tunnelReachable,
    tunnelUrl,
    tunnelPublicUrl,
    tunnelLoading,
    tunnelProgress,
    tunnelStatus,
    tsEnabled,
    tsReachable,
    tsUrl,
    tsLoading,
    tsProgress,
    tsStatus,
    tsAuthUrl,
    tsAuthLabel,
    tsConnecting,
    tunnelEverReachable,
    tsEverReachable,
    isLoginUnsafe,
    unsafeReason,
    setTunnelChecking,
    setShowDisableTunnelModal,
    setShowDisableTsModal,
    handleOpenTsModal,
    openEnableTunnelModal,
    stopTunnelLoading,
    stopTailscaleLoading,
  } = remoteAccess;

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <span className="material-symbols-outlined text-primary">api</span>
        API Endpoint
      </h2>

      <div className="flex flex-col gap-2">
        <EndpointRow
          label="Local"
          url={currentEndpoint}
          copyId="local_url"
          copied={copied}
          onCopy={onCopy}
        />
        <TunnelEndpointRow
          copied={copied}
          tunnelEnabled={tunnelEnabled}
          tunnelLoading={tunnelLoading}
          tunnelReachable={tunnelReachable}
          tunnelUrl={tunnelUrl}
          tunnelPublicUrl={tunnelPublicUrl}
          tunnelProgress={tunnelProgress}
          tunnelStatus={tunnelStatus}
          tunnelChecking={tunnelChecking}
          tunnelEverReachable={tunnelEverReachable}
          onCopy={onCopy}
          onEnable={openEnableTunnelModal}
          onDisable={() => setShowDisableTunnelModal(true)}
          onStop={stopTunnelLoading}
          onStopChecking={() => setTunnelChecking(false)}
        />
        <TailscaleEndpointRow
          copied={copied}
          tsEnabled={tsEnabled}
          tsLoading={tsLoading}
          tsConnecting={tsConnecting}
          tsReachable={tsReachable}
          tsUrl={tsUrl}
          tsProgress={tsProgress}
          tsStatus={tsStatus}
          tsAuthUrl={tsAuthUrl}
          tsAuthLabel={tsAuthLabel}
          tsEverReachable={tsEverReachable}
          onCopy={onCopy}
          onEnable={handleOpenTsModal}
          onDisable={() => setShowDisableTsModal(true)}
          onStop={stopTailscaleLoading}
        />
      </div>

      {isLoginUnsafe && !tunnelEnabled && !tsEnabled && (
        <div className="mt-4">
          <SecurityWarning
            message={unsafeReason}
            action={{ label: "Open settings", href: "/dashboard/profile" }}
          />
        </div>
      )}

      {(tunnelEnabled || tsEnabled) && (
        <div className="mt-4 flex flex-col gap-2">
          {!requireApiKey && (
            <SecurityWarning
              message="Require API key is disabled — your endpoint is publicly accessible without authentication."
              action={{ label: "Enable", href: "#require-api-key" }}
            />
          )}
          {isLoginUnsafe && (
            <SecurityWarning
              message={
                unsafeReason.includes("Require login")
                  ? "Require login is disabled — anyone can access your dashboard via tunnel."
                  : "Dashboard uses the default password — change it in Profile settings."
              }
              action={{
                label: unsafeReason.includes("Require login")
                  ? "Enable"
                  : "Change password",
                href: "/dashboard/profile",
              }}
            />
          )}
        </div>
      )}

      {(tunnelEnabled || tsEnabled) && (
        <div className="mt-4 pt-4 border-t border-border flex items-center gap-3">
          <Toggle
            checked={tunnelDashboardAccess}
            onChange={() =>
              onTunnelDashboardAccessChange(!tunnelDashboardAccess)
            }
          />
          <div className="flex items-center gap-1.5">
            <p className="font-medium text-sm">
              Allow dashboard access via tunnel
            </p>
            <Tooltip text="When enabled, the dashboard can be accessed through your tunnel or Tailscale URL (login still required). When disabled, dashboard access via tunnel/Tailscale is completely blocked." />
          </div>
        </div>
      )}
    </Card>
  );
}

function StatusLabel({ active, children }) {
  return (
    <span
      className={`text-xs font-mono px-1.5 py-0.5 rounded shrink-0 min-w-[88px] text-center ${
        active ? "bg-primary/10 text-primary" : "bg-surface-2 text-text-muted"
      }`}
    >
      {children}
    </span>
  );
}

function IconButton({ title, className, onClick, icon }) {
  return (
    <button onClick={onClick} className={className} title={title}>
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
    </button>
  );
}

function TunnelEndpointRow({
  copied,
  tunnelEnabled,
  tunnelLoading,
  tunnelReachable,
  tunnelUrl,
  tunnelPublicUrl,
  tunnelProgress,
  tunnelStatus,
  tunnelChecking,
  tunnelEverReachable,
  onCopy,
  onEnable,
  onDisable,
  onStop,
  onStopChecking,
}) {
  return (
    <div className="flex items-center gap-2">
      <StatusLabel active={tunnelEnabled}>Tunnel</StatusLabel>
      {tunnelEnabled && !tunnelLoading && tunnelReachable ? (
        <>
          <Input
            value={`${tunnelPublicUrl || tunnelUrl}/v1`}
            readOnly
            className="flex-1 font-mono text-sm"
          />
          <CopyButton
            copied={copied === "tunnel_url"}
            onClick={() =>
              onCopy(`${tunnelPublicUrl || tunnelUrl}/v1`, "tunnel_url")
            }
          />
          <PowerButton title="Disable Tunnel" onClick={onDisable} />
        </>
      ) : tunnelEnabled && !tunnelLoading && !tunnelReachable ? (
        <>
          <StatusPill tone="warning">
            {tunnelEverReachable
              ? "Tunnel reconnecting..."
              : "Tunnel checking..."}
          </StatusPill>
          <PowerButton title="Disable Tunnel" onClick={onDisable} />
        </>
      ) : tunnelLoading ? (
        <>
          <StatusPill>{tunnelProgress || "Creating tunnel..."}</StatusPill>
          <PowerButton title="Stop" onClick={onStop} />
        </>
      ) : tunnelStatus?.type === "error" ? (
        <>
          <ErrorPill message={tunnelStatus.message} />
          <Button size="sm" icon="cloud_upload" onClick={onEnable}>
            Enable
          </Button>
        </>
      ) : tunnelChecking ? (
        <>
          <StatusPill>Checking...</StatusPill>
          <PowerButton title="Stop" onClick={onStopChecking} />
        </>
      ) : (
        <Button size="sm" icon="cloud_upload" onClick={onEnable}>
          Enable
        </Button>
      )}
    </div>
  );
}

function TailscaleEndpointRow({
  copied,
  tsEnabled,
  tsLoading,
  tsConnecting,
  tsReachable,
  tsUrl,
  tsProgress,
  tsStatus,
  tsAuthUrl,
  tsAuthLabel,
  tsEverReachable,
  onCopy,
  onEnable,
  onDisable,
  onStop,
}) {
  return (
    <div className="flex items-center gap-2">
      <StatusLabel active={tsEnabled}>Tailscale</StatusLabel>
      {tsEnabled && !tsLoading && tsReachable ? (
        <>
          <Input
            value={`${tsUrl}/v1`}
            readOnly
            className="flex-1 font-mono text-sm"
          />
          <CopyButton
            copied={copied === "ts_url"}
            onClick={() => onCopy(`${tsUrl}/v1`, "ts_url")}
          />
          <PowerButton title="Disable Tailscale" onClick={onDisable} />
        </>
      ) : tsEnabled && !tsLoading && !tsReachable ? (
        <>
          <StatusPill tone="warning">
            {tsEverReachable
              ? "Tailscale reconnecting..."
              : "Tailscale checking..."}
          </StatusPill>
          <PowerButton title="Disable Tailscale" onClick={onDisable} />
        </>
      ) : tsLoading || tsConnecting ? (
        <>
          <StatusPill>{tsProgress || "Connecting..."}</StatusPill>
          {tsAuthUrl && (
            <Button
              size="sm"
              icon="open_in_new"
              onClick={() =>
                window.open(
                  tsAuthUrl,
                  "tailscale_auth",
                  "width=600,height=700,noopener,noreferrer",
                )
              }
            >
              {tsAuthLabel || "Open"}
            </Button>
          )}
          <PowerButton title="Stop" onClick={onStop} />
        </>
      ) : tsStatus?.type === "error" ? (
        <>
          <ErrorPill message={tsStatus.message} />
          <Button size="sm" icon="vpn_lock" onClick={onEnable}>
            Enable
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          icon="vpn_lock"
          onClick={onEnable}
          className="bg-linear-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white!"
        >
          Enable
        </Button>
      )}
    </div>
  );
}

function StatusPill({ tone, children }) {
  const className =
    tone === "warning"
      ? "border-amber-300 dark:border-amber-800 bg-amber-500/5 text-amber-600 dark:text-amber-400"
      : "border-border bg-input text-text-muted";
  return (
    <div
      className={`flex-1 flex items-center gap-2 px-3 py-1.5 rounded border text-sm ${className}`}
    >
      <span className="material-symbols-outlined animate-spin text-sm">
        progress_activity
      </span>
      {children}
    </div>
  );
}

function ErrorPill({ message }) {
  return (
    <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-red-300 dark:border-red-800 bg-red-500/5 text-sm text-red-600 dark:text-red-400">
      <span className="material-symbols-outlined text-sm">error</span>
      {message}
    </div>
  );
}

function CopyButton({ copied, onClick }) {
  return (
    <IconButton
      onClick={onClick}
      className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors shrink-0"
      icon={copied ? "check" : "content_copy"}
    />
  );
}

function PowerButton({ title, onClick }) {
  return (
    <IconButton
      title={title}
      onClick={onClick}
      className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
      icon="power_settings_new"
    />
  );
}

RemoteAccessCard.propTypes = {
  currentEndpoint: PropTypes.string.isRequired,
  copied: PropTypes.string,
  requireApiKey: PropTypes.bool.isRequired,
  tunnelDashboardAccess: PropTypes.bool.isRequired,
  remoteAccess: PropTypes.object.isRequired,
  onCopy: PropTypes.func.isRequired,
  onTunnelDashboardAccessChange: PropTypes.func.isRequired,
};

StatusLabel.propTypes = {
  active: PropTypes.bool.isRequired,
  children: PropTypes.node.isRequired,
};

IconButton.propTypes = {
  title: PropTypes.string,
  className: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
  icon: PropTypes.string.isRequired,
};

TunnelEndpointRow.propTypes = {
  copied: PropTypes.string,
  tunnelEnabled: PropTypes.bool.isRequired,
  tunnelLoading: PropTypes.bool.isRequired,
  tunnelReachable: PropTypes.bool.isRequired,
  tunnelUrl: PropTypes.string.isRequired,
  tunnelPublicUrl: PropTypes.string.isRequired,
  tunnelProgress: PropTypes.string.isRequired,
  tunnelStatus: PropTypes.object,
  tunnelChecking: PropTypes.bool.isRequired,
  tunnelEverReachable: PropTypes.bool.isRequired,
  onCopy: PropTypes.func.isRequired,
  onEnable: PropTypes.func.isRequired,
  onDisable: PropTypes.func.isRequired,
  onStop: PropTypes.func.isRequired,
  onStopChecking: PropTypes.func.isRequired,
};

TailscaleEndpointRow.propTypes = {
  copied: PropTypes.string,
  tsEnabled: PropTypes.bool.isRequired,
  tsLoading: PropTypes.bool.isRequired,
  tsConnecting: PropTypes.bool.isRequired,
  tsReachable: PropTypes.bool.isRequired,
  tsUrl: PropTypes.string.isRequired,
  tsProgress: PropTypes.string.isRequired,
  tsStatus: PropTypes.object,
  tsAuthUrl: PropTypes.string.isRequired,
  tsAuthLabel: PropTypes.string.isRequired,
  tsEverReachable: PropTypes.bool.isRequired,
  onCopy: PropTypes.func.isRequired,
  onEnable: PropTypes.func.isRequired,
  onDisable: PropTypes.func.isRequired,
  onStop: PropTypes.func.isRequired,
};

StatusPill.propTypes = {
  tone: PropTypes.string,
  children: PropTypes.node.isRequired,
};

ErrorPill.propTypes = {
  message: PropTypes.string.isRequired,
};

CopyButton.propTypes = {
  copied: PropTypes.bool.isRequired,
  onClick: PropTypes.func.isRequired,
};

PowerButton.propTypes = {
  title: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
};
