"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/shared/components";

const modifiers = (event) => (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
const buttonName = (button) => ["left", "middle", "right"][button] || "none";

export default function RemoteLoginBrowser({ token, allowNavigation = false }) {
  const socketRef = useRef(null);
  const surfaceRef = useRef(null);
  const keysRef = useRef(new Map());
  const pointerRef = useRef(null);
  const viewportRef = useRef(null);
  const helpId = useId();
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });
  const [address, setAddress] = useState("");
  const [connection, setConnection] = useState("Connecting");
  const [error, setError] = useState("");
  const previousTokenRef = useRef(token);
  const [frame, setFrame] = useState(null);
  const [pages, setPages] = useState([]);
  const [activePageId, setActivePageId] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [text, setText] = useState("");

  const connected = connection === "Connected";
  const iconClass = "h-9 w-9 shrink-0 !p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
  const activePageUrl = pages.find((page) => page.id === activePageId)?.url || "";

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setViewport({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setAddress(activePageUrl);
  }, [activePageUrl]);
  const send = (message) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 65536) socket.send(JSON.stringify(message));
  };

  useEffect(() => {
    let disposed = false;
    if (previousTokenRef.current !== token) { setText(""); previousTokenRef.current = token; }
    setConnection("Connecting");
    setError("");
    setFrame(null);
    setPages([]);
    setActivePageId("");
    const url = new URL("/api/providers/web-login/view", window.location.href);
    url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", token);
    const socket = new WebSocket(url);
    socketRef.current = socket;
    socket.onopen = () => { if (!disposed) setConnection("Connected"); };
    socket.onmessage = ({ data }) => {
      if (disposed || typeof data !== "string" || data.length > 8 * 1024 * 1024) return;
      try {
        const message = JSON.parse(data);
        if (message.type === "frame" && typeof message.data === "string" && message.width === 1280 && message.height === 800) {
          setFrame(`data:image/jpeg;base64,${message.data}`);
        } else if (message.type === "pages" && Array.isArray(message.pages)) {
          setPages(message.pages.filter((page) => typeof page.id === "string"));
          setActivePageId(message.activePageId || "");
        } else if (message.type === "error") {
          setError(typeof message.error === "string" ? message.error : "Browser connection failed");
        }
      } catch { setError("Invalid browser response"); }
    };
    socket.onerror = () => { if (!disposed) setError("Unable to connect to the browser. Try reconnecting."); };
    socket.onclose = () => { if (!disposed) setConnection("Disconnected"); };
    return () => {
      disposed = true;
      pointerRef.current = null;
      keysRef.current.clear();
      socketRef.current = null;
      socket.close();
    };
  }, [token, attempt]);

  useEffect(() => {
    const surface = surfaceRef.current;
    const wheel = (event) => {
      if (document.activeElement !== surface) return;
      event.preventDefault();
      const rect = surface.getBoundingClientRect();
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 800 : 1;
      send({ type: "wheel", x: Math.max(0, Math.min(1279, (event.clientX - rect.left) * 1280 / rect.width)), y: Math.max(0, Math.min(799, (event.clientY - rect.top) * 800 / rect.height)), deltaX: event.deltaX * scale, deltaY: event.deltaY * scale, modifiers: modifiers(event) });
    };
    surface.addEventListener("wheel", wheel, { passive: false });
    return () => surface.removeEventListener("wheel", wheel);
  }, []);

  const mouse = (event, kind) => {
    if (kind === "mousePressed") {
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (document.activeElement !== event.currentTarget) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const message = { type: "mouse", event: kind, x: Math.max(0, Math.min(1279, (event.clientX - rect.left) * 1280 / rect.width)), y: Math.max(0, Math.min(799, (event.clientY - rect.top) * 800 / rect.height)), button: kind === "mouseMoved" ? (event.buttons & 1 ? "left" : event.buttons & 2 ? "right" : event.buttons & 4 ? "middle" : "none") : buttonName(event.button), clickCount: event.detail >= 2 ? 2 : 1, modifiers: modifiers(event) };
    if (kind === "mousePressed" || (kind === "mouseMoved" && pointerRef.current)) pointerRef.current = message;
    if (kind === "mouseReleased") pointerRef.current = null;
    send(message);
  };

  const key = (event, kind) => {
    if (event.key === "Tab" || event.isComposing || event.nativeEvent.isComposing) return;
    // Native paste supplies clipboard text through onPaste, never a remote shortcut.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") return;
    event.preventDefault();
    event.stopPropagation();
    if (Array.from(event.key).length === 1 && ((!event.ctrlKey && !event.metaKey && !event.altKey) || event.getModifierState("AltGraph"))) {
      if (kind === "keyDown") send({ type: "text", text: event.key });
      return;
    }
    const message = { type: "key", event: kind, key: event.key, code: event.code, modifiers: modifiers(event), windowsVirtualKeyCode: event.keyCode || event.which || 0 };
    if (kind === "keyDown") keysRef.current.set(event.code, message);
    else keysRef.current.delete(event.code);
    send(message);
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-border bg-surface-2" aria-label="Remote browser">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border-subtle p-1.5" aria-label="Browser pages">
        {!pages.length && <span className="px-2 py-1 text-xs text-text-muted">Waiting for browser pages…</span>}
        {pages.map((page) => <Button key={page.id} type="button" size="sm" variant={activePageId === page.id ? "secondary" : "ghost"} aria-pressed={activePageId === page.id} title={page.url || page.title || "Untitled page"} disabled={!connected} className="max-w-56 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => send({ type: "page", id: page.id })}><span className="material-symbols-outlined text-[16px]" aria-hidden="true">language</span><span className="truncate">{page.title || page.url || "Untitled page"}</span></Button>)}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border-subtle p-1.5">
        <Button type="button" variant="ghost" icon="arrow_back" className={iconClass} aria-label="Go back" title="Go back" onClick={() => send({ type: "back" })} disabled={!connected} />
        <Button type="button" variant="ghost" icon="refresh" className={iconClass} aria-label="Reload page" title="Reload page" onClick={() => send({ type: "reload" })} disabled={!connected} />
        {allowNavigation && <form className="order-last flex w-full min-w-0 gap-1 sm:order-none sm:w-auto sm:flex-1" onSubmit={(event) => {
          event.preventDefault();
          try {
            const url = new URL(address);
            if (address.length > 4096 || !["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Enter an HTTP or HTTPS address without embedded credentials.");
            setError("");
            send({ type: "navigate", url: url.href });
            surfaceRef.current?.focus();
          } catch { setError("Enter an HTTP or HTTPS address without embedded credentials."); }
        }}>
          <input aria-label="Browser address" type="url" required maxLength={4096} value={address} onChange={(event) => setAddress(event.target.value)} disabled={!connected} placeholder="https://www.google.com" className="h-9 min-w-0 flex-1 rounded-[10px] border border-border bg-surface px-3 text-xs text-text-main outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50" />
          <Button type="submit" variant="secondary" icon="arrow_forward" className={iconClass} aria-label="Navigate to address" title="Navigate to address" disabled={!connected || !address} />
        </form>}
        <div role="status" className="ml-auto flex items-center gap-1.5 px-2 text-xs text-text-muted"><span aria-hidden="true" className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : connection === "Connecting" ? "animate-pulse bg-amber-500" : "bg-text-muted"}`} />{connection}</div>
        <Button type="button" variant="ghost" icon="sync" className={iconClass} aria-label="Reconnect browser viewer" title="Reconnect browser viewer" disabled={connection === "Connecting"} onClick={() => setAttempt((value) => value + 1)} />
      </div>
      {error && <p role="alert" className="shrink-0 px-3 py-1 text-xs text-red-500">{error}</p>}
      <details className="shrink-0 border-b border-border-subtle px-3 py-1.5 text-xs text-text-muted">
        <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Keyboard help & text input</summary>
        <p id={helpId} className="py-2">Click the browser to type, scroll, or paste. Tab leaves the viewer; use the button below to move between fields inside it. Select a page tab above to open a popup.</p>
        <form className="mb-2 flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault();
          if (!text || !connected) return;
          const characters = Array.from(text);
          for (let offset = 0; offset < characters.length; offset += 1024) send({ type: "text", text: characters.slice(offset, offset + 1024).join("") });
          setText("");
        }}>
          <label className="flex min-w-0 flex-1 flex-col gap-1">Text for the selected field
            <input type="password" value={text} disabled={!connected} maxLength={4096} autoComplete="off" spellCheck={false} onChange={(event) => setText(event.target.value)} className="h-9 rounded-[10px] border border-border bg-surface px-3 text-text-main outline-none focus:ring-2 focus:ring-primary disabled:opacity-50" />
          </label>
          <Button type="submit" variant="secondary" icon="send" className={iconClass} aria-label="Send text to browser" title="Send text to browser" disabled={!text || !connected} />
          <Button type="button" variant="secondary" icon="keyboard_tab" className={iconClass} aria-label="Send Tab to browser" title="Move to next browser field" disabled={!connected} onClick={() => {
            send({ type: "key", event: "keyDown", key: "Tab", code: "Tab", modifiers: 0, windowsVirtualKeyCode: 9 });
            send({ type: "key", event: "keyUp", key: "Tab", code: "Tab", modifiers: 0, windowsVirtualKeyCode: 9 });
            surfaceRef.current?.focus();
          }} />
        </form>
      </details>
      <div ref={viewportRef} className="flex aspect-[8/5] min-h-0 flex-none items-center justify-center overflow-hidden bg-black/90 sm:aspect-auto sm:flex-1">
      <div ref={surfaceRef} tabIndex={0} role="group" aria-label="Interactive remote browser" aria-describedby={helpId}
        className="relative shrink-0 overflow-hidden bg-black outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        style={{ width: Math.max(0, Math.min(viewport.width, viewport.height * 1.6)), aspectRatio: "1280 / 800", touchAction: "none" }}
        onPointerDown={(event) => mouse(event, "mousePressed")} onPointerUp={(event) => mouse(event, "mouseReleased")} onPointerMove={(event) => mouse(event, "mouseMoved")}
        onPointerCancel={() => { if (pointerRef.current) send({ ...pointerRef.current, event: "mouseReleased" }); pointerRef.current = null; }}
        onContextMenu={(event) => { if (document.activeElement === event.currentTarget) event.preventDefault(); }}
        onKeyDown={(event) => key(event, "keyDown")} onKeyUp={(event) => key(event, "keyUp")}
        onBlur={() => { for (const message of keysRef.current.values()) send({ ...message, event: "keyUp", modifiers: 0 }); keysRef.current.clear(); }}
        onPaste={(event) => { event.preventDefault(); const characters = Array.from(event.clipboardData.getData("text/plain")); for (let offset = 0; offset < characters.length; offset += 1024) send({ type: "text", text: characters.slice(offset, offset + 1024).join("") }); }}
        onCompositionEnd={(event) => { const characters = Array.from(event.data || ""); for (let offset = 0; offset < characters.length; offset += 1024) send({ type: "text", text: characters.slice(offset, offset + 1024).join("") }); }}>
        {frame ? <img src={frame} alt="Live remote browser page" draggable={false} className="pointer-events-none block h-full w-full select-none" /> : <span className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white"><span className="material-symbols-outlined animate-spin" aria-hidden="true">progress_activity</span>Waiting for browser image…</span>}
      </div>
      </div>
    </section>
  );
}
