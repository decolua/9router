"use client"

import { useState, useEffect } from "react"
import PropTypes from "prop-types"
import { Modal, Button, Input } from "@/shared/components"

/**
 * Cursor Auth Modal
 *
 * Two import modes:
 *   - "ide":    auto-detect tokens from Cursor IDE's local SQLite. No refresh
 *               path — relies on Cursor IDE keeping the row fresh.
 *   - "apikey": exchange a long-lived Cursor user API key (`key_...`) for a
 *               JWT. 9router can then auto-refresh on 401/403 by re-calling
 *               /auth/exchange_user_api_key. Recommended for headless /
 *               multi-account service deployments.
 */
export default function CursorAuthModal({ isOpen, onSuccess, onClose }) {
  const [mode, setMode] = useState("ide") // "ide" | "apikey"

  // IDE mode state
  const [accessToken, setAccessToken] = useState("")
  const [machineId, setMachineId] = useState("")
  const [autoDetecting, setAutoDetecting] = useState(false)
  const [autoDetected, setAutoDetected] = useState(false)
  const [windowsManual, setWindowsManual] = useState(false)

  // API key mode state
  const [apiKey, setApiKey] = useState("")
  const [apiKeyLabel, setApiKeyLabel] = useState("")

  // Shared state
  const [error, setError] = useState(null)
  const [importing, setImporting] = useState(false)

  const runAutoDetect = async () => {
    setAutoDetecting(true)
    setError(null)
    setAutoDetected(false)
    setWindowsManual(false)

    try {
      const res = await fetch("/api/oauth/cursor/auto-import")
      const data = await res.json()

      if (data.found) {
        setAccessToken(data.accessToken)
        setMachineId(data.machineId)
        setAutoDetected(true)
      } else if (data.windowsManual) {
        setWindowsManual(true)
      } else {
        setError(data.error || "Could not auto-detect tokens")
      }
    } catch (err) {
      setError("Failed to auto-detect tokens")
    } finally {
      setAutoDetecting(false)
    }
  }

  // Auto-detect tokens when modal opens (only in IDE mode)
  useEffect(() => {
    if (!isOpen) return
    if (mode !== "ide") return
    runAutoDetect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode])

  const handleImportApiKey = async () => {
    if (!apiKey.trim()) {
      setError("Please enter a Cursor API key")
      return
    }
    if (!apiKey.trim().startsWith("crsr_")) {
      setError("Cursor API key must start with 'crsr_'")
      return
    }

    setImporting(true)
    setError(null)

    try {
      const res = await fetch("/api/oauth/cursor/import-apikey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          label: apiKeyLabel.trim() || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Import failed")

      onSuccess?.()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setImporting(false)
    }
  }

  const handleImportToken = async () => {
    if (!accessToken.trim()) {
      setError("Please enter an access token")
      return
    }

    if (!machineId.trim()) {
      setError("Please enter a machine ID")
      return
    }

    setImporting(true)
    setError(null)

    try {
      const res = await fetch("/api/oauth/cursor/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: accessToken.trim(),
          machineId: machineId.trim(),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Import failed")
      }

      onSuccess?.()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setImporting(false)
    }
  }

  const tabBtn = (key, label) => (
    <button
      type="button"
      onClick={() => { setMode(key); setError(null) }}
      className={`flex-1 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${mode === key
        ? "border-primary text-primary"
        : "border-transparent text-text-muted hover:text-text"
        }`}
    >
      {label}
    </button>
  )

  return (
    <Modal isOpen={isOpen} title="Connect Cursor" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {/* Mode tabs */}
        <div className="flex border-b border-border -mt-2">
          {tabBtn("ide", "From Cursor IDE")}
          {tabBtn("apikey", "From API Key")}
        </div>

        {/* API key mode */}
        {mode === "apikey" && (
          <div className="flex flex-col gap-3">
            <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                Paste a long-lived Cursor user API key (<code className="font-mono">crsr_...</code>).
                9router will exchange it for a JWT and auto-refresh on expiry —
                no Cursor IDE required.
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                Get one at <span className="font-mono">cursor.com → Settings → Integrations → API Keys</span>.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Cursor API Key <span className="text-red-500">*</span>
              </label>
              <textarea
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="crsr_..."
                rows={3}
                className="w-full px-3 py-2 text-sm font-mono border border-border rounded-lg bg-background focus:outline-none focus:border-primary resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Label (optional)
              </label>
              <Input
                value={apiKeyLabel}
                onChange={(e) => setApiKeyLabel(e.target.value)}
                placeholder="e.g. account-1@example.com"
                className="text-sm"
              />
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={handleImportApiKey}
                fullWidth
                disabled={importing || !apiKey.trim()}
              >
                {importing ? "Importing..." : "Exchange & Import"}
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* IDE mode — original auto-detect flow */}
        {mode === "ide" && autoDetecting && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary animate-spin">
                progress_activity
              </span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Auto-detecting tokens...</h3>
            <p className="text-sm text-text-muted">
              Reading from Cursor IDE database
            </p>
          </div>
        )}

        {/* Form (shown after auto-detect completes) */}
        {mode === "ide" && !autoDetecting && (
          <>
            {/* Success message if auto-detected */}
            {autoDetected && (
              <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg border border-green-200 dark:border-green-800">
                <div className="flex gap-2">
                  <span className="material-symbols-outlined text-green-600 dark:text-green-400">check_circle</span>
                  <p className="text-sm text-green-800 dark:text-green-200">
                    Tokens auto-detected from Cursor IDE successfully!
                  </p>
                </div>
              </div>
            )}

            {/* Windows manual instructions */}
            {windowsManual && (
              <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800 flex flex-col gap-2">
                <div className="flex gap-2 items-center">
                  <span className="material-symbols-outlined text-amber-600 dark:text-amber-400">info</span>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    Could not read Cursor database automatically.
                  </p>
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Make sure Cursor IDE has been opened at least once, then click <strong>Retry</strong>. If the problem persists, paste your tokens manually below.
                </p>
                <Button onClick={runAutoDetect} variant="outline" fullWidth>
                  Retry
                </Button>
              </div>
            )}

            {/* Info message if not auto-detected */}
            {!autoDetected && !windowsManual && !error && (
              <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="flex gap-2">
                  <span className="material-symbols-outlined text-blue-600 dark:text-blue-400">info</span>
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    Cursor IDE not detected. Please paste your tokens manually.
                  </p>
                </div>
              </div>
            )}

            {/* Access Token Input */}
            <div>
              <label className="block text-sm font-medium mb-2">
                Access Token <span className="text-red-500">*</span>
              </label>
              <textarea
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="Access token will be auto-filled..."
                rows={3}
                className="w-full px-3 py-2 text-sm font-mono border border-border rounded-lg bg-background focus:outline-none focus:border-primary resize-none"
              />
            </div>

            {/* Machine ID Input */}
            <div>
              <label className="block text-sm font-medium mb-2">
                Machine ID <span className="text-red-500">*</span>
              </label>
              <Input
                value={machineId}
                onChange={(e) => setMachineId(e.target.value)}
                placeholder="Machine ID will be auto-filled..."
                className="font-mono text-sm"
              />
            </div>

            {/* Error Display */}
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button
                onClick={handleImportToken}
                fullWidth
                disabled={importing || !accessToken.trim() || !machineId.trim()}
              >
                {importing ? "Importing..." : "Import Token"}
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

CursorAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
}
