"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTranslation } from "@/i18n/useTranslation";
import { Button, Card } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

const inputClass = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-primary";
const shellQuote = text => `'${text.replaceAll("'", "'\\''")}'`;
const subscribeToOrigin = () => () => {};
const readOrigin = () => window.location.origin;
const serverOrigin = () => "";

export default function ChatGPTPage() {
  const t = useTranslation();
  const [available, setAvailable] = useState([]);
  const [models, setModels] = useState([]);
  const [saved, setSaved] = useState([]);
  const [searchModels, setSearchModels] = useState([]);
  const [webSearchModel, setWebSearchModel] = useState("");
  const [savedWebSearchModel, setSavedWebSearchModel] = useState("");
  const [limit, setLimit] = useState(5);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const origin = useSyncExternalStore(subscribeToOrigin, readOrigin, serverOrigin);
  const { copied, copy } = useCopyToClipboard();
  const [copiedItem, setCopiedItem] = useState("");

  const load = useCallback(() => {
    return fetch("/api/chatgpt", { cache: "no-store" }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load models.");
      setAvailable(data.available);
      setModels(data.models.map(model => model.id));
      setSaved(data.models.map(model => model.id));
      setSearchModels(data.searchModels || []);
      setWebSearchModel(data.webSearchModel || "");
      setSavedWebSearchModel(data.webSearchModel || "");
      setLimit(data.limit);
    }).catch(error => setError(error.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  const dirty = JSON.stringify(models) !== JSON.stringify(saved) || webSearchModel !== savedWebSearchModel;
  const visible = useMemo(() => available.filter(model => `${model.id} ${model.name || ""}`.toLowerCase().includes(search.toLowerCase())), [available, search]);
  const endpoint = `${origin}/api/chatgpt/v1`;
  // Separate the closing subshell from the URL so zsh's url-quote-magic does not escape it on paste.
  const install = origin ? `(router_setup_dir=$(mktemp -d) && trap 'rm -rf "$router_setup_dir"' EXIT && curl -fsS ${shellQuote(`${origin}/9router-codex.mjs`)} -o "$router_setup_dir/install.mjs" && node "$router_setup_dir/install.mjs" enable --url ${shellQuote(endpoint)} )` : "";
  const helper = 'node "$HOME/.codex/9router-chatgpt/bridge.mjs"';

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/chatgpt", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ models, webSearchModel }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save models.");
      setSaved(data.models.map(model => model.id));
      setWebSearchModel(data.webSearchModel || "");
      setSavedWebSearchModel(data.webSearchModel || "");
      setNotice("Saved. Run sync on your computer and restart Codex to update the model picker.");
    } catch (error) { setError(error.message); }
    finally { setSaving(false); }
  }
  function toggle(id) {
    setNotice("");
    setModels(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  }
  function copyValue(id, text) { setCopiedItem(id); copy(text); }
  function errorMessage(message) {
    const limitError = /^Choose up to (\d+) distinct models\.$/.exec(message);
    if (limitError) return t("Choose up to {limit} distinct models.", { limit: limitError[1] });
    const modelError = /^(Model is no longer available|This model does not support tools): (.+)$/.exec(message);
    if (modelError) return t(`${modelError[1]}: {model}`, { model: modelError[2] });
    return t(message);
  }
  function command(id, text) {
    return <div className="flex items-start gap-2 rounded-lg border border-border-subtle bg-background p-3">
      <code className="min-w-0 flex-1 break-all text-xs leading-5 select-all">{text || t("Loading…")}</code>
      <Button variant="ghost" size="sm" icon={copied && copiedItem === id ? "check" : "content_copy"} aria-label={t("Copy {item}", { item: t(id) })} disabled={!text} onClick={() => copyValue(id, text)} />
    </div>;
  }

  return <div data-i18n-skip className="mx-auto max-w-5xl space-y-6 pb-10">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="mb-2 flex items-center gap-3">
          <span className="material-symbols-outlined rounded-xl bg-primary/10 p-2 text-primary">chat_bubble</span>
          <h1 className="text-2xl font-semibold text-text-main">ChatGPT</h1>
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">{t("Codex integration")}</span>
        </div>
        <p className="max-w-2xl text-sm text-text-muted">{t("Add 9router models to the same model picker as your native Codex models, in the desktop app and CLI.")}</p>
      </div>
      <Button variant="secondary" icon="refresh" loading={loading} disabled={dirty || saving} onClick={() => { setLoading(true); setError(""); load(); }}>{t("Refresh models")}</Button>
    </div>

    {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{errorMessage(error)}</div>}
    {notice && <div role="status" className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400">{t(notice)}</div>}

    <Card title={t("Models in Codex")} subtitle={t("Choose up to {limit} models or combos. Native models remain available.", { limit })}
      action={<Button onClick={save} loading={saving} disabled={!dirty || loading} icon="save">{t("Save models")}</Button>}>
      <div className="mb-4 flex min-h-14 flex-wrap items-center gap-2 rounded-lg border border-border bg-background p-3">
        {models.length === 0 ? <span className="text-sm text-text-muted">{t("No 9router models selected")}</span> : models.map(id =>
          <button key={id} type="button" onClick={() => toggle(id)} disabled={saving} aria-label={t("Remove {model}", { model: id })} className="flex max-w-full items-center gap-2 rounded-md bg-primary/10 px-2.5 py-1 text-sm text-primary hover:bg-primary/20">
            <span className="truncate">{id}</span><span aria-hidden="true">×</span>
          </button>)}
        <span className="ml-auto text-xs text-text-muted">{models.length}/{limit}</span>
      </div>
      <label htmlFor="chatgpt-model-search" className="sr-only">{t("Search available models")}</label>
      <input id="chatgpt-model-search" className={inputClass} placeholder={t("Search models and combos…")} value={search} onChange={event => setSearch(event.target.value)} />
      <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-border-subtle divide-y divide-border-subtle">
        {loading ? <p className="p-4 text-sm text-text-muted">{t("Loading available models…")}</p> : visible.length === 0 ?
          <p className="p-4 text-sm text-text-muted">{t("No matching models. Check your connected providers or search again.")}</p> : visible.map(model => {
            const checked = models.includes(model.id);
            const noTools = model.capabilities?.tools === false;
            return <label key={model.id} className={`flex items-center gap-3 px-3 py-2.5 text-sm ${checked ? "bg-primary/5" : "hover:bg-surface-2"}`}>
              <input type="checkbox" checked={checked} disabled={saving || (!checked && (models.length >= limit || noTools))} onChange={() => toggle(model.id)} className="size-4 accent-primary" />
              <span className="min-w-0 flex-1 break-all text-text-main">{model.name || model.id}<span className="ml-2 text-xs text-text-muted">{model.owned_by === "combo" ? t("Combo") : ""}</span></span>
              <span className="shrink-0 text-xs text-text-muted">{noTools ? t("No tool support") : model.context_length ? t("{size}k context", { size: Math.round(model.context_length / 1000) }) : t("Default context")}</span>
            </label>;
          })}
      </div>
      <p className="mt-3 text-xs text-text-muted">{t("Router models appear as {model}. Tool support and reliability depend on the selected provider.", { model: <code key="model">9router/provider/model</code> })}</p>
      <div className="mt-4 rounded-lg border border-border-subtle p-3">
        <label htmlFor="chatgpt-web-search-model" className="text-sm font-medium">{t("Codex web_search backend")}</label>
        <select id="chatgpt-web-search-model" className={`${inputClass} mt-2`} value={webSearchModel} disabled={saving || searchModels.length === 0} onChange={event => { setNotice(""); setWebSearchModel(event.target.value); }}>
          <option value="">{t("Automatic (first active search provider)")}</option>
          {searchModels.map(model => <option key={model.id} value={model.id}>{model.id}</option>)}
        </select>
        <p className="mt-2 text-xs leading-5 text-text-muted">{t("Used when a selected 9router model invokes Codex's hosted web_search tool. Configure fallback providers by creating a Web Search combo and selecting it here.")}</p>
      </div>
    </Card>

    <Card title={t("Connect this computer")} subtitle={t("macOS · Node.js 24.5+ · No Codex profile required")} icon="computer">
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border-subtle p-3"><p className="text-sm font-medium">{t("Native Codex models")}</p><p className="mt-1 text-xs leading-5 text-text-muted">{t("Codex → local helper → OpenAI")}<br />{t("Your existing ChatGPT login and subscription")}</p></div>
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3"><p className="text-sm font-medium">{t("Selected 9router models")}</p><p className="mt-1 text-xs leading-5 text-text-muted">{t("Codex → local helper → 9router")}<br />{t("Your 9router API key and connected providers")}</p></div>
      </div>
      <ol className="list-decimal space-y-4 pl-5 text-sm text-text-main">
        <li>{t("Save the models above. Sign in to Codex with your usual ChatGPT account.")}</li>
        <li><p className="mb-2">{t("Copy a key from {link}, then run this command in Terminal on the computer where you use Codex.", { link: <Link key="link" href="/dashboard/endpoint" className="text-primary underline">{t("Endpoint & Key")}</Link> })}</p>{command("install command", install)}
          <p className="mt-2 text-xs leading-5 text-text-muted">{t("At {prompt}, paste the key and press Enter. No characters or asterisks appear while you type. If a key is already set in {variable} or saved by the helper, it is reused automatically and the installer prints its source.", { prompt: <code key="prompt">9router API key (hidden):</code>, variable: <code key="variable">ROUTER9_API_KEY</code> })}</p>
        </li>
        <li>{t("Quit and reopen Codex. Open the model picker to select a native or 9router model.")}</li>
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
        <a href="/9router-codex.mjs" download="9router-codex.mjs" className="inline-flex items-center gap-1 text-primary hover:underline"><span className="material-symbols-outlined text-base">download</span>{t("Download installer to inspect")}</a>
        <span className="text-xs text-text-muted">{t("The helper starts automatically when you sign in to macOS.")}</span>
      </div>
    </Card>

    <Card title={t("Endpoint")} subtitle={t("Used by the local helper to reach the selected 9router models.")}>
      {command("endpoint", endpoint)}
      <p className="mt-3 text-xs leading-5 text-text-muted">{t("Use the installer for a combined Codex model picker. It configures a local endpoint and model catalog; this server endpoint alone only serves 9router models. ChatGPT credentials stay on your computer.")}</p>
    </Card>

    <Card title={t("Update or disconnect")} subtitle={t("Run these commands on the same computer where you enabled the integration.")}>
      <div className="space-y-4">
        <div><p className="mb-2 text-sm font-medium">{t("After changing models: sync, then restart Codex")}</p>{command("sync command", `${helper} sync`)}</div>
        <div><p className="mb-2 text-sm font-medium">{t("Check the local helper")}</p>{command("status command", `${helper} status`)}</div>
        <div><p className="mb-2 text-sm font-medium">{t("Enter a different API key (hidden terminal prompt)")}</p>{command("change API key command", `${helper} enable --ask-api-key`)}</div>
        <div><p className="mb-2 text-sm font-medium">{t("Disable and restore previous routing, then restart Codex")}</p>{command("disable command", `${helper} disable`)}</div>
      </div>
      <p className="mt-4 text-xs leading-5 text-text-muted">{t("Disabling restores the connection settings saved during installation and stops the helper. Other Codex settings and auth.json are preserved. Re-run the install command to enable it again. If CC Switch or Ollama changes those connection settings, the helper reports a conflict instead of overwriting them.")}</p>
      <p className="mt-3 text-xs leading-5 text-text-muted">{t("Reasoning levels in Codex follow provider support. Combos expose levels shared by all members. A model with a fixed reasoning suffix keeps that setting. To update an older helper, run the install command above again and restart Codex; sync only refreshes the model list.")}</p>
      <p className="mt-3 text-xs leading-5 text-text-muted">{t("The latest helper transfers conversation history when you switch between native and 9router models, including compacted summaries. If a summary cannot be transferred, it stops the request and preserves the saved history. Commands use the default ~/.codex directory; for a custom CODEX_HOME, use its bridge.mjs and pass --codex-home explicitly.")}</p>
    </Card>
  </div>;
}
