"use client";

import { useState } from "react";
import { fetchSettings, patchSettings } from "../services/endpointApiService";

export function useEndpointSettings() {
  const [requireApiKey, setRequireApiKey] = useState(false);
  const [requireLogin, setRequireLogin] = useState(true);
  const [hasPassword, setHasPassword] = useState(true);
  const [tunnelDashboardAccess, setTunnelDashboardAccess] = useState(false);
  const [rtkEnabled, setRtkEnabledState] = useState(true);
  const [cavemanEnabled, setCavemanEnabled] = useState(false);
  const [cavemanLevel, setCavemanLevel] = useState("full");
  const [autoRetryOverloaded, setAutoRetryOverloaded] = useState(true);
  const [maxRetryAttempts, setMaxRetryAttempts] = useState(3);
  const [retryDelayMs, setRetryDelayMs] = useState(2000);
  const [midStreamResumeEnabled, setMidStreamResumeEnabled] = useState(true);

  const applySettings = async () => {
    const { ok, data } = await fetchSettings();
    if (!ok) return;
    setRequireApiKey(data.requireApiKey || false);
    setRequireLogin(data.requireLogin !== false);
    setHasPassword(data.hasPassword || false);
    setTunnelDashboardAccess(data.tunnelDashboardAccess || false);
    setRtkEnabledState(data.rtkEnabled !== false);
    setCavemanEnabled(!!data.cavemanEnabled);
    setCavemanLevel(data.cavemanLevel || "full");
    setAutoRetryOverloaded(data.autoRetryOverloaded !== false);
    setMaxRetryAttempts(data.maxRetryAttempts ?? 3);
    setRetryDelayMs(data.retryDelayMs ?? 2000);
    setMidStreamResumeEnabled(data.midStreamResumeEnabled !== false);
  };

  const handleTunnelDashboardAccess = async (value) => {
    try {
      const { ok } = await patchSettings({ tunnelDashboardAccess: value });
      if (ok) setTunnelDashboardAccess(value);
    } catch (error) {
      console.log("Error updating tunnelDashboardAccess:", error);
    }
  };

  const handleRequireApiKey = async (value) => {
    try {
      const { ok } = await patchSettings({ requireApiKey: value });
      if (ok) setRequireApiKey(value);
    } catch (error) {
      console.log("Error updating requireApiKey:", error);
    }
  };

  const handleRtkEnabled = async (value) => {
    try {
      const { ok } = await patchSettings({ rtkEnabled: value });
      if (ok) setRtkEnabledState(value);
    } catch (error) {
      console.log("Error updating rtkEnabled:", error);
    }
  };

  const handleAutoRetryOverloaded = async (value) => {
    try {
      const { ok } = await patchSettings({ autoRetryOverloaded: value });
      if (ok) setAutoRetryOverloaded(value);
    } catch (error) {
      console.log("Error updating autoRetryOverloaded:", error);
    }
  };

  const handleMaxRetryAttempts = async (value) => {
    const val = parseInt(value, 10) || 1;
    try {
      const { ok } = await patchSettings({ maxRetryAttempts: val });
      if (ok) setMaxRetryAttempts(val);
    } catch (error) {
      console.log("Error updating maxRetryAttempts:", error);
    }
  };

  const handleRetryDelayMs = async (value) => {
    const val = parseInt(value, 10) || 1000;
    try {
      const { ok } = await patchSettings({ retryDelayMs: val });
      if (ok) setRetryDelayMs(val);
    } catch (error) {
      console.log("Error updating retryDelayMs:", error);
    }
  };

  const handleMidStreamResumeEnabled = async (value) => {
    try {
      const { ok } = await patchSettings({ midStreamResumeEnabled: value });
      if (ok) setMidStreamResumeEnabled(value);
    } catch (error) {
      console.log("Error updating midStreamResumeEnabled:", error);
    }
  };

  const patchSetting = async (patch) => {
    try {
      await patchSettings(patch);
    } catch (error) {
      console.log("Error updating setting:", error);
    }
  };

  const handleCavemanEnabled = (value) => {
    setCavemanEnabled(value);
    patchSetting({ cavemanEnabled: value });
  };

  const handleCavemanLevel = (level) => {
    setCavemanLevel(level);
    patchSetting({ cavemanLevel: level });
  };

  return {
    requireApiKey,
    requireLogin,
    hasPassword,
    tunnelDashboardAccess,
    rtkEnabled,
    cavemanEnabled,
    cavemanLevel,
    autoRetryOverloaded,
    maxRetryAttempts,
    retryDelayMs,
    midStreamResumeEnabled,
    applySettings,
    handleTunnelDashboardAccess,
    handleRequireApiKey,
    handleRtkEnabled,
    handleAutoRetryOverloaded,
    handleMaxRetryAttempts,
    handleRetryDelayMs,
    handleMidStreamResumeEnabled,
    handleCavemanEnabled,
    handleCavemanLevel,
  };
}
