"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export default function useLiveRoutes({ paused = false } = {}) {
  const [records, setRecords] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [status, setStatus] = useState("reconnecting");
  const retryRef = useRef(0);
  const sourceRef = useRef(null);
  const timerRef = useRef(null);
  const connectRef = useRef(null);

  const connect = useCallback(() => {
    if (paused || typeof window === "undefined") return;
    if (sourceRef.current) sourceRef.current.close();
    setStatus(retryRef.current ? "reconnecting" : "connecting");
    const source = new EventSource("/api/usage/live");
    sourceRef.current = source;
    source.onopen = () => { retryRef.current = 0; setStatus("connected"); };
    source.addEventListener("snapshot", event => {
      try {
        const data = JSON.parse(event.data);
        setRecords(data.records || []);
        setAccounts(data.accounts || []);
      } catch { /* reconnect will provide a clean snapshot */ }
    });
    const apply = event => {
      try {
        const record = JSON.parse(event.data);
        setRecords(current => {
          const next = current.filter(item => item.id !== record.id);
          return event.type === "end" ? [...next, record] : [...next, record];
        });
      } catch { /* ignore malformed event */ }
    };
    source.addEventListener("start", apply);
    source.addEventListener("update", apply);
    source.addEventListener("end", apply);
    source.onerror = () => {
      source.close();
      sourceRef.current = null;
      if (paused) return;
      setStatus("reconnecting");
      const delay = Math.min(15_000, 500 * 2 ** retryRef.current++);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => connectRef.current?.(), delay);
    };
  }, [paused]);
  useEffect(() => { connectRef.current = connect; }, [connect]);

  useEffect(() => {
    if (paused) {
      sourceRef.current?.close();
      sourceRef.current = null;
      clearTimeout(timerRef.current);
      return undefined;
    }
    connect();
    return () => {
      sourceRef.current?.close();
      sourceRef.current = null;
      clearTimeout(timerRef.current);
    };
  }, [connect, paused]);

  return { records, accounts, status: paused ? "paused" : status, reconnect: connect };
}
