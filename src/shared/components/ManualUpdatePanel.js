import PropTypes from "prop-types";
import Button from "./Button";

/**
 * `latestVersion` arrives already tagged: updateCheck reads the changelog
 * heading, so it is "v0.5.165" (or "git-abc1234" when the changelog has no
 * release yet). Prefixing another "v" here printed "vv0.5.165" in the banner.
 * Strip at most one leading "v" so the text reads exactly once, and leave a
 * tagless value alone rather than half-mangling it.
 */
function versionLabel(version) {
  if (typeof version !== "string" || !version) return "";
  return version.startsWith("v") ? version : `v${version}`;
}

/**
 * Full-screen panel shown after "Update now": copies the install command,
 * counts down, then shuts the server down so the operator can paste the
 * command into a terminal.
 */
export default function ManualUpdatePanel({ latestVersion, installCmd, copied, onCopyAndShutdown, onCancel, countdown, isDisconnected }) {
  const isCountingDown = countdown > 0;
  return (
    <div className="w-full max-w-lg rounded-xl bg-surface border border-border p-6 text-text-main">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center justify-center size-11 rounded-full bg-amber-500/20 text-amber-400">
          <span className="material-symbols-outlined text-[24px]">content_copy</span>
        </div>
        <div>
          <h2 className="text-lg font-semibold">Update 9Router{latestVersion ? ` to ${versionLabel(latestVersion)}` : ""}</h2>
          <p className="text-xs text-text-muted">
            {isDisconnected
              ? "Server stopped. Paste the command into a terminal to install."
              : isCountingDown
                ? `Command copied. Server will stop in ${countdown}s...`
                : "Click the button below to copy the install command and shutdown."}
          </p>
        </div>
      </div>

      <p className="text-sm text-text-muted mb-2">Install command:</p>
      <div className="w-full px-3 py-2 rounded bg-surface-2 mb-4">
        <code className="text-xs font-mono text-amber-400 break-all">{installCmd}</code>
      </div>

      <ol className="text-xs text-text-muted space-y-1 list-decimal list-inside mb-4">
        <li>Click <strong>Copy & Shutdown</strong> below.</li>
        <li>Paste the command into your terminal and press Enter.</li>
        <li>Run <code className="px-1 rounded bg-surface-3 text-success">9router</code> again after install.</li>
      </ol>

      {isDisconnected ? (
        <Button variant="secondary" fullWidth onClick={() => globalThis.location.reload()}>
          Reload Page
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={isCountingDown}>
            Cancel
          </Button>
          <Button variant="primary" fullWidth onClick={onCopyAndShutdown} disabled={isCountingDown}>
            {copied ? "Copied. Shutting down..." : isCountingDown ? `Shutting down in ${countdown}s` : "Copy & Shutdown"}
          </Button>
        </div>
      )}
    </div>
  );
}

ManualUpdatePanel.propTypes = {
  latestVersion: PropTypes.string,
  installCmd: PropTypes.string.isRequired,
  copied: PropTypes.bool,
  onCopyAndShutdown: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  countdown: PropTypes.number,
  isDisconnected: PropTypes.bool,
};
