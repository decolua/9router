"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/shared/components";
import BrowserProfilePicker from "../providers/components/BrowserProfilePicker";
import RemoteLoginBrowser from "../providers/components/RemoteLoginBrowser";

const terminal = (status) => ["closed", "error", "timeout", "cancelled", "stopped"].includes(status);
const iconClass = "h-9 w-9 shrink-0 !p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

export default function BrowserPage() {
  const [profile, setProfile] = useState("default");
  const [available, setAvailable] = useState(false);
  const [url, setUrl] = useState("https://www.google.com");
  const [sessions, setSessions] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [viewerAttempt, setViewerAttempt] = useState(0);
  const [launching, setLaunching] = useState(false);
  const [stopping, setStopping] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const [notice, setNotice] = useState("");
  const mounted = useRef(false);
  const revision = useRef(0);
  const viewerRef = useRef(null);
  useEffect(() => {
    if (selectedId) viewerRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [selectedId]);
  const selected = sessions.find((session) => session.id === selectedId);

  const refresh = useCallback(async (signal) => {
    const version = ++revision.current;
    try {
      const response = await fetch("/api/browser/sessions", { cache: "no-store", signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load browser sessions");
      if (!Array.isArray(data.sessions)) throw new Error("Invalid browser session response");
      if (mounted.current && version === revision.current) {
        setSessions(data.sessions.map((session) => terminal(session.status) ? { ...session, viewer: null } : session));
        setPollError("");
      }
    } catch (cause) {
      if (mounted.current && !signal?.aborted && version === revision.current) setPollError(cause.message || "Unable to load browser sessions");
    } finally {
      if (mounted.current && !signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let timer;
    const poll = async () => {
      await refresh(controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(poll, 2000);
    };
    poll();
    return () => {
      mounted.current = false;
      revision.current += 1;
      controller.abort();
      clearTimeout(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (selectedId && !selected && !loading) {
      setSelectedId("");
      setNotice("The browser session has ended. Launch a browser to continue with its saved profile.");
    } else if (selected && terminal(selected.status)) {
      setSelectedId("");
      setNotice(selected.error || `Browser session ${selected.status}. Your profile is preserved.`);
    }
  }, [selectedId, selected, loading]);

  const launch = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      const address = new URL(url);
      if (url.length > 4096 || !["http:", "https:"].includes(address.protocol) || address.username || address.password) throw new Error("Enter an HTTP or HTTPS address without embedded credentials.");
      setLaunching(true);
      const response = await fetch("/api/browser/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile, url: address.href }) });
      const session = await response.json();
      if (!response.ok) throw new Error(session.error || "Unable to launch browser");
      if (!mounted.current) return;
      revision.current += 1;
      setSessions((current) => [...current.filter((item) => item.id !== session.id), session]);
      setSelectedId(session.id);
      setViewerAttempt((value) => value + 1);
    } catch (cause) {
      if (mounted.current) setError(cause.message || "Unable to launch browser");
    } finally {
      if (mounted.current) setLaunching(false);
    }
  };

  const stop = async (id) => {
    setStopping(id);
    setError("");
    try {
      const response = await fetch(`/api/browser/sessions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to stop browser");
      if (!mounted.current) return;
      revision.current += 1;
      setSessions((current) => current.filter((session) => session.id !== id));
      setSelectedId((current) => current === id ? "" : current);
      setNotice("Browser stopped. Its signed-in profile data is preserved.");
    } catch (cause) {
      if (mounted.current) setError(cause.message || "Unable to stop browser");
    } finally {
      if (mounted.current) setStopping("");
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-[14px] border border-border bg-surface p-4 sm:p-5">
        <div className="mb-4 flex items-start gap-3">
          <span aria-hidden="true" className="material-symbols-outlined rounded-[10px] bg-primary/10 p-2 text-primary">language</span>
          <div><h2 className="text-base font-semibold text-text-main">Browser workspace</h2><p className="mt-1 text-sm text-text-muted">Open a persistent browser without connecting a provider. Sign-ins stay in the selected profile.</p></div>
        </div>
        <BrowserProfilePicker value={profile} onChange={setProfile} disabled={launching} onAvailabilityChange={(item) => setAvailable(Boolean(item && !item.busy))} />
        <form onSubmit={launch} className="mt-4 flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs font-medium text-text-muted">Launch URL
            <input type="url" required maxLength={4096} value={url} disabled={launching} onChange={(event) => setUrl(event.target.value)} className="h-9 min-w-0 rounded-[10px] border border-border bg-surface-2 px-3 text-sm text-text-main outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50" />
          </label>
          <Button type="submit" icon="open_in_browser" loading={launching} disabled={!available || loading}>Launch browser</Button>
        </form>
        <p className="mt-3 text-xs text-text-muted">Each browser runs for up to 30 minutes. Leaving this page only disconnects the viewer; return to resume, or choose Stop browser to release the profile. Provider credentials are not captured here.</p>
      </section>
      {error && <p role="alert" className="rounded-[10px] border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-500">{error}</p>}
      {pollError && <div role="alert" className="flex items-center gap-3 rounded-[10px] border border-border bg-surface-2 p-3 text-sm text-text-muted"><span className="flex-1">{pollError}. Session status may be out of date.</span><Button type="button" variant="secondary" icon="refresh" className={iconClass} aria-label="Refresh browser sessions" title="Refresh browser sessions" onClick={() => refresh()} /></div>}
      {notice && <p role="status" className="text-sm text-text-muted">{notice}</p>}
      <section className="space-y-3" aria-label="Browser sessions">
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-text-main">Active browsers <span className="ml-1 text-text-muted">{sessions.length}</span></h2><Button type="button" variant="ghost" icon="refresh" className={iconClass} aria-label="Refresh browser sessions" title="Refresh browser sessions" onClick={() => refresh()} /></div>
        {loading ? <p role="status" className="text-sm text-text-muted">Loading browser sessions…</p> : !sessions.length && <div className="rounded-[12px] border border-dashed border-border p-6 text-center text-sm text-text-muted">No browsers running. Choose a profile and launch a browser above.</div>}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {sessions.map((session) => <div key={session.id} className={`flex flex-wrap items-center gap-2 rounded-[12px] border bg-surface p-3 ${selectedId === session.id ? "border-primary" : "border-border"}`}>
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-text-main">{session.profile}</div><div className="text-xs text-text-muted">{session.status}</div>{session.error && <p role="alert" className="mt-1 break-words text-xs text-red-500">{session.error}</p>}</div>
            <Button type="button" variant="secondary" size="sm" icon="connected_tv" disabled={terminal(session.status) || stopping === session.id} onClick={() => { setSelectedId(session.id); setViewerAttempt((value) => value + 1); setNotice(""); }}>{selectedId === session.id ? "Reconnect" : "Open viewer"}</Button>
            <Button type="button" variant="danger" size="sm" loading={stopping === session.id} disabled={Boolean(stopping)} onClick={() => stop(session.id)}>Stop browser</Button>
          </div>)}
        </div>
      </section>
      {selected && !terminal(selected.status) && <section ref={viewerRef} className="flex h-auto scroll-mt-4 flex-col gap-2 sm:h-[min(850px,calc(100dvh-100px))] sm:min-h-[320px]" aria-label="Selected browser viewer">
        <div className="flex shrink-0 items-center justify-between gap-2"><h2 className="min-w-0 truncate text-sm font-semibold text-text-main">{selected.profile}</h2><Button type="button" variant="ghost" icon="close" className={iconClass} aria-label="Disconnect viewer without stopping browser" title="Disconnect viewer; browser keeps running" onClick={() => setSelectedId("")} /></div>
        {selected.viewer?.token ? <RemoteLoginBrowser key={`${selected.id}:${viewerAttempt}`} token={selected.viewer.token} allowNavigation /> : <div role="status" className="flex min-h-0 flex-1 items-center justify-center rounded-[12px] border border-border bg-surface-2 text-sm text-text-muted">Opening browser viewer…</div>}
      </section>}
    </div>
  );
}
