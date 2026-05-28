"use client";

import PropTypes from "prop-types";
import { Button, Modal } from "@/shared/components";
import { TUNNEL_BENEFITS } from "../utils/endpointConstants";
import { StatusAlert } from "./StatusAlert";

export function RemoteAccessModals({ remoteAccess, tsLogRef }) {
  const {
    showEnableTunnelModal,
    showDisableTunnelModal,
    tunnelLoading,
    showTsModal,
    showDisableTsModal,
    tsLoading,
    tsStatus,
    tsInstalled,
    tsInstalling,
    tsInstallLog,
    handleEnableTunnel,
    handleDisableTunnel,
    handleInstallTailscale,
    handleConnectTailscale,
    handleDisableTailscale,
    setShowEnableTunnelModal,
    setShowDisableTunnelModal,
    setShowTsModal,
    setShowDisableTsModal,
    closeTsModal,
  } = remoteAccess;

  return (
    <>
      <Modal
        isOpen={showEnableTunnelModal}
        title="Enable Tunnel"
        onClose={() => setShowEnableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="bg-surface-2 border border-border-subtle rounded-lg p-4">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-primary">
                cloud_upload
              </span>
              <div>
                <p className="text-sm text-text-main font-medium mb-1">
                  Cloudflare Tunnel
                </p>
                <p className="text-sm text-text-muted">
                  Expose your local 9Router to the internet. No port forwarding,
                  no static IP needed. Share endpoint URL with your team or use
                  it in Cursor, Cline, and other AI tools from anywhere.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {TUNNEL_BENEFITS.map((benefit) => (
              <div
                key={benefit.title}
                className="flex flex-col items-center text-center p-3 rounded-lg bg-sidebar/50"
              >
                <span className="material-symbols-outlined text-xl text-primary mb-1">
                  {benefit.icon}
                </span>
                <p className="text-xs font-semibold">{benefit.title}</p>
                <p className="text-xs text-text-muted">{benefit.desc}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-text-muted">
            Requires outbound port 7844 (TCP/UDP). Connection may take 10-30s.
          </p>

          <div className="flex gap-2">
            <Button onClick={handleEnableTunnel} fullWidth>
              Start Tunnel
            </Button>
            <Button
              onClick={() => setShowEnableTunnelModal(false)}
              variant="ghost"
              fullWidth
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showDisableTunnelModal}
        title="Disable Tunnel"
        onClose={() => !tunnelLoading && setShowDisableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">
            The Cloudflare tunnel will be disconnected. Remote access via tunnel
            URL will stop working.
          </p>
          <div className="flex gap-2">
            <Button
              onClick={handleDisableTunnel}
              fullWidth
              disabled={tunnelLoading}
              variant="danger"
            >
              {tunnelLoading ? "Disabling..." : "Disable"}
            </Button>
            <Button
              onClick={() => setShowDisableTunnelModal(false)}
              variant="ghost"
              fullWidth
              disabled={tunnelLoading}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showTsModal}
        title="Tailscale Funnel"
        onClose={closeTsModal}
      >
        <div className="flex flex-col gap-4">
          {tsInstalled === null && (
            <p className="text-sm text-text-muted flex items-center gap-2">
              <span className="material-symbols-outlined animate-spin text-sm">
                progress_activity
              </span>
              Checking...
            </p>
          )}

          {tsInstalled === false && !tsInstalling && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-muted">
                Tailscale is not installed. Install it to enable Funnel.
              </p>
              <div className="flex gap-2">
                <Button onClick={handleInstallTailscale} fullWidth>
                  Install Tailscale
                </Button>
                <Button
                  onClick={() => setShowTsModal(false)}
                  variant="ghost"
                  fullWidth
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {tsInstalling && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <span className="material-symbols-outlined animate-spin text-sm">
                  progress_activity
                </span>
                Installing Tailscale...
              </div>
              {tsInstallLog.length > 0 && (
                <div
                  ref={tsLogRef}
                  className="bg-black/5 dark:bg-white/5 rounded p-2 max-h-40 overflow-y-auto font-mono text-xs text-text-muted"
                >
                  {tsInstallLog.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tsInstalled === true && !tsInstalling && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <span className="material-symbols-outlined text-[16px]">
                  check_circle
                </span>
                Tailscale installed
              </div>
              <div className="flex gap-2">
                <Button onClick={() => handleConnectTailscale()} fullWidth>
                  Connect
                </Button>
                <Button
                  onClick={() => setShowTsModal(false)}
                  variant="ghost"
                  fullWidth
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {tsStatus && <StatusAlert status={tsStatus} />}
        </div>
      </Modal>

      <Modal
        isOpen={showDisableTsModal}
        title="Disable Tailscale"
        onClose={() => !tsLoading && setShowDisableTsModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">
            Tailscale Funnel will be stopped. Remote access via Tailscale URL
            will stop working.
          </p>
          <div className="flex gap-2">
            <Button
              onClick={handleDisableTailscale}
              fullWidth
              disabled={tsLoading}
              variant="danger"
            >
              {tsLoading ? "Disabling..." : "Disable"}
            </Button>
            <Button
              onClick={() => setShowDisableTsModal(false)}
              variant="ghost"
              fullWidth
              disabled={tsLoading}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

RemoteAccessModals.propTypes = {
  remoteAccess: PropTypes.object.isRequired,
  tsLogRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
};
