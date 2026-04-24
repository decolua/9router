"use client";

import React, { useState, useRef } from "react";
import { 
  Desktop, 
  Sun, 
  Moon, 
  CircleHalf, 
  Shield, 
  Signpost, 
  WifiHigh, 
  Pulse,
  Download,
  Upload
} from "@phosphor-icons/react";
import { Card, Button, Toggle, Input } from "@/shared/components";
import { useTheme } from "@/shared/hooks/useTheme";
import { cn } from "@/lib/utils";
import { APP_CONFIG } from "@/shared/constants/config";

interface Settings {
  fallbackStrategy: string;
  outboundProxyEnabled: boolean;
  outboundProxyUrl: string;
  outboundNoProxy: string;
  requireLogin: boolean;
  hasPassword?: boolean;
  enableObservability: boolean;
  stickyRoundRobinLimit: number;
  comboStrategy: string;
  tunnelUrl?: string;
  tailscaleUrl?: string;
  password?: string;
}

interface ProfilePageClientProps {
  initialData: {
    settings: Settings;
    machineId: string;
  };
}

export default function ProfilePageClient({ initialData }: ProfilePageClientProps) {
 const { theme, setTheme } = useTheme();
 const [settings, setSettings] = useState<Settings>(initialData?.settings || { fallbackStrategy: "fill-first", outboundProxyEnabled: false, outboundProxyUrl: "", outboundNoProxy: "", requireLogin: true, enableObservability: false, stickyRoundRobinLimit: 3, comboStrategy: "fallback" });
 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 const [loading, setLoading] = useState(false);
 const [passwords, setPasswords] = useState({ current: "", new: "", confirm: "" });
 const [passStatus, setPassStatus] = useState({ type: "", message: "" });
 const [passLoading, setPassLoading] = useState(false);
 const [dbLoading, setDbLoading] = useState(false);
 const [dbStatus, setDbStatus] = useState({ type: "", message: "" });
 const importFileRef = useRef<HTMLInputElement>(null);
 const [proxyForm, setProxyForm] = useState({
 outboundProxyEnabled: initialData?.settings?.outboundProxyEnabled === true,
 outboundProxyUrl: initialData?.settings?.outboundProxyUrl || "",
 outboundNoProxy: initialData?.settings?.outboundNoProxy || "",
 });
 const [proxyStatus, setProxyStatus] = useState({ type: "", message: "" });
 const [proxyLoading, setProxyLoading] = useState(false);
 const [proxyTestLoading, setProxyTestLoading] = useState(false);

 const updateOutboundProxy = async (e: React.FormEvent) => {
 e.preventDefault();
 if (settings.outboundProxyEnabled !== true) return;
 setProxyLoading(true);
 setProxyStatus({ type: "", message: "" });

 try {
 const res = await fetch("/api/settings", {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 outboundProxyUrl: proxyForm.outboundProxyUrl,
 outboundNoProxy: proxyForm.outboundNoProxy,
 }),
 });

 const data = await res.json();
 if (res.ok) {
 setSettings((prev) => ({ ...prev, ...data }));
 setProxyStatus({ type: "success", message: "Proxy settings applied" });
 } else {
 setProxyStatus({ type: "error", message: data.error || "Failed to update proxy settings" });
 }
 } catch {
 setProxyStatus({ type: "error", message: "An error occurred" });
 } finally {
 setProxyLoading(false);
 }
 };

 const testOutboundProxy = async () => {
 if (settings.outboundProxyEnabled !== true) return;

 const proxyUrl = (proxyForm.outboundProxyUrl || "").trim();
 if (!proxyUrl) {
 setProxyStatus({ type: "error", message: "Please enter a Proxy URL to test" });
 return;
 }

 setProxyTestLoading(true);
 setProxyStatus({ type: "", message: "" });

 try {
 const res = await fetch("/api/settings/proxy-test", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ proxyUrl }),
 });

 const data = await res.json();
 if (res.ok && data?.ok) {
 setProxyStatus({
 type: "success",
 message: `Proxy test OK (${data.status}) in ${data.elapsedMs}ms`,
 });
 } else {
 setProxyStatus({
 type: "error",
 message: data?.error || "Proxy test failed",
 });
 }
 } catch {
 setProxyStatus({ type: "error", message: "An error occurred" });
 } finally {
 setProxyTestLoading(false);
 }
 };

 const updateOutboundProxyEnabled = async (outboundProxyEnabled: boolean) => {
 setProxyLoading(true);
 setProxyStatus({ type: "", message: "" });

 try {
 const res = await fetch("/api/settings", {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ outboundProxyEnabled }),
 });

 const data = await res.json();
 if (res.ok) {
 setSettings((prev) => ({ ...prev, ...data }));
 setProxyForm((prev) => ({ ...prev, outboundProxyEnabled: data?.outboundProxyEnabled === true }));
 setProxyStatus({
 type: "success",
 message: outboundProxyEnabled ? "Proxy enabled" : "Proxy disabled",
 });
 } else {
 setProxyStatus({ type: "error", message: data.error || "Failed to update proxy settings" });
 }
 } catch {
 setProxyStatus({ type: "error", message: "An error occurred" });
 } finally {
 setProxyLoading(false);
 }
 };

 const handlePasswordChange = async (e: React.FormEvent) => {
 e.preventDefault();
 if (passwords.new !== passwords.confirm) {
 setPassStatus({ type: "error", message: "Passwords do not match" });
 return;
 }

 setPassLoading(true);
 setPassStatus({ type: "", message: "" });

 try {
 const res = await fetch("/api/settings", {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 currentPassword: passwords.current,
 newPassword: passwords.new,
 }),
 });

 const data = await res.json();

 if (res.ok) {
 setPassStatus({ type: "success", message: "Password updated successfully" });
 setPasswords({ current: "", new: "", confirm: "" });
 } else {
 setPassStatus({ type: "error", message: data.error || "Failed to update password" });
 }
 } catch {
 setPassStatus({ type: "error", message: "An error occurred" });
 } finally {
 setPassLoading(false);
 }
 };

 const updateFallbackStrategy = async (strategy: string) => {
 try {
 const res = await fetch("/api/settings", {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ fallbackStrategy: strategy }),
 });
 if (res.ok) {
 setSettings(prev => ({ ...prev, fallbackStrategy: strategy }));
 }
 } catch (err) {
 console.error("Failed to update settings:", err);
 }
 };

 const updateComboStrategy = async (strategy: string) => {
 try {
 const res = await fetch("/api/settings", {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ comboStrategy: strategy }),
 });
 if (res.ok) {
 setSettings(prev => ({ ...prev, comboStrategy: strategy }));
 }
 } catch (err) {
 console.error("Failed to update combo strategy:", err);
 }
 };

 const updateStickyLimit = async (limit: string) => {
 const numLimit = parseInt(limit);
 if (isNaN(numLimit) || numLimit < 1) return;

 try {
 const res = await fetch("/api/settings", {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ stickyRoundRobinLimit: numLimit }),
 });
 if (res.ok) {
 setSettings(prev => ({ ...prev, stickyRoundRobinLimit: numLimit }));
 }
 } catch (err) {
 console.error("Failed to update sticky limit:", err);
 }
 };

 const updateRequireLogin = async (requireLogin: boolean) => {
 try {
 const res = await fetch("/api/settings", {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ requireLogin }),
 });
 if (res.ok) {
 setSettings(prev => ({ ...prev, requireLogin }));
 }
 } catch (err) {
 console.error("Failed to update require login:", err);
 }
 };

 const updateObservabilityEnabled = async (enabled: boolean) => {
 try {
 const res = await fetch("/api/settings", {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ enableObservability: enabled }),
 });
 if (res.ok) {
 setSettings(prev => ({ ...prev, enableObservability: enabled }));
 }
 } catch (err) {
 console.error("Failed to update enableObservability:", err);
 }
 };

 const reloadSettings = async () => {
 try {
 const res = await fetch("/api/settings");
 if (!res.ok) return;
 const data = await res.json();
 setSettings(data);
 } catch (err) {
 console.error("Failed to reload settings:", err);
 }
 };

 const handleExportDatabase = async () => {
 setDbLoading(true);
 setDbStatus({ type: "", message: "" });
 try {
 const res = await fetch("/api/settings/database");
 if (!res.ok) {
 const data = await res.json().catch(() => ({}));
 throw new Error(data.error || "Failed to export database");
 }

 const payload = await res.json();
 const content = JSON.stringify(payload, null, 2);
 const blob = new Blob([content], { type: "application/json" });
 const url = URL.createObjectURL(blob);
 const anchor = document.createElement("a");
 const stamp = new Date().toISOString().replace(/[.:]/g, "-");
 anchor.href = url;
 anchor.download = `8router-backup-${stamp}.json`;
 document.body.appendChild(anchor);
 anchor.click();
 document.body.removeChild(anchor);
 URL.revokeObjectURL(url);

 setDbStatus({ type: "success", message: "Database backup downloaded" });
 } catch (err: any) {
 setDbStatus({ type: "error", message: err.message || "Failed to export database" });
 } finally {
 setDbLoading(false);
 }
 };

 const handleImportDatabase = async (event: React.ChangeEvent<HTMLInputElement>) => {
 const file = event.target.files?.[0];
 if (!file) return;

 setDbLoading(true);
 setDbStatus({ type: "", message: "" });

 try {
 const raw = await file.text();
 const payload = JSON.parse(raw);

 const res = await fetch("/api/settings/database", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(payload),
 });

 const data = await res.json().catch(() => ({}));
 if (!res.ok) {
 throw new Error(data.error || "Failed to import database");
 }

 await reloadSettings();
 setDbStatus({ type: "success", message: "Database imported successfully" });
 } catch (err: any) {
 setDbStatus({ type: "error", message: err.message || "Invalid backup file" });
 } finally {
 if (importFileRef.current) {
 importFileRef.current.value = "";
 }
 setDbLoading(false);
 }
 };

 const observabilityEnabled = settings.enableObservability === true;

 return (
 <div className="max-w-2xl mx-auto">
 <div className="flex flex-col gap-6">
 {/* Local Mode Info */}
 <Card>
 <div className="flex items-center justify-between mb-4">
 <div className="flex items-center gap-4">
 <div className="size-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
 <Desktop className="size-6" weight="bold" />
 </div>
 <div>
 <h2 className="text-xl font-semibold">Local Mode</h2>
 <p className="text-muted-foreground">Running on your machine</p>
 <p className="text-xs font-mono opacity-50">ID: {initialData?.machineId}</p>
 </div>
 </div>
 <div className="inline-flex p-1 rounded-lg bg-black/5 dark:bg-white/5">
 {["light", "dark", "system"].map((option) => (
 <button
 key={option}
 type="button"
 onClick={() => setTheme(option as any)}
 className={cn(
 "flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-all",
 theme === option
 ? "bg-white dark:bg-white/10 text-foreground"
 : "text-muted-foreground hover:text-foreground"
 )}
 >
 {option === "light" && <Sun className="size-4.5" weight={theme === option ? "fill" : "bold"} />}
 {option === "dark" && <Moon className="size-4.5" weight={theme === option ? "fill" : "bold"} />}
 {option === "system" && <CircleHalf className="size-4.5" weight={theme === option ? "fill" : "bold"} />}
 <span className="capitalize text-sm">{option}</span>
 </button>
 ))}
 </div>
 </div>
 <div className="flex flex-col gap-3 pt-4 border-t border-border/50">
 <div className="flex items-center justify-between p-3 rounded-lg bg-muted/5 border border-border/50">
 <div>
 <p className="font-medium">Database Location</p>
 <p className="text-sm text-muted-foreground font-mono">~/.8router/db.json</p>
 </div>
 </div>
 <div className="flex flex-wrap gap-2">
 <Button
 variant="secondary"
 onClick={handleExportDatabase}
 disabled={dbLoading}
 >
 <Download className="size-4 mr-2" weight="bold" />
 Download Backup
 </Button>
 <Button
 variant="outline"
 onClick={() => importFileRef.current?.click()}
 disabled={dbLoading}
 >
 <Upload className="size-4 mr-2" weight="bold" />
 Import Backup
 </Button>
 <input
 ref={importFileRef}
 type="file"
 accept="application/json,.json"
 className="hidden"
 onChange={handleImportDatabase}
 />
 </div>
 {dbStatus.message && (
 <p className={cn("text-sm", dbStatus.type === "error" ? "text-destructive" : "text-primary dark:text-primary")}>
 {dbStatus.message}
 </p>
 )}
 </div>
 </Card>

 {/* Security */}
 <Card>
 <div className="flex items-center gap-3 mb-4">
 <div className="p-2 rounded-lg bg-primary/10 text-primary">
 <Shield className="size-5" weight="bold" />
 </div>
 <h3 className="text-lg font-semibold">Security</h3>
 </div>
 <div className="flex flex-col gap-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="font-medium">Require login</p>
 <p className="text-sm text-muted-foreground">
 When ON, dashboard requires password. When OFF, access without login.
 </p>
 </div>
 <Toggle
 checked={settings.requireLogin === true}
 onCheckedChange={() => updateRequireLogin(!settings.requireLogin)}
 />
 </div>
 {settings.requireLogin === true && (
 <form onSubmit={handlePasswordChange} className="flex flex-col gap-4 pt-4 border-t border-border/50">
 {settings.hasPassword && (
 <div className="flex flex-col gap-2">
 <label className="text-sm font-medium">Current Password</label>
 <Input
 type="password"
 placeholder="Enter current password"
 value={passwords.current}
 onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
 required
 />
 </div>
 )}
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <div className="flex flex-col gap-2">
 <label className="text-sm font-medium">New Password</label>
 <Input
 type="password"
 placeholder="Enter new password"
 value={passwords.new}
 onChange={(e) => setPasswords({ ...passwords, new: e.target.value })}
 required
 />
 </div>
 <div className="flex flex-col gap-2">
 <label className="text-sm font-medium">Confirm New Password</label>
 <Input
 type="password"
 placeholder="Confirm new password"
 value={passwords.confirm}
 onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
 required
 />
 </div>
 </div>

 {passStatus.message && (
 <p className={cn("text-sm", passStatus.type === "error" ? "text-destructive" : "text-primary")}>
 {passStatus.message}
 </p>
 )}

 <div className="pt-2">
 <Button type="submit" disabled={passLoading}>
 {passLoading ? "Updating..." : (settings.hasPassword ? "Update Password" : "Set Password")}
 </Button>
 </div>
 </form>
 )}
 </div>
 </Card>

 {/* Routing Preferences */}
 <Card>
 <div className="flex items-center gap-3 mb-4">
 <div className="p-2 rounded-lg bg-primary/10 text-primary">
 <Signpost className="size-5" weight="bold" />
 </div>
 <h3 className="text-lg font-semibold">Routing Strategy</h3>
 </div>
 <div className="flex flex-col gap-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="font-medium">Round Robin</p>
 <p className="text-sm text-muted-foreground">
 Cycle through accounts to distribute load
 </p>
 </div>
 <Toggle
 checked={settings.fallbackStrategy === "round-robin"}
 onCheckedChange={() => updateFallbackStrategy(settings.fallbackStrategy === "round-robin" ? "fill-first" : "round-robin")}
 />
 </div>

 {/* Sticky Round Robin Limit */}
 {settings.fallbackStrategy === "round-robin" && (
 <div className="flex items-center justify-between pt-2 border-t border-border/50">
 <div>
 <p className="font-medium">Sticky Limit</p>
 <p className="text-sm text-muted-foreground">
 Calls per account before switching
 </p>
 </div>
 <Input
 type="number"
 min="1"
 max="10"
 value={settings.stickyRoundRobinLimit || 3}
 onChange={(e) => updateStickyLimit(e.target.value)}
 className="w-20 text-center"
 />
 </div>
 )}

 {/* Combo Round Robin */}
 <div className="flex items-center justify-between pt-4 border-t border-border/50">
 <div>
 <p className="font-medium">Combo Round Robin</p>
 <p className="text-sm text-muted-foreground">
 Cycle through providers in combos instead of always starting with first
 </p>
 </div>
 <Toggle
 checked={settings.comboStrategy === "round-robin"}
 onCheckedChange={() => updateComboStrategy(settings.comboStrategy === "round-robin" ? "fallback" : "round-robin")}
 />
 </div>

 <p className="text-xs text-muted-foreground italic pt-2 border-t border-border/50">
 {settings.fallbackStrategy === "round-robin"
 ? `Currently distributing requests across all available accounts with ${settings.stickyRoundRobinLimit || 3} calls per account.`
 : "Currently using accounts in priority order (Fill First)."}
 </p>
 </div>
 </Card>

 {/* Network */}
 <Card>
 <div className="flex items-center gap-3 mb-4">
 <div className="p-2 rounded-lg bg-primary/10 text-primary">
 <WifiHigh className="size-5" weight="bold" />
 </div>
 <h3 className="text-lg font-semibold">Network</h3>
 </div>

 <div className="flex flex-col gap-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="font-medium">Outbound Proxy</p>
 <p className="text-sm text-muted-foreground">Enable proxy for OAuth + provider outbound requests.</p>
 </div>
 <Toggle
 checked={settings.outboundProxyEnabled === true}
 onCheckedChange={() => updateOutboundProxyEnabled(!(settings.outboundProxyEnabled === true))}
 />
 </div>

 {settings.outboundProxyEnabled === true && (
 <form onSubmit={updateOutboundProxy} className="flex flex-col gap-4 pt-2 border-t border-border/50">
 <div className="flex flex-col gap-2">
 <label className="font-medium">Proxy URL</label>
 <Input
 placeholder="http://127.0.0.1:7897"
 value={proxyForm.outboundProxyUrl}
 onChange={(e) => setProxyForm((prev) => ({ ...prev, outboundProxyUrl: e.target.value }))}
 />
 <p className="text-sm text-muted-foreground">Leave empty to inherit existing env proxy (if any).</p>
 </div>

 <div className="flex flex-col gap-2 pt-2 border-t border-border/50">
 <label className="font-medium">No Proxy</label>
 <Input
 placeholder="localhost,127.0.0.1"
 value={proxyForm.outboundNoProxy}
 onChange={(e) => setProxyForm((prev) => ({ ...prev, outboundNoProxy: e.target.value }))}
 />
 <p className="text-sm text-muted-foreground">Comma-separated hostnames/domains to bypass the proxy.</p>
 </div>

 <div className="pt-2 border-t border-border/50 flex items-center gap-2">
 <Button
 type="button"
 variant="secondary"
 disabled={proxyTestLoading}
 onClick={testOutboundProxy}
 >
 {proxyTestLoading ? "Testing..." : "Test proxy URL"}
 </Button>
 <Button type="submit" disabled={proxyLoading}>
 {proxyLoading ? "Applying..." : "Apply"}
 </Button>
 </div>
 </form>
 )}

 {proxyStatus.message && (
 <p className={cn("text-sm pt-2 border-t border-border/50", proxyStatus.type === "error" ? "text-destructive" : "text-primary")}>
 {proxyStatus.message}
 </p>
 )}
 </div>
 </Card>

 {/* Observability Settings */}
 <Card>
 <div className="flex items-center gap-3 mb-4">
 <div className="p-2 rounded-lg bg-muted/30 text-muted-foreground">
 <Pulse className="size-5" weight="bold" />
 </div>
 <h3 className="text-lg font-semibold">Observability</h3>
 </div>
 <div className="flex items-center justify-between">
 <div>
 <p className="font-medium">Enable Observability</p>
 <p className="text-sm text-muted-foreground">
 Record request details for inspection in the logs view
 </p>
 </div>
 <Toggle
 checked={observabilityEnabled}
 onCheckedChange={updateObservabilityEnabled}
 />
 </div>
 </Card>

 {/* App Info */}
 <div className="text-center text-sm text-muted-foreground py-4">
 <p>{APP_CONFIG.name} v{APP_CONFIG.version}</p>
 <p className="mt-1">Local Mode - All data stored on your machine</p>
 </div>
 </div>
 </div>
 );
}
