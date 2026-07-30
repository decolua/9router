"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/**
 * GcpProjectSelector — Three-mode project selector for Antigravity/Gemini CLI
 *
 * Mode 1: List existing GCP projects (dropdown)
 * Mode 2: Cloud Shell auto-create + polling
 * Mode 3: Manual Project ID input
 */
export default function GcpProjectSelector({ onProjectSelected, onClose }) {
  const [mode, setMode] = useState("loading"); // loading | list | cloudshell | manual
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Cloud Shell state
  const [cloudShellUrl, setCloudShellUrl] = useState("");
  const [cloudShellProjectId, setCloudShellProjectId] = useState("");
  const [polling, setPolling] = useState(false);
  const [pollCountdown, setPollCountdown] = useState(0);
  const pollRef = useRef(null);
  const countdownRef = useRef(null);

  // Manual input state
  const [manualProjectId, setManualProjectId] = useState("");
  const [validating, setValidating] = useState(false);

  // ── Load projects on mount ──────────────────────────────────────
  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/gcp-projects");
      const data = await res.json();
      const list = data.projects || [];
      setProjects(list);
      setMode(list.length > 0 ? "list" : "cloudshell");
    } catch {
      setError("Gagal memuat daftar project.");
      setMode("manual");
    } finally {
      setLoading(false);
    }
  };

  // ── Select existing project ─────────────────────────────────────
  const handleSelectProject = async (projectId) => {
    setValidating(true);
    setError("");
    try {
      const res = await fetch("/api/gcp-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();
      if (data.valid) {
        onProjectSelected(projectId);
      } else {
        setError(data.message || "Project tidak valid.");
      }
    } catch {
      setError("Jaringan error.");
    } finally {
      setValidating(false);
    }
  };

  // ── Cloud Shell: generate URL + start polling ───────────────────
  const handleOpenCloudShell = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/gcp-projects?action=cloud-shell-url");
      const data = await res.json();
      setCloudShellUrl(data.url);
      setCloudShellProjectId(data.projectId);

      // Open Cloud Shell in new tab
      window.open(data.url, "_blank", "noopener,noreferrer");

      // Start polling
      startPolling(data.projectId);
    } catch {
      setError("Gagal membuat URL Cloud Shell.");
    }
  }, []);

  const startPolling = (targetProjectId) => {
    setPolling(true);
    setPollCountdown(60);

    // Countdown timer
    countdownRef.current = setInterval(() => {
      setPollCountdown((prev) => {
        if (prev <= 1) {
          stopPolling();
          setError("Timeout. Project belum terdeteksi. Silakan masukkan ID secara manual.");
          setMode("manual");
          setManualProjectId(targetProjectId);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Poll every 3 seconds
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/gcp-projects?action=check&projectId=${encodeURIComponent(targetProjectId)}`
        );
        const data = await res.json();
        if (data.found) {
          stopPolling();
          // Auto-validate and save
          handleSelectProject(data.projectId);
        }
      } catch {
        // Ignore poll errors, will retry
      }
    }, 3000);
  };

  const stopPolling = () => {
    setPolling(false);
    if (pollRef.current) clearInterval(pollRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    pollRef.current = null;
    countdownRef.current = null;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => stopPolling();
  }, []);

  // ── Manual input submit ─────────────────────────────────────────
  const handleManualSubmit = async () => {
    const id = manualProjectId.trim();
    if (!id) return;
    await handleSelectProject(id);
  };

  // ── Render ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6 text-center">
        <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent mb-3" />
        <p className="text-sm text-gray-500">Mengambil daftar project Google Cloud...</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold">🌐 Google Cloud Project</h3>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">
            ✕
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
          {error}
        </div>
      )}

      {/* ── Mode Tabs ── */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        <button
          onClick={() => setMode("list")}
          className={`flex-1 text-xs py-1.5 rounded-md transition ${
            mode === "list" ? "bg-white shadow font-medium" : "text-gray-500 hover:text-gray-700"
          }`}
          disabled={projects.length === 0}
        >
          📋 Project Saya {projects.length > 0 && `(${projects.length})`}
        </button>
        <button
          onClick={() => { stopPolling(); setMode("cloudshell"); }}
          className={`flex-1 text-xs py-1.5 rounded-md transition ${
            mode === "cloudshell" ? "bg-white shadow font-medium" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          ☁️ Cloud Shell
        </button>
        <button
          onClick={() => { stopPolling(); setMode("manual"); }}
          className={`flex-1 text-xs py-1.5 rounded-md transition ${
            mode === "manual" ? "bg-white shadow font-medium" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          ⌨️ Manual
        </button>
      </div>

      {/* ── Mode: List existing projects ── */}
      {mode === "list" && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">Pilih project yang sudah ada untuk dihubungkan ke 9Router:</p>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {projects.map((p) => (
              <button
                key={p.projectId}
                onClick={() => handleSelectProject(p.projectId)}
                disabled={validating}
                className="w-full text-left p-3 border rounded-lg hover:bg-blue-50 hover:border-blue-300 transition disabled:opacity-50"
              >
                <span className="font-medium text-sm">{p.displayName}</span>
                <span className="text-xs text-gray-400 ml-2">({p.projectId})</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Tidak menemukan project yang diinginkan?{" "}
            <button onClick={() => setMode("cloudshell")} className="text-blue-500 underline">
              Buat baru via Cloud Shell
            </button>{" "}
            atau{" "}
            <button onClick={() => setMode("manual")} className="text-blue-500 underline">
              masukkan ID manual
            </button>
          </p>
        </div>
      )}

      {/* ── Mode: Cloud Shell auto-create ── */}
      {mode === "cloudshell" && (
        <div className="space-y-3">
          {!polling ? (
            <>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-medium text-sm text-blue-800 mb-2">☁️ Buat Project Otomatis via Cloud Shell</h4>
                <p className="text-xs text-blue-700 mb-3">
                  Klik tombol di bawah untuk membuka Google Cloud Shell di tab baru. 
                  Project akan dibuat secara otomatis setelah Anda klik <strong>Authorize</strong> di Cloud Shell.
                  9Router akan mendeteksi project baru secara otomatis.
                </p>
                <button
                  onClick={handleOpenCloudShell}
                  className="w-full bg-blue-600 text-white py-2.5 px-4 rounded-lg hover:bg-blue-700 transition font-medium text-sm flex items-center justify-center gap-2"
                >
                  <span>☁️</span> Buka Google Cloud Shell
                </button>
              </div>
              <p className="text-xs text-gray-400 text-center">
                Ini adalah layanan resmi Google. Anda harus menyetujui Terms of Service di Cloud Shell.
              </p>
            </>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
              <div className="inline-block animate-spin rounded-full h-5 w-5 border-2 border-green-500 border-t-transparent mb-2" />
              <p className="text-sm text-green-700 font-medium">Menunggu project dibuat di Cloud Shell...</p>
              <p className="text-xs text-green-600 mt-1">
                Target: <code className="bg-green-100 px-1 rounded">{cloudShellProjectId}</code>
              </p>
              <p className="text-xs text-gray-500 mt-2">
                Timeout dalam <span className="font-mono font-bold">{pollCountdown}s</span>
              </p>
              <button
                onClick={() => {
                  stopPolling();
                  setMode("manual");
                  setManualProjectId(cloudShellProjectId);
                }}
                className="mt-3 text-xs text-gray-500 underline hover:text-gray-700"
              >
                Batalkan dan masukkan ID manual
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Mode: Manual input ── */}
      {mode === "manual" && (
        <div className="space-y-3">
          <div className="bg-gray-50 border rounded-lg p-4">
            <h4 className="font-medium text-sm mb-2">⌨️ Masukkan Project ID</h4>
            <ol className="list-decimal ml-5 space-y-1 text-xs text-gray-600 mb-3">
              <li>
                Buka{" "}
                <a
                  href="https://console.cloud.google.com/projectcreate"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 underline"
                >
                  Google Cloud Console
                </a>{" "}
                di tab baru
              </li>
              <li>Buat project baru (gratis), setujui ToS jika diminta</li>
              <li>
                Salin <strong>Project ID</strong> (contoh: <code className="bg-gray-200 px-1 rounded text-xs">my-project-123456</code>)
              </li>
              <li>Tempel di bawah ini:</li>
            </ol>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualProjectId}
                onChange={(e) => setManualProjectId(e.target.value)}
                placeholder="contoh: my-project-123456"
                className="border rounded-lg px-3 py-2 text-sm flex-grow focus:outline-none focus:ring-2 focus:ring-blue-300"
                disabled={validating}
                onKeyDown={(e) => e.key === "Enter" && handleManualSubmit()}
              />
              <button
                onClick={handleManualSubmit}
                disabled={validating || !manualProjectId.trim()}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition text-sm font-medium whitespace-nowrap"
              >
                {validating ? "⏳ Validasi..." : "✓ Hubungkan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {validating && (
        <div className="text-center text-xs text-blue-500">
          <span className="inline-block animate-pulse">Memvalidasi project...</span>
        </div>
      )}
    </div>
  );
}
