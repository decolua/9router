"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button, Badge, Toggle, Loading } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

export default function AutomationDashboard() {
  const [activeTab, setActiveTab] = useState("codebuddy"); // codebuddy | ammail

  const tabBtn = (id, icon, label) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`flex items-center gap-2 pb-3 text-sm font-semibold transition-all border-b-2 cursor-pointer ${
        activeTab === id
          ? "border-primary text-primary"
          : "border-transparent text-text-muted hover:text-text-main"
      }`}
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
      {label}
    </button>
  );

  return (
    <div className="space-y-6">
      {/* Tab Switcher */}
      <div className="flex border-b border-border-subtle pb-px gap-6 flex-wrap">
        {tabBtn("codebuddy", "smart_toy", "Automation")}
        {tabBtn("ammail", "mail", "Ammail Temp Mail")}
      </div>

      {activeTab === "codebuddy" && <CodeBuddyTab />}
      {activeTab === "ammail" && <AmmailTab />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 1. CODEBUDDY COMPONENT
// ─────────────────────────────────────────────────────────────────────

function CodeBuddyTab() {
  const providerNames = {
    cloudflare: "Cloudflare Workers AI",
  };

  const [accounts, setAccounts] = useState([]);
  const [activeJobId, setActiveJobId] = useState("");
  const [activeJob, setActiveJob] = useState(null);
  const [jobLogs, setJobLogs] = useState([]);
  const clearedEmails = useRef(new Set());
  const logTerminalRef = useRef(null);
  const [logPage, setLogPage] = useState(1);
  const prevRunningIdx = useRef(-1);
  const logsPerPage = 10;
  const logsDismissed = useRef(false);
  const [mounted, setMounted] = useState(false);
  const [concurrency, setConcurrency] = useState(3);
  const [auto9Router, setAuto9Router] = useState(false);
  const [runNow, setRunNow] = useState(false);
  const [addGoogleText, setAddGoogleText] = useState("");
  const [addGoogleStatus, setAddGoogleStatus] = useState("");
  const [targetProvider, setTargetProvider] = useState("cloudflare");
  
  // Settings
  const [browserHeadless, setBrowserHeadless] = useState(true);
  const [debugMode, setDebugMode] = useState(false);
  const [leaveCanvaTeam, setLeaveCanvaTeam] = useState(false);
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyPool, setProxyPool] = useState([]);
  const [proxyModalOpen, setProxyModalOpen] = useState(false);
  const [proxyModalText, setProxyModalText] = useState("");
  const [leonardoInviteLink, setLeonardoInviteLink] = useState("");
  const [codebuddy2CaptchaApiKey, setCodebuddy2CaptchaApiKey] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [openSettings, setOpenSettings] = useState({
    general: true,
    proxy: false,
  });

  const toggleSection = (section) => {
    setOpenSettings((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const renderSectionHeader = (title, icon, isOpen, onToggle) => (
    <button
      onClick={onToggle}
      type="button"
      className="flex items-center gap-1.5 hover:text-primary text-text-main font-semibold text-xs transition-all cursor-pointer select-none py-1"
    >
      <span className={`material-symbols-outlined text-[16px] text-text-muted transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`}>
        expand_more
      </span>
      <span>{title}</span>
    </button>
  );

  const [vncReady, setVncReady] = useState(false);
  const [debugScreenshotTs, setDebugScreenshotTs] = useState(0);
  const [proxyTestResults, setProxyTestResults] = useState({});
  const [testingProxies, setTestingProxies] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Detailed logs modal state
  const [detailedLogAccount, setDetailedLogAccount] = useState(null);
  const [detailedLogContent, setDetailedLogContent] = useState("");
  const [detailedLogLoading, setDetailedLogLoading] = useState(false);

  useEffect(() => {
    if (!detailedLogAccount) {
      setDetailedLogContent("");
      return;
    }

    let active = true;
    let timerId = null;

    async function fetchLogs() {
      if (!detailedLogAccount) return;
      try {
        const res = await fetch(`/api/automation/codebuddy/${detailedLogAccount.id}`);
        const data = await res.json();
        if (active && data.logs) {
          setDetailedLogContent(data.logs);
        }
      } catch (err) {
        console.error("Error fetching logs:", err);
      }
    }

    setDetailedLogLoading(true);
    fetchLogs().finally(() => {
      if (active) setDetailedLogLoading(false);
    });

    timerId = setInterval(fetchLogs, 3000);

    return () => {
      active = false;
      if (timerId) clearInterval(timerId);
    };
  }, [detailedLogAccount]);

  const openDetailedLogs = (id, email) => {
    setDetailedLogAccount({ id, email });
  };

  useEffect(() => {
    if (logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight;
    }
  }, [detailedLogContent]);

  const [autoGenerateEmail, setAutoGenerateEmail] = useState(false);
  const [generateCount, setGenerateCount] = useState(5);
  const [ammailDomains, setAmmailDomains] = useState([]);
  const [selectedAmmailDomain, setSelectedAmmailDomain] = useState("");

  // Load from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedProvider = localStorage.getItem("automation_target_provider");
      if (savedProvider && savedProvider === "cloudflare") {
        setTargetProvider(savedProvider);
      } else {
        setTargetProvider("cloudflare");
      }

      const savedConcurrency = localStorage.getItem("automation_concurrency");
      if (savedConcurrency) setConcurrency(parseInt(savedConcurrency) || 3);

      const savedAutoEmail = localStorage.getItem("automation_auto_email");
      if (savedAutoEmail) setAutoGenerateEmail(savedAutoEmail === "1");

      const savedGenerateCount = localStorage.getItem("automation_generate_count");
      if (savedGenerateCount) setGenerateCount(parseInt(savedGenerateCount) || 5);

      const savedOpenSettings = localStorage.getItem("automation_open_settings");
      if (savedOpenSettings) {
        try {
          setOpenSettings((prev) => ({ ...prev, ...JSON.parse(savedOpenSettings) }));
        } catch (e) {
          console.error("Failed to parse saved automation open settings", e);
        }
      }

      setMounted(true);
    }
  }, []);

  // Persist selections to localStorage
  useEffect(() => { if (mounted) localStorage.setItem("automation_target_provider", targetProvider); }, [targetProvider, mounted]);
  useEffect(() => { if (mounted) localStorage.setItem("automation_concurrency", String(concurrency)); }, [concurrency, mounted]);
  useEffect(() => { if (mounted) localStorage.setItem("automation_auto_email", autoGenerateEmail ? "1" : "0"); }, [autoGenerateEmail, mounted]);
  useEffect(() => { if (mounted) localStorage.setItem("automation_generate_count", String(generateCount)); }, [generateCount, mounted]);
  useEffect(() => { if (mounted) localStorage.setItem("automation_open_settings", JSON.stringify(openSettings)); }, [openSettings, mounted]);

  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  // Fetch available Ammail domains
  useEffect(() => {
    fetch("/api/automation/ammail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list-domains" })
    })
      .then(r => r.json())
      .then(d => {
        if (d.domains?.length) {
          setAmmailDomains(d.domains);
          setSelectedAmmailDomain(prev => prev || d.default_domain || d.domains[0]);
        }
      })
      .catch(() => {});
  }, []);

  const loadState = async (includeSettings = false) => {
    try {
      const res = await fetch("/api/automation/codebuddy");
      const data = await res.json();
      if (res.ok) {
        setAccounts(data.accounts || []);
        setActiveJobId(data.active_job_id || "");

        // If a new active job started, reset dismissed flag
        if (data.active_job_id && logsDismissed.current) {
          logsDismissed.current = false;
          clearedEmails.current.clear();
        }

        // Skip restoring job/logs if user dismissed them
        if (!logsDismissed.current) {
          setActiveJob(data.active_job || null);
          // Build log entries from active job results
          if (data.active_job?.results?.length) {
            const logs = data.active_job.results
              .filter(r => r)
              .map((r, i) => ({
                idx: i,
                email: r.email || `Account #${i + 1}`,
                status: r.status || "pending",
                step: r.status === "failed" ? (r.error || r.step || "-") : (r.step || "-"),
                ok: r.ok,
              }))
              .filter(log => !clearedEmails.current.has(log.email.toLowerCase()));
            setJobLogs(logs);
          }
        }
        // Only update settings on initial load, not during polling
        if (includeSettings) {
          const s = data.settings || {};
          setAuto9Router(s.auto_9router === "1" || s.auto_9router === true);
          setBrowserHeadless(!!s.browser_headless);
          setDebugMode(!!s.debug_mode);
          setLeaveCanvaTeam(s.leave_canva_team === "1" || s.leave_canva_team === true);
          setProxyEnabled(!!s.proxy_enabled);
          try {
            const pool = JSON.parse(s.proxy_pool || "[]");
            setProxyPool(Array.isArray(pool) ? pool : []);
          } catch { setProxyPool([]); }
          setLeonardoInviteLink(s.leonardo_invite_link || "");
          setCodebuddy2CaptchaApiKey(s.codebuddy_2captcha_api_key || "");
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (mounted) {
      loadState(true);
    }
  }, [mounted]);

  // Poll accounts dynamically: 3s if automation job is running, 15s if idle
  useEffect(() => {
    if (!mounted) return;
    const delay = activeJobId ? 3000 : 15000;
    const interval = setInterval(() => loadState(false), delay);
    return () => clearInterval(interval);
  }, [mounted, activeJobId]);

  // Auto-focus the page of the running/processed account
  useEffect(() => {
    if (jobLogs.length === 0) {
      setLogPage(1);
      prevRunningIdx.current = -1;
      return;
    }
    const runningIdx = jobLogs.findIndex(log => log.status === "running");
    if (runningIdx !== -1 && runningIdx !== prevRunningIdx.current) {
      prevRunningIdx.current = runningIdx;
      const runningPage = Math.floor(runningIdx / logsPerPage) + 1;
      setLogPage(runningPage);
    }
  }, [jobLogs]);

  // Debug screenshot lifecycle
  useEffect(() => {
    if (debugMode && activeJobId) {
      const check = setInterval(() => {
        fetch("/api/automation/codebuddy/debug-vnc?action=status")
          .then(r => r.json())
          .then(data => {
            if (data.available) {
              setVncReady(true);
              setDebugScreenshotTs(Date.now());
              clearInterval(check);
            }
          })
          .catch(() => {});
      }, 2000);
      return () => clearInterval(check);
    } else if (!activeJobId && vncReady) {
      const timer = setTimeout(() => {
        setVncReady(false);
        setDebugScreenshotTs(0);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [debugMode, activeJobId]);

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      const res = await fetch("/api/automation/codebuddy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "settings",
          auto_9router: auto9Router,
          browser_headless: browserHeadless,
          debug_mode: debugMode,
          leave_canva_team: leaveCanvaTeam,
          proxy_enabled: proxyEnabled,
          proxy_pool: JSON.stringify(proxyPool),
          leonardo_invite_link: leonardoInviteLink,
          codebuddy_2captcha_api_key: codebuddy2CaptchaApiKey
        })
      });
      if (res.ok) {
        setAddGoogleStatus("Settings saved successfully.");
        setTimeout(() => setAddGoogleStatus(""), 3000);
        await loadState(true);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddGoogle = async () => {
    if (!addGoogleText.trim()) {
      setAddGoogleStatus("Please enter at least one email:password line.");
      return;
    }
    setAddGoogleStatus("Adding accounts...");
    try {
      const res = await fetch("/api/automation/codebuddy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add-google",
          accounts_text: addGoogleText,
          run_now: runNow,
          concurrency,
          provider: targetProvider
        })
      });
      const data = await res.json();
      if (res.ok) {
        setAddGoogleText("");
        setAddGoogleStatus(
          `Created: ${data.created?.length || 0}, Skipped: ${data.skipped?.length || 0}${
            data.job_id ? " (Job started)" : ""
          }`
        );
        loadState();
      } else {
        setAddGoogleStatus(`Error: ${data.error}`);
      }
    } catch (e) {
      setAddGoogleStatus(`Failed: ${e.message}`);
    }
  };

  const handleAutoGenerateEmail = async () => {
    setAddGoogleStatus("Generating emails...");
    try {
      const res = await fetch("/api/automation/codebuddy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "auto-generate-email",
          count: generateCount,
          provider: targetProvider,
          run_now: true,
          concurrency,
          domain: selectedAmmailDomain || undefined
        })
      });
      const data = await res.json();
      if (res.ok) {
        setAddGoogleStatus(`✓ Generated ${data.created?.length || 0} temp mail accounts and started signup job.`);
        loadState();
      } else {
        setAddGoogleStatus(`Error: ${data.error || "Failed to generate emails"}`);
      }
    } catch (e) {
      console.error(e);
      setAddGoogleStatus("Failed to contact server.");
    }
  };

  const handleRunAll = async () => {
    try {
      const res = await fetch("/api/automation/codebuddy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run-all", concurrency, provider: targetProvider })
      });
      const data = await res.json();
      if (res.ok) {
        clearedEmails.current.clear();
        setActiveJobId(data.job_id);
        loadState();
      } else {
        setAddGoogleStatus(`Failed: ${data.error}`);
      }
    } catch (e) {
      setAddGoogleStatus(`Failed: ${e.message}`);
    }
  };

  const handleStopJob = async () => {
    try {
      const res = await fetch("/api/automation/codebuddy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" })
      });
      if (res.ok) {
        loadState();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSingleRun = async (id) => {
    try {
      const res = await fetch(`/api/automation/codebuddy/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run" })
      });
      const data = await res.json();
      if (res.ok) {
        clearedEmails.current.clear();
        setActiveJobId(data.job_id);
        loadState();
      } else {
        alert(data.error);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSingleAddTo9Router = async (id) => {
    try {
      const res = await fetch(`/api/automation/codebuddy/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add-to-9router" })
      });
      const data = await res.json();
      if (res.ok) {
        alert(`✓ ${data.message || "Added successfully!"}`);
        loadState();
      } else {
        alert(`Failed: ${data.error}`);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleBulkAddTo9Router = async () => {
    if (!confirm(`Inject all Ready Cloudflare Workers AI accounts into 9router?`)) return;
    try {
      const res = await fetch("/api/automation/codebuddy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bulk-add-to-9router", provider: targetProvider })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        loadState();
      } else {
        alert(`Failed: ${data.error}`);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSingleDelete = async (id) => {
    if (!confirm("Hapus akun ini?")) return;
    const deleteFrom9router = confirm("Apakah ingin menghapus juga koneksi akun ini di 9router?");
    const deletedAcc = accounts.find(a => a.id === id);
    try {
      await fetch(`/api/automation/codebuddy/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", deleteFrom9router })
      });
      if (deletedAcc) {
        clearedEmails.current.add(deletedAcc.email.toLowerCase());
        setJobLogs(prev => prev.filter(log => log.email.toLowerCase() !== deletedAcc.email.toLowerCase()));
      }
      loadState();
    } catch (e) {
      console.error(e);
    }
  };

  const handleBulkDelete = async (statuses, ids = null) => {
    const label = ids ? `${ids.length} selected accounts` : `all accounts with status: ${statuses.join(", ")}`;
    if (!confirm(`Delete ${label}?`)) return;
    const deleteFrom9router = confirm("Apakah ingin menghapus juga koneksi akun-akun tersebut di 9router?");
    const deletedEmailsList = accounts
      .filter(a => ids ? ids.includes(a.id) : (a.provider === targetProvider && statuses.includes(a.api_key_status)))
      .map(a => a.email.toLowerCase());
    try {
      const res = await fetch("/api/automation/codebuddy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids
          ? { action: "bulk-delete-ids", ids, provider: targetProvider, deleteFrom9router }
          : { action: "bulk-delete", statuses, provider: targetProvider, deleteFrom9router })
      });
      if (res.ok) {
        deletedEmailsList.forEach(e => clearedEmails.current.add(e));
        setJobLogs(prev => prev.filter(log => !deletedEmailsList.includes(log.email.toLowerCase())));
        setSelectedIds(new Set());
        loadState();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const filteredAccounts = accounts.filter(
    (a) =>
      (a.provider === targetProvider) &&
      (a.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
       (a.api_key && a.api_key.toLowerCase().includes(searchQuery.toLowerCase())))
  );

  const totalPages = Math.ceil(filteredAccounts.length / itemsPerPage);
  const displayedAccounts = filteredAccounts.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalLogPages = Math.ceil(jobLogs.length / logsPerPage) || 1;
  const activeLogPage = Math.min(logPage, totalLogPages);
  const currentPageRows = jobLogs.slice(
    (activeLogPage - 1) * logsPerPage,
    activeLogPage * logsPerPage
  );

  return (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Config & Add Form */}
        <div className="lg:col-span-1 space-y-6">
          <Card padding="md" className="space-y-4 bg-sidebar/40 border border-border/40">
            <h2 className="text-sm font-bold text-text-main flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">person_add</span>
              {autoGenerateEmail ? "Generate Temp Accounts" : "Add Accounts"}
            </h2>
          
            <div className="flex flex-col gap-1.5 pb-1">
              <label className="text-xs font-semibold text-text-main">Target Provider Connection</label>
              <div className="flex items-center gap-2">
                <select
                  value={targetProvider}
                  onChange={(e) => {
                    const val = e.target.value;
                    setTargetProvider(val);
                    setCurrentPage(1);
                  }}
                  className="flex-1 text-xs p-2 rounded-lg border border-border-subtle bg-surface text-text-main focus:outline-none focus:border-primary cursor-pointer"
                >
                  <option value="cloudflare">☁️ Cloudflare Workers AI</option>
                </select>
              </div>
            </div>

            <div className="pt-1 border-t border-border-subtle">
              <label className="flex items-center gap-2 text-xs text-text-main cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoGenerateEmail}
                  onChange={(e) => setAutoGenerateEmail(e.target.checked)}
                  className="rounded border-border-subtle accent-primary size-4"
                />
                Auto Generate Email (Ammail)
              </label>
            </div>

            {autoGenerateEmail ? (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-text-muted">Count to generate:</span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={generateCount}
                    onChange={(e) => setGenerateCount(parseInt(e.target.value) || 1)}
                    className="w-16 text-xs p-1.5 rounded-lg border border-border-subtle bg-surface text-center text-text-main"
                  />
                </div>
                {ammailDomains.length >= 1 && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-text-muted">Email domain:</span>
                    <select
                      value={selectedAmmailDomain}
                      onChange={(e) => setSelectedAmmailDomain(e.target.value)}
                      className="flex-1 text-xs p-1.5 rounded-lg border border-border-subtle bg-surface text-text-main ml-2 max-w-[180px]"
                    >
                      {ammailDomains.map(d => (
                        <option key={d} value={d}>@{d}</option>
                      ))}
                    </select>
                  </div>
                )}
                <Button variant="primary" size="sm" fullWidth onClick={handleAutoGenerateEmail}>
                  Generate & Run
                </Button>
              </div>
            ) : (
              <div className="space-y-4 pt-1">
                <p className="text-xs text-text-muted">
                  Format: <code className="bg-surface-2 px-1 rounded">email:password</code> (one per line).
                </p>
                <textarea
                  value={addGoogleText}
                  onChange={(e) => setAddGoogleText(e.target.value)}
                  rows={4}
                  placeholder="user1@smpit-nfbogor.sch.id:TernakAkun123&#10;user2@smpit-nfbogor.sch.id:TernakAkun123"
                  className="w-full text-xs font-mono p-3 rounded-lg border border-border-subtle bg-surface focus:outline-none focus:border-primary resize-y text-text-main"
                />
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <label className="flex items-center gap-2 text-xs text-text-main cursor-pointer">
                    <input
                      type="checkbox"
                      checked={runNow}
                      onChange={(e) => setRunNow(e.target.checked)}
                      className="rounded border-border-subtle accent-primary size-4"
                    />
                    Run immediately
                  </label>
                  <Button variant="primary" size="sm" onClick={handleAddGoogle}>
                    Add Accounts
                  </Button>
                </div>
              </div>
            )}
            {addGoogleStatus && <p className="text-[11px] text-primary italic">{addGoogleStatus}</p>}
          </Card>

          <Card padding="md" className="space-y-4 bg-sidebar/40 border border-border/40">
            <h2 className="text-sm font-bold text-text-main flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">settings</span>
              Automation Settings
            </h2>
            <div className="space-y-4">
              <div className="space-y-2">
                {renderSectionHeader("General Settings", "dns", openSettings.general, () => toggleSection("general"))}
                {openSettings.general && (
                  <div className="pl-6 pr-2 py-2 space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex flex-col">
                        <span className="text-xs font-medium text-text-main">Headless Browser</span>
                        <span className="text-[10px] text-text-muted">Jalankan di latar belakang tanpa membuka jendela baru</span>
                      </div>
                      <Toggle checked={browserHeadless} onChange={setBrowserHeadless} />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex flex-col">
                        <span className="text-xs font-medium text-text-main">Tampilkan Preview Panel</span>
                        <span className="text-[10px] text-text-muted">Aktifkan live stream visual di bawah</span>
                      </div>
                      <Toggle checked={debugMode} onChange={setDebugMode} />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-xs font-medium text-text-main">Auto Inject to 9router</span>
                      <Toggle checked={auto9Router} onChange={setAuto9Router} />
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                {renderSectionHeader("Outbound Proxy Settings", "vpn_lock", openSettings.proxy, () => toggleSection("proxy"))}
                {openSettings.proxy && (
                  <div className="pl-6 pr-2 py-2 space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-xs font-medium text-text-main">Enable Outbound Proxy</span>
                      <Toggle checked={proxyEnabled} onChange={setProxyEnabled} />
                    </div>
                    {proxyEnabled && (
                      <div className="space-y-2 pt-1 border-t border-border-subtle">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-text-muted">
                            {proxyPool.length} {proxyPool.length === 1 ? 'proxy' : 'proxies'} configured
                          </span>
                          <div className="flex items-center gap-1.5">
                            {proxyPool.length > 0 && (
                              <button
                                onClick={async () => {
                                  if (testingProxies) return;
                                  setTestingProxies(true);
                                  const results = {};
                                  for (const p of proxyPool) {
                                    results[p] = { testing: true };
                                    setProxyTestResults({ ...results });
                                    try {
                                      const res = await fetch("/api/automation/codebuddy/test-proxy", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ proxy: p }),
                                      });
                                      const data = await res.json();
                                      results[p] = data;
                                    } catch {
                                      results[p] = { ok: false, error: "Request failed" };
                                    }
                                    setProxyTestResults({ ...results });
                                  }
                                  setTestingProxies(false);
                                }}
                                disabled={testingProxies}
                                className={`text-[11px] px-3 py-1 rounded-lg border font-medium transition-colors ${
                                  testingProxies
                                    ? "bg-surface-2 border-border-subtle text-text-muted cursor-wait"
                                    : "bg-surface-2 border-border-subtle hover:border-green-500 text-green-400 hover:text-green-300"
                                }`}
                              >
                                {testingProxies ? "⏳ Testing..." : "🧪 Test"}
                              </button>
                            )}
                            <button
                              onClick={() => { setProxyModalText(proxyPool.join('\n')); setProxyModalOpen(true); }}
                              className="text-[11px] px-3 py-1 rounded-lg bg-surface-2 border border-border-subtle hover:border-primary text-primary font-medium transition-colors"
                            >
                              ✏️ Edit
                            </button>
                          </div>
                        </div>
                        {proxyPool.length > 0 && (
                          <div className="text-[10px] bg-surface-2 rounded-lg p-2 max-h-[120px] overflow-y-auto font-mono space-y-1">
                            {proxyPool.map((p, i) => {
                              const result = proxyTestResults[p];
                              const masked = p.replace(/:[^:@]*@/, ':***@');
                              return (
                                <div key={i} className="flex items-center justify-between gap-2">
                                  <span className="truncate text-text-muted flex-1" title={masked}>{masked}</span>
                                  {result && (
                                    <span className={`shrink-0 whitespace-nowrap ${result.testing ? 'text-yellow-400' : result.ok ? 'text-green-400' : 'text-red-400'}`}>
                                      {result.testing ? '⏳' : result.ok ? `✅ ${result.ip} · ${result.latency}ms` : `❌ ${result.error}`}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <Button variant="secondary" size="sm" fullWidth onClick={handleSaveSettings} disabled={savingSettings}>
                {savingSettings ? "Saving..." : "Save Settings"}
              </Button>
            </div>
          </Card>
        </div>

        {/* Main accounts manager */}
        <div className="lg:col-span-2 space-y-6">
          {(activeJobId || jobLogs.length > 0) && (
            <div className="border border-border-subtle bg-surface-2 rounded-xl p-4 space-y-3 relative overflow-hidden">
              {activeJob && (
                <div className="absolute top-0 left-0 h-1 bg-gradient-to-r from-primary to-green-500 transition-all duration-500" style={{ width: `${activeJob.progress || 0}%` }} />
              )}
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  {activeJobId ? (
                    <span className="material-symbols-outlined text-[18px] text-primary animate-spin">autorenew</span>
                  ) : activeJob?.status === "stopped" ? (
                    <span className="material-symbols-outlined text-[18px] text-red-400">cancel</span>
                  ) : (
                    <span className="material-symbols-outlined text-[18px] text-green-400">check_circle</span>
                  )}
                  <div>
                    <h3 className="text-sm font-semibold text-text-main">
                      {activeJobId ? "Job Running" : (activeJob?.status === "stopped" ? "Job Stopped" : "Job Completed")}
                    </h3>
                    {activeJob && (
                      <p className="text-[11px] text-text-muted mt-0.5">
                        Progress: {activeJob.completed}/{activeJob.count} · 
                        <span className="text-green-400 ml-1">✓ {activeJob.success}</span>
                        <span className="text-red-400 ml-1">✗ {activeJob.failed}</span>
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  {!activeJobId && jobLogs.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={async () => {
                      logsDismissed.current = true;
                      jobLogs.forEach(log => clearedEmails.current.add(log.email.toLowerCase()));
                      setJobLogs([]);
                      setActiveJob(null);
                      try {
                        await fetch("/api/automation/codebuddy", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "clear-logs" })
                        });
                      } catch (e) {}
                    }}>
                      Clear
                    </Button>
                  )}
                  {activeJobId && (
                    <Button variant="danger" size="sm" onClick={handleStopJob}>
                      ■ Stop
                    </Button>
                  )}
                </div>
              </div>

              {/* Log entries */}
              <div className="max-h-96 overflow-y-auto rounded-lg bg-black/40 border border-border/40 text-[11px] font-mono">
                <table className="w-full">
                  <thead className="sticky top-0 bg-black/80 backdrop-blur-sm">
                    <tr className="text-text-muted text-left">
                      <th className="px-2 py-1 w-6">#</th>
                      <th className="px-2 py-1">Email</th>
                      <th className="px-2 py-1 w-16">Status</th>
                      <th className="px-2 py-1">Step</th>
                      <th className="px-2 py-1 w-14 text-right">Time</th>
                      <th className="px-2 py-1 w-12 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobLogs.length === 0 ? (
                      <tr><td colSpan={6} className="px-2 py-2 text-center text-text-muted">Waiting for log entries...</td></tr>
                    ) : (
                      currentPageRows.map((log, i) => {
                        const timeMatch = log.step?.match(/\[([^\]]+s)\]$/);
                        const displayStep = timeMatch ? log.step.replace(timeMatch[0], "").trim() : log.step;
                        const timeStr = timeMatch ? timeMatch[1] : "--";
                        
                        return (
                          <tr key={i} className={`border-t border-border/20 ${
                            log.status === "failed" ? "bg-red-500/5" : log.status === "done" ? "bg-green-500/5" : ""
                          }`}>
                            <td className="px-2 py-1 text-text-muted">{log.idx + 1}</td>
                            <td className="px-2 py-1 text-text-main truncate max-w-[160px]" title={log.email}>{log.email}</td>
                            <td className="px-2 py-1 whitespace-nowrap">
                              {log.status === "running" && <span className="text-blue-400">● run</span>}
                              {log.status === "done" && <span className="text-green-400">✓ ok</span>}
                              {log.status === "failed" && <span className="text-red-400">✗ fail</span>}
                              {log.status === "pending" && <span className="text-text-muted">◌</span>}
                            </td>
                            <td className="px-2 py-1 text-text-muted truncate max-w-[280px]" title={log.step}>
                              {log.status === "done" ? (
                                <span className="text-green-400 font-medium">Success</span>
                              ) : (
                                displayStep
                              )}
                            </td>
                            <td className="px-2 py-1 text-right text-[10px] text-text-muted font-mono">{timeStr}</td>
                            <td className="px-2 py-1 text-right whitespace-nowrap space-x-1">
                              <button
                                onClick={() => {
                                  const acc = accounts.find(a => a.email.toLowerCase() === log.email.toLowerCase());
                                  if (acc) {
                                    openDetailedLogs(acc.id, acc.email);
                                  } else {
                                    alert("Account tidak ditemukan.");
                                  }
                                }}
                                className="text-[9px] font-bold px-1.5 py-0.5 rounded cursor-pointer transition-colors text-text-main hover:bg-surface-3 bg-surface-2"
                              >
                                Logs
                              </button>
                              {log.status === "failed" && (
                                <button
                                  onClick={() => {
                                    const acc = accounts.find(a => a.email.toLowerCase() === log.email.toLowerCase());
                                    if (acc) {
                                      handleSingleRun(acc.id);
                                    } else {
                                      alert("Account tidak ditemukan.");
                                    }
                                  }}
                                  disabled={!!activeJobId}
                                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                                    !!activeJobId
                                      ? "text-text-muted bg-surface-3 cursor-not-allowed opacity-50"
                                      : "text-brand-400 hover:text-brand-300 hover:bg-brand-500/15 bg-brand-500/5"
                                  }`}
                                >
                                  Retry
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              
              {totalLogPages > 1 && (
                <div className="flex items-center justify-between gap-4 pt-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setLogPage((p) => Math.max(1, p - 1))}
                    disabled={activeLogPage === 1}
                  >
                    Previous
                  </Button>
                  <span className="text-xs text-text-muted">
                    Page {activeLogPage} of {totalLogPages} · ({jobLogs.length} items)
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setLogPage((p) => Math.min(totalLogPages, p + 1))}
                    disabled={activeLogPage === totalLogPages}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <h2 className="text-sm font-bold text-text-main flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">group</span>
                Accounts
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">{accounts.filter(a => a.provider === targetProvider).length} total</span>
                <Badge variant="success" size="sm">
                  {accounts.filter(a => a.provider === targetProvider && a.api_key_status === "ready").length} ready
                </Badge>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <input
                type="text"
                placeholder="Search email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="text-xs p-2 rounded-lg border border-border-subtle bg-surface focus:outline-none focus:border-primary w-48 text-text-main"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-xs text-text-main flex items-center gap-1">
                  Limit:
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={concurrency}
                    onChange={(e) => setConcurrency(parseInt(e.target.value) || 3)}
                    className="w-12 text-center p-1 rounded border border-border-subtle bg-surface text-text-main"
                  />
                </label>
                <Button variant="primary" size="sm" onClick={handleRunAll} disabled={!!activeJobId}>
                  Run All Pending
                </Button>
                <Button variant="secondary" size="sm" onClick={handleBulkAddTo9Router}>
                  ⚡ Add All Ready → 9router
                </Button>
                <Button variant="danger" size="sm" onClick={() => handleBulkDelete(["pending", "failed"])}>
                  🗑 Delete Pending/Failed
                </Button>
              </div>
            </div>

            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 text-xs">
                <span className="text-primary font-semibold">{selectedIds.size} selected</span>
                <span className="text-text-muted">·</span>
                <button
                  onClick={async () => {
                    const ids = [...selectedIds];
                    setSelectedIds(new Set());
                    await Promise.all(ids.map(id => handleSingleRun(id)));
                  }}
                  disabled={!!activeJobId}
                  className="text-brand-400 hover:text-brand-300 font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                >▶ Run Selected</button>
                <span className="text-text-muted">·</span>
                <button
                  onClick={() => handleBulkDelete(null, [...selectedIds])}
                  className="text-red-400 hover:text-red-300 font-semibold"
                >🗑 Delete Selected</button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="ml-auto text-text-muted hover:text-text-main"
                >✕ Clear</button>
              </div>
            )}

            <div className="rounded-xl border border-border-subtle bg-surface-2 overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse min-w-[500px]">
                <thead>
                  <tr className="bg-surface text-text-muted border-b border-border-subtle font-semibold">
                    <th className="p-2.5 w-8">
                      <input
                        type="checkbox"
                        className="rounded cursor-pointer accent-primary"
                        checked={displayedAccounts.length > 0 && displayedAccounts.every(a => selectedIds.has(a.id))}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedIds(prev => new Set([...prev, ...displayedAccounts.map(a => a.id)]));
                          } else {
                            setSelectedIds(prev => {
                              const next = new Set(prev);
                              displayedAccounts.forEach(a => next.delete(a.id));
                              return next;
                            });
                          }
                        }}
                      />
                    </th>
                    <th className="p-2.5 w-10">#</th>
                    <th className="p-2.5">Email</th>
                    <th className="p-2.5 w-24">Status</th>
                    <th className="p-2.5">API Key</th>
                    <th className="p-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedAccounts.map((a) => (
                    <tr key={a.id} className={`border-b border-border-subtle transition-colors ${selectedIds.has(a.id) ? "bg-primary/5" : "hover:bg-surface/50"}`}>
                      <td className="p-2.5">
                        <input
                          type="checkbox"
                          className="rounded cursor-pointer accent-primary"
                          checked={selectedIds.has(a.id)}
                          onChange={(e) => {
                            setSelectedIds(prev => {
                              const next = new Set(prev);
                              e.target.checked ? next.add(a.id) : next.delete(a.id);
                              return next;
                            });
                          }}
                        />
                      </td>
                      <td className="p-2.5 font-mono text-text-muted">#{a.id}</td>
                      <td className="p-2.5 font-semibold text-text-main truncate max-w-[200px]" title={a.email}>{a.email}</td>
                      <td className="p-2.5">
                        <Badge
                          variant={
                            a.api_key_status === "ready"
                              ? "success"
                              : a.api_key_status === "failed"
                              ? "danger"
                              : a.api_key_status === "running"
                              ? "primary"
                              : "default"
                          }
                          size="sm"
                        >
                          {a.api_key_status}
                        </Badge>
                        {a.last_error && (
                          <p className="text-[10px] text-red-500 mt-0.5 truncate max-w-[150px]" title={a.last_error}>
                            ⚠ {a.last_error}
                          </p>
                        )}
                      </td>
                      <td className="p-2.5">
                        {a.api_key ? (
                          <code className="bg-surface px-1.5 py-0.5 rounded font-mono text-[10px] text-text-main max-w-[140px] block truncate" title={a.api_key}>
                            {a.api_key}
                          </code>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                      <td className="p-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-3">
                          <button
                            onClick={() => handleSingleRun(a.id)}
                            disabled={!!activeJobId || a.api_key_status === "running"}
                            className={`inline-flex items-center gap-0.5 text-[11px] font-bold transition-all cursor-pointer ${
                              !!activeJobId || a.api_key_status === "running"
                                ? "text-text-muted cursor-not-allowed opacity-40"
                                : "text-brand-400 hover:text-brand-300 hover:underline"
                            }`}
                          >
                            <span className="material-symbols-outlined text-[13px]">play_arrow</span>
                            Process
                          </button>
                          {a.api_key_status === "ready" && a.api_key && (
                            <button
                              onClick={() => handleSingleAddTo9Router(a.id)}
                              className="inline-flex items-center gap-0.5 text-[11px] font-bold text-green-400 hover:text-green-300 hover:underline transition-all cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-[13px]">add_link</span>
                              +9router
                            </button>
                          )}
                          <button
                            onClick={() => openDetailedLogs(a.id, a.email)}
                            className="inline-flex items-center gap-0.5 text-[11px] font-bold text-text-main hover:text-primary hover:underline transition-all cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[13px]">description</span>
                            Logs
                          </button>
                          <button
                            onClick={() => handleSingleDelete(a.id)}
                            className="inline-flex items-center gap-0.5 text-[11px] font-bold text-red-400 hover:text-red-300 hover:underline transition-all cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[13px]">delete</span>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {displayedAccounts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-text-muted">
                        No accounts found. Add manual accounts to get started.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-4 pt-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
                <span className="text-xs text-text-muted">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {debugMode && (
        <Card padding="md" className="space-y-3 border border-brand-500/20 bg-brand-500/5 mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-brand-400 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">bug_report</span>
              🖥️ Live Browser Preview
            </h2>
            <div className="flex items-center gap-2">
              {!vncReady && (
                <span className="text-[10px] text-text-muted">
                  {activeJobId ? "Starting..." : "Run a job to see the browser"}
                </span>
              )}
              {vncReady && (
                <span className="text-[10px] text-green-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  Live · ~2fps
                </span>
              )}
            </div>
          </div>
          <div className="relative rounded-lg overflow-hidden border border-border-subtle bg-black" style={{ aspectRatio: "16/10" }}>
            {vncReady ? (
              <img
                key="debug-screenshot"
                src={`/api/automation/codebuddy/debug-vnc?action=screenshot&t=${debugScreenshotTs}`}
                alt="Browser preview"
                className="w-full h-full object-contain"
                style={{ minHeight: "400px", imageRendering: "auto" }}
                onLoad={() => {
                  if (debugMode && activeJobId) {
                    setTimeout(() => setDebugScreenshotTs(Date.now()), 400);
                  }
                }}
                onError={() => {
                  setTimeout(() => setDebugScreenshotTs(Date.now()), 2000);
                }}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center space-y-2">
                  <span className="material-symbols-outlined text-[32px] text-text-muted">desktop_windows</span>
                  <p className="text-xs text-text-muted">
                    {activeJobId ? "Starting browser preview..." : "Run a job with Debug Mode to see live browser"}
                  </p>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Proxy Pool Modal */}
      {proxyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setProxyModalOpen(false)}>
          <div className="bg-surface border border-border-subtle rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-border-subtle">
              <h3 className="text-base font-bold text-text-main flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">dns</span>
                Edit Proxy Pool
              </h3>
              <p className="text-xs text-text-muted mt-1">
                Enter one proxy per line. A random proxy will be selected for each automation run.
              </p>
            </div>
            <div className="p-5 space-y-3">
              <textarea
                value={proxyModalText}
                onChange={(e) => setProxyModalText(e.target.value)}
                placeholder={"socks5://user:pass@host:port\nhttp://host:port"}
                rows={10}
                className="w-full text-xs p-3 rounded-xl border border-border-subtle bg-surface-2 focus:outline-none focus:border-primary text-text-main font-mono resize-none"
                spellCheck={false}
              />
            </div>
            <div className="p-5 border-t border-border-subtle flex items-center justify-between gap-3">
              <span className="text-xs text-text-muted">
                {proxyModalText.split('\n').filter(l => l.trim()).length} proxies
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setProxyModalOpen(false)}
                  className="px-4 py-2 text-xs rounded-lg border border-border-subtle text-text-muted hover:text-text-main transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    const lines = proxyModalText.split('\n').map(l => l.trim()).filter(Boolean);
                    setProxyPool(lines);
                    setProxyModalOpen(false);
                    try {
                      await fetch("/api/automation/codebuddy", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          action: "settings",
                          proxy_enabled: true,
                          proxy_pool: JSON.stringify(lines),
                        }),
                      });
                    } catch {}
                  }}
                  className="px-4 py-2 text-xs rounded-lg bg-primary text-white font-medium hover:opacity-90 transition-opacity"
                >
                  Save Proxies
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Detailed Logs Modal */}
      {detailedLogAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setDetailedLogAccount(null)}>
          <div className="bg-surface border border-border-subtle rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-border-subtle flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-text-main flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">description</span>
                  Automation Activity Log
                </h3>
                <p className="text-xs text-text-muted mt-1 font-mono truncate max-w-[450px]">
                  {detailedLogAccount.email}
                </p>
              </div>
              <button 
                onClick={() => setDetailedLogAccount(null)}
                className="text-text-muted hover:text-text-main transition-colors p-1 rounded-lg hover:bg-surface-2 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            
            <div className="p-5 flex-1 min-h-0">
              {detailedLogLoading && !detailedLogContent ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <div className="w-8 h-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                  <p className="text-xs text-text-muted">Loading automation activity logs...</p>
                </div>
              ) : (
                <div className="relative h-full flex flex-col gap-2">
                  <div 
                    ref={logTerminalRef}
                    className="flex-1 min-h-[300px] max-h-[50vh] bg-black/90 text-green-400 p-4 rounded-xl border border-border-subtle overflow-y-auto font-mono text-xs whitespace-pre-wrap leading-relaxed select-all"
                  >
                    {detailedLogContent || "Belum ada rekaman log untuk akun ini."}
                  </div>
                  <div className="text-[10px] text-text-muted flex justify-between items-center px-1">
                    <span>Logs update automatically every 3 seconds while this modal is open.</span>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(detailedLogContent);
                      }}
                      className="flex items-center gap-1 hover:text-primary transition-colors cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[12px]">content_copy</span>
                      Copy Logs
                    </button>
                  </div>
                </div>
              )}
            </div>
            
            <div className="p-5 border-t border-border-subtle flex items-center justify-end gap-3">
              <button
                onClick={() => setDetailedLogAccount(null)}
                className="px-4 py-2 text-xs rounded-lg border border-border-subtle text-text-muted hover:text-text-main transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 2. AMMAIL COMPONENT
// ─────────────────────────────────────────────────────────────────────

function getInjectedHtml(html) {
  if (!html) return "";
  const styleInject = `
    <style id="router-injected-styles">
      html, body {
        overflow-x: auto !important;
        overflow-y: auto !important;
        margin: 0 !important;
        padding: 12px !important;
        background-color: #ffffff !important;
        color: #000000 !important;
      }
      img {
        max-width: 100% !important;
        height: auto !important;
      }
    </style>
  `;
  if (html.includes("<head>")) {
    return html.replace("<head>", `<head>${styleInject}`);
  } else if (html.includes("<HEAD>")) {
    return html.replace("<HEAD>", `<HEAD>${styleInject}`);
  } else if (html.includes("<body>")) {
    return html.replace("<body>", `<body>${styleInject}`);
  } else if (html.includes("<BODY>")) {
    return html.replace("<BODY>", `<BODY>${styleInject}`);
  }
  return styleInject + html;
}

function AmmailTab() {
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [connectionOk, setConnectionOk] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [domains, setDomains] = useState([]);
  const [inboxes, setInboxes] = useState([]);
  const [webhook, setWebhook] = useState(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [otps, setOtps] = useState([]);
  const [htmlZoom, setHtmlZoom] = useState(1.0);
  
  // Modals / Settings config
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showTutorialModal, setShowTutorialModal] = useState(false);
  const [showComposeModal, setShowComposeModal] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [defaultDomain, setDefaultDomain] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [deployMode, setDeployMode] = useState("manual"); // manual | auto
  const [cfAccountId, setCfAccountId] = useState("");
  const [cfApiToken, setCfApiToken] = useState("");
  const [cfDomain, setCfDomain] = useState("");
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [cfWorkersDevUrl, setCfWorkersDevUrl] = useState("");
  const [copiedStates, setCopiedStates] = useState({});
  const [testResult, setTestResult] = useState(null);
  const modalOpenRef = useRef(false);

  useEffect(() => {
    modalOpenRef.current = showSettingsModal;
    if (!showSettingsModal) {
      setTestResult(null);
    }
  }, [showSettingsModal]);

  const [activeFolder, setActiveFolder] = useState("all"); // all | unread | read | otp
  const [selectedInboxAddress, setSelectedInboxAddress] = useState("");
  const [selectedOtpId, setSelectedOtpId] = useState(null);
  const [selectedOtpDetails, setSelectedOtpDetails] = useState(null);
  const [bodyPaneMode, setBodyPaneMode] = useState("html"); // html | text
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const [composerAlias, setComposerAlias] = useState("");
  const [composerDomain, setComposerDomain] = useState("");

  const loadState = async () => {
    try {
      const res = await fetch("/api/automation/ammail");
      const data = await res.json();
      if (res.ok) {
        setConfigured(data.configured);
        setConnectionOk(data.connection_ok);
        setConnectionError(data.connection_error);
        setDomains(data.domains || []);
        const fetchedInboxes = data.inboxes || [];
        setInboxes(fetchedInboxes);
        setSelectedInboxAddress(prev => {
          if (prev) {
            const exists = fetchedInboxes.some(i => i.address.toLowerCase() === prev.toLowerCase());
            if (exists) return prev;
          }
          return fetchedInboxes.length > 0 ? fetchedInboxes[0].address : "";
        });
        setWebhook(data.webhook);
        setWebhookUrl(data.webhook_url);
        setOtps(data.otps || []);
        
        if (!modalOpenRef.current) {
          setBaseUrl(data.settings?.base_url || "");
          setApiKey(data.settings?.api_key || "");
          setDefaultDomain(data.settings?.default_domain || "");
          setWebhookSecret(data.settings?.webhook_secret || "");
          setCfAccountId(data.settings?.cf_account_id || "");
          setCfApiToken(data.settings?.cf_api_token || "");
          setCfDomain(data.settings?.cf_domain || "");
          setTelegramBotToken(data.settings?.cf_telegram_bot_token || "");
          setCfWorkersDevUrl(data.settings?.cf_workers_dev_url || "");
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setInitialLoading(false);
    }
  };

  useEffect(() => {
    loadState();
    const interval = setInterval(loadState, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSaveSettings = async () => {
    try {
      const res = await fetch("/api/automation/ammail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "settings",
          base_url: baseUrl,
          api_key: apiKey,
          default_domain: defaultDomain,
          webhook_secret: webhookSecret,
          cf_account_id: cfAccountId,
          cf_api_token: cfApiToken,
          cf_domain: cfDomain,
          cf_telegram_bot_token: telegramBotToken,
          cf_workers_dev_url: cfWorkersDevUrl,
        })
      });
      if (res.ok) {
        setShowSettingsModal(false);
        loadState();
      }
    } catch (e) {
      alert(`Save failed: ${e.message}`);
    }
  };

  const handleTestConnection = async () => {
    setLoading(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/automation/ammail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test-connection",
          base_url: baseUrl,
          api_key: apiKey,
        })
      });
      const data = await res.json();
      if (res.ok) {
        setTestResult({ ok: true, message: "Koneksi ke worker berhasil!" });
        loadState();
      } else {
        setTestResult({ ok: false, message: `Koneksi gagal: ${data.error}` });
      }
    } catch (e) {
      setTestResult({ ok: false, message: `Error: ${e.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleAutoDeploy = async () => {
    if (!cfAccountId || !cfApiToken || !cfDomain) {
      alert("Account ID, API Token, dan Domain wajib diisi!");
      return;
    }
    setLoading(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/automation/ammail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "auto-deploy",
          cf_account_id: cfAccountId,
          cf_api_token: cfApiToken,
          cf_domain: cfDomain,
          telegram_bot_token: telegramBotToken
        })
      });
      const data = await res.json();
      if (res.ok) {
        setTestResult({ ok: true, message: "Sukses! Worker telah di-deploy ke Cloudflare dan siap digunakan." });
        setBaseUrl(data.base_url || "");
        setApiKey(data.api_key || "");
        setDefaultDomain(data.default_domain || "");
        setWebhookSecret(data.webhook_secret || "");
        setCfWorkersDevUrl(data.cf_workers_dev_url || "");
        loadState();
      } else {
        setTestResult({ ok: false, message: `Deploy gagal: ${data.error}` });
      }
    } catch (e) {
      setTestResult({ ok: false, message: `Error: ${e.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterWebhook = async () => {
    try {
      const res = await fetch("/api/automation/ammail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "webhook-register" })
      });
      const data = await res.json();
      if (res.ok) {
        alert("Webhook registered successfully!");
        loadState();
      } else {
        alert(`Failed: ${data.error}`);
      }
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  };

  const handleCreateInbox = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/automation/ammail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "inbox-create",
          alias: composerAlias,
          domain: composerDomain
        })
      });
      const data = await res.json();
      if (res.ok) {
        setShowComposeModal(false);
        const newAddress = `${composerAlias}@${composerDomain}`.toLowerCase();
        setSelectedInboxAddress(newAddress);
        setComposerAlias("");
        setComposerDomain("");
        loadState();
      } else {
        alert(data.error);
      }
    } catch (e) {
      alert(e.message);
    }
  };

  const handleDeleteInbox = async (alias) => {
    if (!confirm(`Hapus inbox ${alias}?`)) return;
    try {
      const res = await fetch("/api/automation/ammail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "inbox-delete", alias })
      });
      if (res.ok) {
        if (selectedInboxAddress && selectedInboxAddress.split("@")[0] === alias) {
          setSelectedInboxAddress("");
        }
        if (selectedOtpDetails && selectedOtpDetails.alias === alias) {
          setSelectedOtpId(null);
          setSelectedOtpDetails(null);
        }
        loadState();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadOtpDetails = async (id) => {
    setSelectedOtpId(id);
    setSelectedOtpDetails(null);
    setHtmlZoom(1.0);
    try {
      const res = await fetch(`/api/automation/ammail/otps/${id}`);
      const data = await res.json();
      if (res.ok) {
        setSelectedOtpDetails(data.otp);
        loadState();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteOtp = async (e, id) => {
    e.stopPropagation();
    if (!confirm("Delete this email?")) return;
    try {
      await fetch(`/api/automation/ammail/otps/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete" })
      });
      if (selectedOtpId === id) {
        setSelectedOtpId(null);
        setSelectedOtpDetails(null);
      }
      loadState();
    } catch (e) {
      console.error(e);
    }
  };

  const handleEmptyFolder = async () => {
    if (!confirm(`Delete all emails in folder ${activeFolder}?`)) return;
    try {
      await fetch("/api/automation/ammail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "otps-delete-bulk",
          folder: activeFolder,
          address: selectedInboxAddress
        })
      });
      setSelectedOtpId(null);
      setSelectedOtpDetails(null);
      loadState();
    } catch (e) {
      console.error(e);
    }
  };

  const handleCopy = (val) => {
    navigator.clipboard.writeText(val);
    setCopiedStates((prev) => ({ ...prev, [val]: true }));
    setTimeout(() => {
      setCopiedStates((prev) => ({ ...prev, [val]: false }));
    }, 1500);
  };

  const CopyButton = ({ value, text = "Copy", className = "" }) => {
    const isCopied = copiedStates[value];
    return (
      <button
        type="button"
        onClick={() => handleCopy(value)}
        className={`text-[10px] px-2 py-1 rounded cursor-pointer transition-all duration-150 flex items-center gap-1 border font-semibold ${
          isCopied
            ? "text-green-400 bg-green-500/10 border-green-500/20"
            : "text-white/50 hover:text-white bg-white/5 hover:bg-white/10 border-transparent"
        } ${className}`}
      >
        <span className="material-symbols-outlined text-[12px]">{isCopied ? "check" : "content_copy"}</span>
        {isCopied ? "Copied" : text}
      </button>
    );
  };

  // Filter incoming OTPs/emails
  const filteredOtps = otps.filter((o) => {
    if (!selectedInboxAddress) return false;
    if (o.address.toLowerCase() !== selectedInboxAddress.toLowerCase()) return false;
    if (activeFolder === "unread" && o.used_at) return false;
    if (activeFolder === "read" && !o.used_at) return false;
    if (activeFolder === "otp" && !o.otp_code) return false;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        o.sender.toLowerCase().includes(q) ||
        o.subject.toLowerCase().includes(q) ||
        (o.otp_code && o.otp_code.includes(q))
      );
    }
    return true;
  });

  const getFolderCount = (folder) => {
    return otps.filter((o) => {
      if (!selectedInboxAddress) return false;
      if (o.address.toLowerCase() !== selectedInboxAddress.toLowerCase()) return false;
      if (folder === "unread" && o.used_at) return false;
      if (folder === "read" && !o.used_at) return false;
      if (folder === "otp" && !o.otp_code) return false;
      return true;
    }).length;
  };

  return (
    <div className="border border-border-subtle rounded-2xl overflow-hidden bg-vibrancy backdrop-blur-xl flex flex-col h-[calc(100vh-210px)] min-h-[500px] shadow-[var(--shadow-warm)]">
      {initialLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
          <Loading size="lg" label="Memuat setelan Temp Mail..." />
        </div>
      ) : !configured ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
          <div className="size-16 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <span className="material-symbols-outlined text-[32px]">mail_lock</span>
          </div>
          <div>
            <h3 className="text-base font-semibold text-text-main">Ammail Client Not Configured</h3>
            <p className="text-xs text-text-muted mt-1 max-w-sm">
              Please enter your Ammail Cloudflare worker credentials and endpoint in settings to enable temp emails.
            </p>
          </div>
          <Button variant="primary" onClick={() => setShowSettingsModal(true)}>
            ⚙ Configure Settings
          </Button>
        </div>
      ) : (
        <div className="flex-1 flex divide-x divide-border-subtle min-h-0">
          {/* 1. Left sidebar */}
          <aside className="w-60 shrink-0 bg-surface/40 flex flex-col min-h-0">
            <div className="p-4 border-b border-border-subtle flex items-center justify-between gap-3">
              <span 
                className="text-xs font-bold text-text-main flex items-center gap-1.5"
                title={!connectionOk && connectionError ? connectionError : undefined}
              >
                <span className={`inline-block size-2 rounded-full ${connectionOk ? "bg-green-500" : "bg-red-500 animate-ping"}`} />
                {connectionOk ? "Connected" : "Disconnected"}
              </span>
              <button
                onClick={() => setShowSettingsModal(true)}
                className="text-text-muted hover:text-text-main cursor-pointer"
                title="Settings"
              >
                <span className="material-symbols-outlined text-[18px]">settings</span>
              </button>
            </div>

            {!connectionOk && connectionError && (
              <div className="px-4 py-2.5 bg-red-500/10 border-b border-red-500/20 text-[10px] text-red-400 break-all space-y-1">
                <div className="font-semibold flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">error</span>
                  Koneksi Gagal:
                </div>
                <div className="opacity-80">{connectionError}</div>
                {cfWorkersDevUrl && baseUrl !== cfWorkersDevUrl && (
                  <button
                    onClick={() => {
                      setBaseUrl(cfWorkersDevUrl);
                      setShowSettingsModal(true);
                      setDeployMode("manual");
                    }}
                    className="text-primary hover:underline text-[9px] font-semibold block mt-1 text-left"
                  >
                    💡 Gunakan domain workers.dev fallback
                  </button>
                )}
              </div>
            )}

            <div className="p-4">
              <Button variant="primary" size="sm" fullWidth onClick={() => {
                setComposerDomain(defaultDomain || (domains.length > 0 ? domains[0] : ""));
                setShowComposeModal(true);
              }}>
                ＋ New Inbox
              </Button>
            </div>
            <nav className="flex flex-col px-2 space-y-0.5">
              <button
                onClick={() => {
                  setActiveFolder("all");
                }}
                className={`flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  activeFolder === "all"
                    ? "bg-primary/10 text-primary"
                    : "text-text-muted hover:bg-surface"
                }`}
              >
                <span className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 opacity-80">
                    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline>
                    <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path>
                  </svg>
                  Inbox
                </span>
                <span className="bg-surface-3 px-1.5 py-0.5 rounded-full text-[10px] text-text-muted">{getFolderCount("all")}</span>
              </button>
              <button
                onClick={() => setActiveFolder("unread")}
                className={`flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  activeFolder === "unread"
                    ? "bg-primary/10 text-primary"
                    : "text-text-muted hover:bg-surface"
                }`}
              >
                <span className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 opacity-80">
                    <rect x="2" y="4" width="20" height="16" rx="2"></rect>
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
                  </svg>
                  Unread
                </span>
                <span className="bg-surface-3 px-1.5 py-0.5 rounded-full text-[10px] text-text-muted">{getFolderCount("unread")}</span>
              </button>
              <button
                onClick={() => setActiveFolder("read")}
                className={`flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  activeFolder === "read"
                    ? "bg-primary/10 text-primary"
                    : "text-text-muted hover:bg-surface"
                }`}
              >
                <span className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 opacity-80">
                    <path d="M2 17V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z"></path>
                    <path d="M2 7l10 7 10-7"></path>
                  </svg>
                  Read
                </span>
                <span className="bg-surface-3 px-1.5 py-0.5 rounded-full text-[10px] text-text-muted">{getFolderCount("read")}</span>
              </button>
              <button
                onClick={() => setActiveFolder("otp")}
                className={`flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  activeFolder === "otp"
                    ? "bg-primary/10 text-primary"
                    : "text-text-muted hover:bg-surface"
                }`}
              >
                <span className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 opacity-80">
                    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
                  </svg>
                  With OTP
                </span>
                <span className="bg-surface-3 px-1.5 py-0.5 rounded-full text-[10px] text-text-muted">{getFolderCount("otp")}</span>
              </button>
            </nav>

            <div className="px-4 py-3 border-t border-b border-border-subtle/45 mt-4 bg-surface/10">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search inboxes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full text-xs pl-8 pr-3 py-1.5 rounded-lg border border-border-subtle bg-surface focus:outline-none focus:border-primary text-text-main"
                />
                <span className="absolute left-2.5 top-2.5 text-text-muted/60">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pt-4">
              <div>
                <p className="px-3 text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
                  Active Inboxes ({inboxes.length})
                </p>
                <div className="space-y-0.5">
                  {inboxes
                    .filter((inbox) =>
                      inbox.address.toLowerCase().includes(searchQuery.toLowerCase())
                    )
                    .map((inbox) => (
                      <div
                        key={inbox.address}
                        onClick={() => {
                          setSelectedInboxAddress(inbox.address);
                          setActiveFolder("all");
                        }}
                        className={`group/inbox flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                          selectedInboxAddress.toLowerCase() === inbox.address.toLowerCase()
                            ? "bg-primary/10 text-primary"
                            : "text-text-muted hover:bg-surface"
                        }`}
                      >
                        <span className="truncate w-32" title={inbox.address}>
                          {inbox.address}
                        </span>
                        <div className="flex items-center gap-1 shrink-0 ml-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(inbox.address);
                            }}
                            className={`size-6 flex items-center justify-center rounded-md transition-all duration-150 ${
                              copiedStates[inbox.address]
                                ? "text-green-400 bg-green-500/15"
                                : "text-text-muted hover:text-primary hover:bg-primary/15"
                            }`}
                            title="Copy address"
                          >
                            {copiedStates[inbox.address] ? (
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
                                <polyline points="20 6 9 17 4 12"></polyline>
                              </svg>
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                              </svg>
                            )}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteInbox(inbox.alias);
                            }}
                            className="size-6 flex items-center justify-center rounded-md text-text-muted hover:text-red-400 hover:bg-red-500/15 transition-all duration-150"
                            title="Delete inbox"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
                              <line x1="18" y1="6" x2="6" y2="18"></line>
                              <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  {inboxes.length === 0 && (
                    <p className="px-3 text-[11px] text-text-muted italic">No inboxes. Click New Inbox above.</p>
                  )}
                </div>
              </div>
            </div>
          </aside>

          {/* 2. Middle list */}
          <section className="w-80 shrink-0 flex flex-col min-h-0 bg-surface/10">
            <div className="p-3 border-b border-border-subtle flex items-center justify-between gap-2 bg-surface/10">
              <span className="text-xs font-bold text-text-muted uppercase tracking-wider pl-1">
                Messages
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    setRefreshing(true);
                    loadState().finally(() => setRefreshing(false));
                  }}
                  className={`p-1.5 hover:bg-surface rounded-lg cursor-pointer text-text-muted transition-colors duration-150 ${refreshing ? "animate-spin" : ""}`}
                  title="Refresh"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-4">
                    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                    <path d="M3 3v5h5"></path>
                    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path>
                    <path d="M16 16h5v5"></path>
                  </svg>
                </button>
                <button
                  onClick={(e) => {
                    if (selectedOtpId) handleDeleteOtp(e, selectedOtpId);
                  }}
                  disabled={!selectedOtpId}
                  className={`p-1.5 rounded-lg cursor-pointer transition-colors duration-150 ${
                    selectedOtpId
                      ? "text-red-500 hover:bg-red-500/10"
                      : "text-text-muted/30 cursor-not-allowed"
                  }`}
                  title="Delete selected email"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
                    <path d="M3 6h18"></path>
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1.5">
              {!selectedInboxAddress ? (
                <div className="text-center p-8 text-text-muted text-xs italic">Select an inbox to view messages.</div>
              ) : filteredOtps.length === 0 ? (
                <div className="text-center p-8 text-text-muted text-xs italic">No messages found.</div>
              ) : (
                filteredOtps.map((o) => (
                  <div
                    key={o.id}
                    onClick={() => loadOtpDetails(o.id)}
                    className={`group p-3 rounded-xl border border-border-subtle cursor-pointer transition-colors relative flex flex-col gap-1 ${
                      selectedOtpId === o.id
                        ? "bg-primary/10 border-primary"
                        : o.used_at
                        ? "bg-surface/40 hover:bg-surface"
                        : "bg-surface font-semibold shadow-[var(--shadow-soft)] hover:bg-surface/80"
                    }`}
                  >
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="text-xs text-text-main truncate w-36">{o.sender}</span>
                      <span className="text-[9px] text-text-muted shrink-0">
                        {new Date(o.received_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <h4 className="text-xs text-text-main truncate">{o.subject}</h4>
                    
                    {o.otp_code && (
                      <div className="mt-1">
                        <span className="bg-amber-500/10 text-amber-500 border border-amber-500/20 px-1.5 py-0.5 rounded font-mono text-[10px] font-bold tracking-wider">
                          🔑 {o.otp_code}
                        </span>
                      </div>
                    )}

                    <button
                      onClick={(e) => handleDeleteOtp(e, o.id)}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-500 transition-all p-1 hover:bg-red-500/10 rounded cursor-pointer"
                      title="Delete email"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
                        <path d="M3 6h18"></path>
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* 3. Right detail */}
          <article className="flex-1 flex flex-col min-h-0 bg-surface/5">
            {selectedOtpId === null ? (
              <div className="flex-1 flex items-center justify-center text-text-muted text-xs italic">
                Select an email to read its contents.
              </div>
            ) : selectedOtpDetails === null ? (
              <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
                <span className="animate-spin mr-2">⏳</span> Loading email details...
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0">
                {/* Header */}
                <div className="p-6 border-b border-border-subtle space-y-4">
                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <h3 className="text-sm font-bold text-text-main">{selectedOtpDetails.subject}</h3>
                      <p className="text-xs text-text-muted mt-1">
                        From: <span className="font-semibold text-text-main">{selectedOtpDetails.sender}</span>
                      </p>
                      <p className="text-xs text-text-muted">
                        To: <span className="font-semibold text-text-main">{selectedOtpDetails.address}</span>
                      </p>
                    </div>
                    <div className="text-right flex flex-col items-end gap-2 shrink-0">
                      <span className="text-[11px] text-text-muted">
                        {new Date(selectedOtpDetails.received_at * 1000).toLocaleString()}
                      </span>
                      <button
                        onClick={(e) => handleDeleteOtp(e, selectedOtpDetails.id)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-lg border bg-red-500/10 text-red-400 hover:bg-red-500/20 border-red-500/20 transition-all active:scale-95 cursor-pointer mt-1"
                        title="Delete this email"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3">
                          <path d="M3 6h18"></path>
                          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                        </svg>
                        Delete Email
                      </button>
                    </div>
                  </div>

                  {/* Parse results banners */}
                  {selectedOtpDetails.otp_code && (
                    <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-4 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-[10px] text-amber-500 uppercase tracking-widest font-bold">Verification OTP</p>
                        <p className="text-2xl font-black font-mono tracking-widest text-text-main mt-1">
                          {selectedOtpDetails.otp_code}
                        </p>
                      </div>
                      <Button
                        variant={copiedStates[selectedOtpDetails.otp_code] ? "success" : "secondary"}
                        size="sm"
                        onClick={() => handleCopy(selectedOtpDetails.otp_code)}
                      >
                        {copiedStates[selectedOtpDetails.otp_code] ? (
                          <span className="flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px]">check</span>
                            Copied!
                          </span>
                        ) : (
                          "Copy Code"
                        )}
                      </Button>
                    </div>
                  )}

                  {selectedOtpDetails.verify_url && (
                    <div className="bg-primary/10 border border-primary/20 rounded-xl p-3 flex items-center justify-between gap-3 text-xs">
                      <span className="truncate flex-1 text-text-main" title={selectedOtpDetails.verify_url}>
                        🔗 {selectedOtpDetails.verify_url}
                      </span>
                      <a
                        href={selectedOtpDetails.verify_url}
                        target="_blank"
                        rel="noreferrer"
                        className="bg-primary hover:bg-primary/95 text-white px-3 py-1.5 rounded-lg font-semibold shrink-0"
                      >
                        Open Link
                      </a>
                    </div>
                  )}
                </div>

                {/* Body Swapper */}
                <div className="flex justify-between items-center border-b border-border-subtle bg-surface/20 px-6 shrink-0">
                  <div className="flex">
                    {selectedOtpDetails.body_html && (
                      <button
                        onClick={() => setBodyPaneMode("html")}
                        className={`px-4 py-2.5 text-xs font-semibold border-b-2 cursor-pointer ${
                          bodyPaneMode === "html" ? "border-primary text-primary" : "border-transparent text-text-muted"
                        }`}
                      >
                        HTML View
                      </button>
                    )}
                    <button
                      onClick={() => setBodyPaneMode("text")}
                      className={`px-4 py-2.5 text-xs font-semibold border-b-2 cursor-pointer ${
                        bodyPaneMode === "text" || !selectedOtpDetails.body_html
                          ? "border-primary text-primary"
                          : "border-transparent text-text-muted"
                      }`}
                    >
                      Plain Text
                    </button>
                  </div>

                  {bodyPaneMode === "html" && selectedOtpDetails.body_html && (
                    <div className="flex items-center gap-2 py-1.5 text-xs text-text-muted select-none">
                      <span className="material-symbols-outlined text-[16px] text-white/40">zoom_in</span>
                      <button
                        onClick={() => setHtmlZoom((prev) => Math.max(0.4, prev - 0.1))}
                        className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 border border-white/10 active:bg-white/20 transition-colors text-[10px] font-bold cursor-pointer text-white"
                        title="Zoom Out"
                      >
                        A-
                      </button>
                      <span className="font-mono text-[10px] w-10 text-center text-white/80">{Math.round(htmlZoom * 100)}%</span>
                      <button
                        onClick={() => setHtmlZoom((prev) => Math.min(1.5, prev + 0.1))}
                        className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 border border-white/10 active:bg-white/20 transition-colors text-[10px] font-bold cursor-pointer text-white"
                        title="Zoom In"
                      >
                        A+
                      </button>
                      <button
                        onClick={() => setHtmlZoom(1.0)}
                        className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 border border-white/10 active:bg-white/20 transition-colors text-[10px] font-semibold cursor-pointer text-white ml-1"
                      >
                        Reset
                      </button>
                    </div>
                  )}
                </div>

                {/* Content Pane */}
                <div className="flex-1 overflow-auto custom-scrollbar p-6 relative min-h-[450px]">
                  {bodyPaneMode === "html" && selectedOtpDetails.body_html ? (
                    <div className="w-full h-full relative overflow-auto custom-scrollbar">
                      <iframe
                        srcDoc={getInjectedHtml(selectedOtpDetails.body_html)}
                        title="Email Preview"
                        sandbox="allow-popups allow-popups-to-escape-sandbox"
                        style={{
                          transform: `scale(${htmlZoom})`,
                          transformOrigin: "top left",
                          width: `${100 / htmlZoom}%`,
                          height: `${100 / htmlZoom}%`,
                        }}
                        className="border border-border-subtle rounded-xl bg-white absolute inset-0"
                      />
                    </div>
                  ) : (
                    <pre className="text-xs font-sans whitespace-pre-wrap leading-relaxed text-text-main">
                      {selectedOtpDetails.body_text}
                    </pre>
                  )}
                </div>
              </div>
            )}
          </article>
        </div>
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm p-4 pt-[6vh] overflow-y-auto">
          <div className="bg-neutral-900 border border-white/10 rounded-2xl w-full max-w-md text-white max-h-[80vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="flex justify-between items-center p-5 border-b border-white/5 shrink-0">
              <h3 className="text-base font-bold">Ammail Settings</h3>
              <button onClick={() => setShowSettingsModal(false)} className="text-white/60 hover:text-white cursor-pointer flex items-center">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="p-5 overflow-y-auto custom-scrollbar flex-1 space-y-4">
              <div className="flex border border-white/10 rounded-lg p-0.5 bg-white/5 text-xs shrink-0">
                <button
                  type="button"
                  onClick={() => setDeployMode("manual")}
                  className={`flex-1 py-1.5 rounded-md font-semibold cursor-pointer text-center transition-all ${
                    deployMode === "manual" ? "bg-primary text-white" : "text-white/60 hover:text-white"
                  }`}
                >
                  Manual Input
                </button>
                <button
                  type="button"
                  onClick={() => setDeployMode("auto")}
                  className={`flex-1 py-1.5 rounded-md font-semibold cursor-pointer text-center transition-all ${
                    deployMode === "auto" ? "bg-primary text-white" : "text-white/60 hover:text-white"
                  }`}
                >
                  ⚡ Auto Deploy (Cloudflare)
                </button>
              </div>

              {deployMode === "manual" ? (
                <div className="space-y-4">
                  <div className="space-y-3">
                    <div>
                      <label className="text-[11px] text-white/60 block mb-1">Base URL Worker</label>
                      <input
                        type="text"
                        placeholder="https://mail.yourdomain.com"
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        className="w-full text-xs p-2.5 rounded-lg border border-white/10 bg-white/5 focus:outline-none focus:border-primary text-white"
                      />
                      {cfWorkersDevUrl && baseUrl !== cfWorkersDevUrl && (
                        <div className="mt-1.5 p-2 bg-primary/10 border border-primary/20 rounded-lg text-[10px] text-primary space-y-1 text-left">
                          <div>💡 Coba gunakan URL workers.dev fallback:</div>
                          <div className="font-mono text-[9px] break-all bg-black/40 p-1 rounded select-all">{cfWorkersDevUrl}</div>
                          <button
                            type="button"
                            onClick={() => setBaseUrl(cfWorkersDevUrl)}
                            className="underline hover:no-underline font-semibold block"
                          >
                            Klik untuk gunakan URL ini
                          </button>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="text-[11px] text-white/60 block mb-1">API Key (X-API-Key)</label>
                      <input
                        type="password"
                        placeholder="tm_..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className="w-full text-xs p-2.5 rounded-lg border border-white/10 bg-white/5 focus:outline-none focus:border-primary text-white"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] text-white/60 block mb-1">Default Domain</label>
                      <input
                        type="text"
                        placeholder="yourdomain.com"
                        value={defaultDomain}
                        onChange={(e) => setDefaultDomain(e.target.value)}
                        className="w-full text-xs p-2.5 rounded-lg border border-white/10 bg-white/5 focus:outline-none focus:border-primary text-white"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] text-white/60 block mb-1">Webhook Secret</label>
                      <input
                        type="password"
                        placeholder="Leave empty to auto-generate"
                        value={webhookSecret}
                        onChange={(e) => setWebhookSecret(e.target.value)}
                        className="w-full text-xs p-2.5 rounded-lg border border-white/10 bg-white/5 focus:outline-none focus:border-primary text-white"
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Button variant="secondary" size="sm" fullWidth onClick={handleTestConnection} disabled={loading}>
                      {loading ? "Testing..." : "⚡ Test Connection"}
                    </Button>

                    {testResult && (
                      <div className={`p-2.5 rounded-lg text-xs font-medium flex items-start gap-2 ${testResult.ok ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                        <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">
                          {testResult.ok ? 'check_circle' : 'error'}
                        </span>
                        <span className="break-all text-left">{testResult.message}</span>
                      </div>
                    )}

                    <div className="flex gap-2 pt-1">
                      <Button variant="secondary" size="sm" fullWidth onClick={() => setShowSettingsModal(false)}>
                        Cancel
                      </Button>
                      <Button variant="primary" size="sm" fullWidth onClick={handleSaveSettings}>
                        Save Settings
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[11px] text-white/60 block">Cloudflare Account ID</label>
                        <a
                          href="https://dash.cloudflare.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-primary hover:underline cursor-pointer flex items-center gap-0.5"
                        >
                          Temukan disini <span className="material-symbols-outlined text-[10px]">open_in_new</span>
                        </a>
                      </div>
                      <input
                        type="text"
                        placeholder="Paste Account ID Anda"
                        value={cfAccountId}
                        onChange={(e) => setCfAccountId(e.target.value)}
                        className="w-full text-xs p-2.5 rounded-lg border border-white/10 bg-white/5 focus:outline-none focus:border-primary text-white"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[11px] text-white/60 block">Cloudflare API Token (Workers & D1)</label>
                        <a
                          href="https://dash.cloudflare.com/profile/api-tokens"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-primary hover:underline cursor-pointer flex items-center gap-0.5"
                        >
                          Buat disini <span className="material-symbols-outlined text-[10px]">open_in_new</span>
                        </a>
                      </div>
                      <input
                        type="password"
                        placeholder="Paste API Token Anda"
                        value={cfApiToken}
                        onChange={(e) => setCfApiToken(e.target.value)}
                        className="w-full text-xs p-2.5 rounded-lg border border-white/10 bg-white/5 focus:outline-none focus:border-primary text-white"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] text-white/60 block mb-1">Domain Worker (misal: mail.domainanda.com)</label>
                      <input
                        type="text"
                        placeholder="mail.domainanda.com"
                        value={cfDomain}
                        onChange={(e) => setCfDomain(e.target.value)}
                        className="w-full text-xs p-2.5 rounded-lg border border-white/10 bg-white/5 focus:outline-none focus:border-primary text-white"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[11px] text-white/60 block">Telegram Bot Token (Opsional)</label>
                        <a
                          href="https://t.me/BotFather"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-primary hover:underline cursor-pointer flex items-center gap-0.5"
                        >
                          Dapatkan di @BotFather <span className="material-symbols-outlined text-[10px]">open_in_new</span>
                        </a>
                      </div>
                      <input
                        type="password"
                        placeholder="Token Bot dari @BotFather"
                        value={telegramBotToken}
                        onChange={(e) => setTelegramBotToken(e.target.value)}
                        className="w-full text-xs p-2.5 rounded-lg border border-white/10 bg-white/5 focus:outline-none focus:border-primary text-white"
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    {testResult && (
                      <div className={`p-2.5 rounded-lg text-xs font-medium flex items-start gap-2 ${testResult.ok ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                        <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">
                          {testResult.ok ? 'check_circle' : 'error'}
                        </span>
                        <span className="break-all text-left">{testResult.message}</span>
                      </div>
                    )}

                    {cfWorkersDevUrl && (
                      <div className="p-2.5 bg-white/5 border border-white/10 rounded-lg text-[10px] text-white/70 space-y-1 text-left">
                        <span className="font-semibold text-primary block">Workers.dev fallback URL:</span>
                        <span className="font-mono text-[9px] break-all block bg-black/40 p-1 rounded select-all">{cfWorkersDevUrl}</span>
                        <span className="block leading-relaxed">
                          Jika custom domain Anda terputus, Anda dapat menggunakan URL fallback ini di tab Manual Input.
                        </span>
                      </div>
                    )}

                    <div className="flex gap-2 pt-1">
                      <Button variant="secondary" size="sm" fullWidth onClick={() => setShowSettingsModal(false)}>
                        Cancel
                      </Button>
                      <Button variant="primary" size="sm" fullWidth onClick={handleAutoDeploy} disabled={loading}>
                        {loading ? "Deploying..." : "⚡ Auto Deploy & Setup"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-3 pt-2 border-t border-white/5 shrink-0">
                <a
                  href="/dashboard/automation/ammail-tutorial"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-2 rounded-lg bg-neutral-900 border border-primary/20 hover:border-primary/50 text-primary text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  📖 Buka Panduan Lengkap Deploy
                </a>

                <details className="group bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                  <summary className="list-none flex items-center justify-between p-3 cursor-pointer select-none text-[11px] font-semibold text-white/80 hover:text-white transition-colors">
                    <span className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-primary">help</span>
                      Cara Setup Temp Mail (Ammail)
                    </span>
                    <span className="material-symbols-outlined text-[16px] transition-transform group-open:rotate-180">
                      expand_more
                    </span>
                  </summary>
                  <div className="p-3 pt-0 border-t border-white/5 text-[11px] text-white/70 space-y-2 leading-relaxed max-h-40 overflow-y-auto custom-scrollbar">
                    <p className="mt-2">
                      Ammail adalah sistem email sementara berbasis <strong>Cloudflare Worker</strong>. Ikuti langkah berikut untuk mengaturnya:
                    </p>
                    <ol className="list-decimal list-inside space-y-1.5 text-white/60">
                      <li>
                        <strong className="text-white/80">Deploy Worker:</strong> Deploy kode worker Ammail di akun Cloudflare Anda.
                      </li>
                      <li>
                        <strong className="text-white/80">Set API Key:</strong> Pada dashboard Worker Anda, tambahkan Environment Variable <code className="bg-white/10 px-1 py-0.5 rounded font-mono text-amber-300">API_KEY</code> dengan nilai token rahasia Anda.
                      </li>
                      <li>
                        <strong className="text-white/80">Email Routing:</strong> Aktifkan Cloudflare Email Routing pada domain Anda, lalu arahkan semua email masuk ke worker tersebut.
                      </li>
                      <li>
                        <strong className="text-white/80">Hubungkan:</strong> Masukkan <strong className="text-white">Base URL Worker</strong> (misal: <code className="text-amber-200">https://mail.domain.com</code>) dan <strong className="text-white">API Key</strong> ke form di atas, lalu tekan <strong className="text-white">Test Connection</strong>.
                      </li>
                      <li>
                        <strong className="text-white/80">Aktifkan Webhook:</strong> Setelah koneksi berhasil dan pengaturan disimpan, klik tombol <strong className="text-white">Register Webhook</strong> di bawah untuk mengaktifkan sinkronisasi email secara real-time.
                      </li>
                    </ol>
                  </div>
                </details>

                {configured && (
                  <div className="border-t border-white/10 pt-3 mt-2 space-y-2">
                    <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider">Worker Integration</p>
                    <pre className="text-[10px] bg-white/5 p-2 rounded overflow-x-auto text-amber-300 font-mono">
                      {webhookUrl}
                    </pre>
                    <Button variant="primary" size="sm" fullWidth onClick={handleRegisterWebhook}>
                      Register Webhook
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tutorial Modal */}
      {showTutorialModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-neutral-950 border border-white/10 rounded-2xl w-full max-w-2xl text-white max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="flex justify-between items-center p-5 border-b border-white/5 shrink-0 bg-neutral-900">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[22px]">auto_stories</span>
                <h3 className="text-base font-bold">Panduan Lengkap Deploy Temp Mail</h3>
              </div>
              <button onClick={() => setShowTutorialModal(false)} className="text-white/60 hover:text-white cursor-pointer flex items-center">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6 text-sm leading-relaxed text-white/80">
              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2 mb-2">
                  <span className="bg-primary/20 text-primary px-2 py-0.5 rounded text-xs">1</span>
                  Prasyarat & Login Cloudflare
                </h4>
                <p className="mb-2">
                  Pastikan Node.js sudah terinstal. Login ke akun Cloudflare Anda melalui terminal dengan menjalankan perintah berikut:
                </p>
                <div className="flex items-center justify-between bg-white/5 p-3 rounded-lg border border-white/10 font-mono text-xs text-amber-300">
                  <span>npx wrangler login</span>
                  <CopyButton value="npx wrangler login" />
                </div>
              </div>

              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2 mb-2">
                  <span className="bg-primary/20 text-primary px-2 py-0.5 rounded text-xs">2</span>
                  Install Dependencies
                </h4>
                <p className="mb-2">
                  Masuk ke direktori tempmail lokal di sistem Anda dan install dependensi NPM:
                </p>
                <div className="flex items-center justify-between bg-white/5 p-3 rounded-lg border border-white/10 font-mono text-xs text-amber-300">
                  <span>cd /home/data/Project/9router/tempmail && npm install</span>
                  <CopyButton value="cd /home/data/Project/9router/tempmail && npm install" />
                </div>
              </div>

              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2 mb-2">
                  <span className="bg-primary/20 text-primary px-2 py-0.5 rounded text-xs">3</span>
                  Buat Database D1
                </h4>
                <p className="mb-2">
                  Buat database SQL D1 baru untuk menyimpan inbox dan pesan email masuk:
                </p>
                <div className="flex items-center justify-between bg-white/5 p-3 rounded-lg border border-white/10 font-mono text-xs text-amber-300 mb-3">
                  <span>npx wrangler d1 create tempmail</span>
                  <CopyButton value="npx wrangler d1 create tempmail" />
                </div>
              </div>

              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2 mb-2">
                  <span className="bg-primary/20 text-primary px-2 py-0.5 rounded text-xs">4</span>
                  Jalankan Migrasi Database
                </h4>
                <p className="mb-2">
                  Inisialisasi tabel database temp mail di lokal dan jarak jauh (remote Cloudflare):
                </p>
                <div className="flex items-center justify-between bg-white/5 p-3 rounded-lg border border-white/10 font-mono text-xs text-amber-300">
                  <span>npm run db:migrate:local && npm run db:migrate:remote</span>
                  <CopyButton value="npm run db:migrate:local && npm run db:migrate:remote" />
                </div>
              </div>

              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2 mb-2">
                  <span className="bg-primary/20 text-primary px-2 py-0.5 rounded text-xs">5</span>
                  Simpan Secret Bot Telegram
                </h4>
                <p className="mb-2">
                  Set token Telegram bot Anda dan webhook secret token ke Cloudflare Workers:
                </p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between bg-white/5 p-3 rounded-lg border border-white/10 font-mono text-xs text-amber-300">
                    <span>npx wrangler secret put TELEGRAM_BOT_TOKEN</span>
                    <CopyButton value="npx wrangler secret put TELEGRAM_BOT_TOKEN" />
                  </div>
                  <div className="flex items-center justify-between bg-white/5 p-3 rounded-lg border border-white/10 font-mono text-xs text-amber-300">
                    <span>npx wrangler secret put TELEGRAM_WEBHOOK_SECRET</span>
                    <CopyButton value="npx wrangler secret put TELEGRAM_WEBHOOK_SECRET" />
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2 mb-2">
                  <span className="bg-primary/20 text-primary px-2 py-0.5 rounded text-xs">6</span>
                  Konfigurasi `wrangler.jsonc` & Deploy
                </h4>
                <p className="mb-2">
                  Sesuaikan nilai di bagian <code>vars</code> (domain dan base URL) pada file wrangler.jsonc, lalu deploy worker:
                </p>
                <div className="flex items-center justify-between bg-white/5 p-3 rounded-lg border border-white/10 font-mono text-xs text-amber-300">
                  <span>npm run deploy</span>
                  <CopyButton value="npm run deploy" />
                </div>
              </div>

              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2 mb-2">
                  <span className="bg-primary/20 text-primary px-2 py-0.5 rounded text-xs">7</span>
                  Set Webhook Telegram Bot
                </h4>
                <p className="mb-2">
                  Daftarkan URL Worker Anda agar bot Telegram dapat memproses command masuk:
                </p>
                <div className="flex items-center justify-between bg-white/5 p-3 rounded-lg border border-white/10 font-mono text-xs text-amber-300">
                  <span className="truncate mr-2">
                    {'curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" -H "Content-Type: application/json" -d \'{"url":"https://<worker-host>/telegram/webhook","secret_token":"<WEBHOOK_SECRET>"}\''}
                  </span>
                  <CopyButton value={`curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" -H "Content-Type: application/json" -d '{"url":"https://<worker-host>/telegram/webhook","secret_token":"<WEBHOOK_SECRET>"}'`} />
                </div>
              </div>

              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2 mb-2">
                  <span className="bg-primary/20 text-primary px-2 py-0.5 rounded text-xs">8</span>
                  Cloudflare Email Routing
                </h4>
                <p>
                  Masuk ke Cloudflare Dashboard domain Anda, klik menu <strong>Email Routing</strong>, aktifkan fitur tersebut, lalu buat rule <strong>Catch-all</strong> dengan aksi <strong>Send to a Worker</strong> mengarah ke nama Worker Anda.
                </p>
              </div>
            </div>

            <div className="p-5 border-t border-white/5 shrink-0 bg-neutral-900 flex justify-end">
              <Button variant="primary" size="sm" onClick={() => setShowTutorialModal(false)}>
                Selesai Membaca
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Compose Modal */}
      {showComposeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form onSubmit={handleCreateInbox} className="bg-neutral-900 border border-white/10 rounded-2xl w-full max-w-sm p-6 space-y-4 text-white">
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold">New Inbox</h3>
              <button type="button" onClick={() => setShowComposeModal(false)} className="text-white/60 hover:text-white cursor-pointer">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-white/60 block mb-1">Alias (optional, empty = random)</label>
                <input
                  type="text"
                  placeholder="e.g. business-inbox"
                  value={composerAlias}
                  onChange={(e) => setComposerAlias(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-lg border border-white/10 bg-white/5 focus:outline-none focus:border-primary text-white"
                />
              </div>

              <div>
                <label className="text-[11px] text-white/60 block mb-1">Domain</label>
                {domains.length > 0 ? (
                  <select
                    value={composerDomain}
                    onChange={(e) => setComposerDomain(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-white/10 bg-neutral-900 focus:outline-none focus:border-primary text-white"
                  >
                    <option value="">— Default ({defaultDomain || domains[0]}) —</option>
                    {domains.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder={defaultDomain || "yourdomain.com"}
                    value={composerDomain}
                    onChange={(e) => setComposerDomain(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-white/10 bg-white/5 focus:outline-none focus:border-primary text-white"
                  />
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <Button type="button" variant="secondary" size="sm" fullWidth onClick={() => setShowComposeModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" size="sm" fullWidth>
                  Create Inbox
                </Button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
