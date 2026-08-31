"use client";

import { useState, useEffect, useRef, useDeferredValue } from "react";
import { Card, Toggle } from "@/shared/components";
import { AI_PROVIDERS, getProviderAlias } from "@/shared/constants/providers";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { TTS_PROVIDER_CONFIG, TTS_GENERATED_EVENT } from "@/shared/constants/ttsProviders";
import { translate } from "@/i18n/runtime";
import { getTtsVoicesForModel, elevenModel, ELEVEN_OUTPUT_FORMATS } from "open-sse/config/ttsModels.js";
import { GOOGLE_TTS_LANGUAGES } from "open-sse/config/googleTtsLanguages.js";
import { getRelativeTime } from "@/shared/utils";
import { Row } from "./exampleShared";
import { addTtsClip, listTtsClips, deleteTtsClip, clearTtsClips } from "./ttsHistory";
import { ELEVEN_LANGUAGES, ELEVEN_V3_TAG_GROUPS, ENHANCE_VIBES, vibeById, SettingRow, buildEnhancePrompt, scoreModel, ELEVEN_STARTERS } from "./elevenlabsPanel";

const DEFAULT_TTS_RESPONSE_EXAMPLE = `// Audio will appear here after running.
// Example JSON response (response_format=json):
{
  "format": "mp3",
  "audio": "//NExAANaAIIAUAAANNNNNNNN..." // base64 encoded MP3
}`;

const CLIP_ACTIONS = [
  { key: "play",     icon: "play_arrow", title: "Play" },
  { key: "reuse",    icon: "refresh",    title: "Reuse" },
  { key: "download", icon: "download",   title: "Download" },
  { key: "delete",   icon: "close",      title: "Delete", danger: true },
];

// A labelled control with help text underneath — the shape every ElevenLabs
// settings row shares, so the hint styling lives in one place.


export function TtsExampleCard({ providerId }) {
  const providerAlias = getProviderAlias(providerId);
  const isEleven = providerId === "elevenlabs";
  const config = TTS_PROVIDER_CONFIG[providerId] || TTS_PROVIDER_CONFIG["edge-tts"];

  // Voice state
  const [selectedVoice, setSelectedVoice]     = useState(config.defaultVoiceId || "");
  const [selectedVoiceName, setSelectedVoiceName] = useState("");
  const [voiceId, setVoiceId]               = useState(config.defaultVoiceId || ""); // editable voice id (elevenlabs/config providers)
  // Voices shown below Voice row after language selected
  const [countryVoices, setCountryVoices]     = useState([]);
  const [selectedLang, setSelectedLang]       = useState("");
  const [selectedModel, setSelectedModel]     = useState(() => {
    const cfgModels = AI_PROVIDERS[providerId]?.ttsConfig?.models;
    if (cfgModels?.length) return cfgModels[0].id;
    if (config.hasModelSelector && config.modelKey) {
      const models = getModelsByProviderId(config.modelKey);
      return models?.[0]?.id || "";
    }
    return "";
  });

  // Form state
  const [input, setInput]               = useState("Hello, this is a text to speech test.");
  const [style, setStyle]               = useState(""); // style/voice instructions (e.g. MiMo voicedesign)
  const [apiKey, setApiKey]             = useState("");
  const [useTunnel, setUseTunnel]       = useState(false);
  const [localEndpoint, setLocalEndpoint]   = useState("");
  const [tunnelEndpoint, setTunnelEndpoint] = useState("");
  const [responseFormat, setResponseFormat] = useState("mp3"); // mp3 | json
  const [stability, setStability]       = useState(0.5); // ElevenLabs: 0=Creative, 0.5=Natural, 1=Robust
  const [speed, setSpeed]               = useState(1);   // ElevenLabs playback rate (classic models only)
  const [outputFormat, setOutputFormat] = useState("");  // ElevenLabs output_format; empty = provider default
  const [langOverride, setLangOverride] = useState(false); // ElevenLabs language override
  const [langCode, setLangCode]         = useState("vi");
  const [audioUrl, setAudioUrl]         = useState("");
  const [jsonResponse, setJsonResponse] = useState(null); // Store JSON response
  const [running, setRunning]           = useState(false);
  const [enhancing, setEnhancing]       = useState(false);
  const [enhanceVibe, setEnhanceVibe]   = useState("auto"); // style preset for "Enhance with AI"
  const [vibeOpen, setVibeOpen]         = useState(false);  // vibe dropdown open state
  const vibeRef                         = useRef(null);     // for click-outside
  const [error, setError]               = useState("");
  const inputRef                        = useRef(null);  // Input textbox (for caret-aware tag insert)
  const caretRef                        = useRef(null);  // Pending caret position after a tag insert
  const audioRef                        = useRef(null);  // The visible <audio> player
  const [history, setHistory]           = useState([]);  // Generated clips for this provider (from IndexedDB)

  // Indexed by provider, so a page with several TTS providers configured doesn't
  // deserialize every other provider's audio blobs on each refresh.
  const refreshHistory = () => {
    listTtsClips(providerId).then(setHistory).catch(() => {});
  };
  // Load history on mount / provider change
  useEffect(() => { refreshHistory(); }, [providerId]);

  // Close the vibe dropdown when clicking outside it
  useEffect(() => {
    if (!vibeOpen) return;
    const onDown = (e) => { if (vibeRef.current && !vibeRef.current.contains(e.target)) setVibeOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [vibeOpen]);
  const [latency, setLatency]           = useState(null);
  const { copied: copiedCurl, copy: copyCurl } = useCopyToClipboard();

  // Country picker modal state
  const [modalOpen, setModalOpen]           = useState(false);
  const [languages, setLanguages]           = useState([]);
  const [modalLoading, setModalLoading]     = useState(false);
  const [modalSearch, setModalSearch]       = useState("");
  const [modalError, setModalError]         = useState("");
  const [byLang, setByLang]                 = useState({});
  // Language hint (e.g. Gemini/MiMo): guides the spoken language without affecting voice selection
  const [languageHint, setLanguageHint]     = useState("");
  // Number of stored provider connections (shown when no dashboard API key)
  const [connectionCount, setConnectionCount] = useState(0);

  useEffect(() => {
    setLocalEndpoint(window.location.origin);
    fetch("/api/keys")
      .then((r) => r.json())
      .then((d) => { setApiKey((d.keys || []).find((k) => k.isActive !== false)?.key || ""); })
      .catch(() => {});
    fetch("/api/providers", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { setConnectionCount((d.connections || []).filter((c) => c.provider === providerId && c.isActive !== false).length); })
      .catch(() => {});
    fetch("/api/tunnel/status")
      .then((r) => r.json())
      .then((d) => { if (d.publicUrl) setTunnelEndpoint(d.publicUrl); })
      .catch(() => {});

    // Pre-select default voice based on provider config
    if (config.voiceSource === "hardcoded") {
      const defaultModel = config.hasModelSelector && config.modelKey
        ? (getModelsByProviderId(config.modelKey)?.[0]?.id || "")
        : "";
      // Use per-model voices if available, else flat list
      const voices = (config.voicesPerModel && defaultModel)
        ? (getTtsVoicesForModel(providerId, defaultModel) || [])
        : getModelsByProviderId(config.voiceKey || providerId).filter((m) => getModelKind(m) === "tts");
      if (voices.length) {
        if (config.hasBrowseButton) {
          // Google TTS: pre-select "en" (English) as default, show as single voice chip
          const defaultVoice = voices.find((v) => v.id === "en") || voices[0];
          setSelectedLang(defaultVoice.id);
          setSelectedVoice(defaultVoice.id);
          setSelectedVoiceName(defaultVoice.name);
          setCountryVoices([{ id: defaultVoice.id, name: defaultVoice.name }]);
        } else {
          // OpenAI/OpenRouter: set voice chips directly (no language picker)
          setCountryVoices(voices);
          setSelectedVoice(voices[0].id);
          setSelectedVoiceName(voices[0].name || voices[0].id);
        }
      }
    }
    // api-language (edge-tts, local-device, elevenlabs): NO default load, wait for user to pick language
    // config (nvidia, hyperbolic, deepgram, huggingface, cartesia, playht, coqui, tortoise, inworld, qwen):
    // use ttsConfig.models for model selector; voice is empty by default (backend uses provider default)
  }, [providerId]);

  // Update voices when model changes (voicesPerModel providers)
  useEffect(() => {
    if (!config.voicesPerModel || !selectedModel) return;
    const voices = getTtsVoicesForModel(providerId, selectedModel) || [];
    setCountryVoices(voices);
    if (voices.length) {
      setSelectedVoice(voices[0].id);
      setSelectedVoiceName(voices[0].name || voices[0].id);
    } else {
      // Model has no preset voices (voicedesign/voiceclone) — drop stale voice
      setSelectedVoice("");
      setSelectedVoiceName("");
    }
  }, [selectedModel]);

  // Open modal — load language list
  const openModal = async () => {
    setModalOpen(true);
    setModalSearch("");
    setModalError("");
    if (languages.length) return; // already loaded
    setModalLoading(true);
    try {
      if (config.voiceSource === "hardcoded") {
        // Build languages/byLang from static providerModels data
        const voiceKey = config.voiceKey || providerId;
        const voices = getModelsByProviderId(voiceKey).filter((m) => getModelKind(m) === "tts");
        const byLangMap = {};
        for (const v of voices) {
          if (!byLangMap[v.id]) byLangMap[v.id] = { code: v.id, name: v.name, voices: [{ id: v.id, name: v.name }] };
        }
        setByLang(byLangMap);
        setLanguages(Object.values(byLangMap).sort((a, b) => a.name.localeCompare(b.name)));
      } else {
        // Use provider-specific apiEndpoint if available, else default to edge-tts voices API
        const url = config.apiEndpoint
          ? config.apiEndpoint
          : `/api/media-providers/tts/voices?provider=${providerId === "local-device" ? "local-device" : "edge-tts"}`;
        const r = await fetch(url);
        const d = await r.json();
        if (d.error) { setModalError(d.error); return; }
        setLanguages(d.languages || []);
        setByLang(d.byLang || {});
      }
    } catch (e) {
      setModalError(e.message);
    } finally {
      setModalLoading(false);
    }
  };

  // Click language → close modal → show voices below
  const handlePickLanguage = (lang) => {
    setModalOpen(false);
    setSelectedLang(lang.code);
    const voices = byLang[lang.code]?.voices || [];
    setCountryVoices(voices);
    // Auto-select first voice
    if (voices.length) {
      setSelectedVoice(voices[0].id);
      setSelectedVoiceName(voices[0].name);
      if (config.hasVoiceIdInput) setVoiceId(voices[0].id);
    }
  };

  const filteredLanguages = modalSearch
    ? languages.filter((c) =>
        c.name.toLowerCase().includes(modalSearch.toLowerCase()) ||
        c.code.toLowerCase().includes(modalSearch.toLowerCase())
      )
    : languages;

  const endpoint = useTunnel ? tunnelEndpoint : localEndpoint;
  // For ElevenLabs/config-driven: prefer manual voiceId (if any), else fall back to selectedVoice
  const activeVoiceId = config.hasVoiceIdInput ? (voiceId || selectedVoice) : selectedVoice;
  const modelFull = (() => {
    if (config.hasModelSelector && selectedModel && activeVoiceId) return `${providerAlias}/${selectedModel}/${activeVoiceId}`;
    if (config.hasModelSelector && selectedModel) return `${providerAlias}/${selectedModel}`;
    if (activeVoiceId) return `${providerAlias}/${activeVoiceId}`;
    return "";
  })();

  // One capability lookup drives every ElevenLabs-only row, shared with the
  // adapter so the panel can't offer a knob the server would drop.
  const caps = elevenModel(selectedModel);
  // Per-request char limit (credit estimate is just input.length: 1 char ≈ 1 credit)
  const maxChars = isEleven ? caps.maxChars : Infinity;
  const overLimit = input.length > maxChars;
  const isElevenV3 = isEleven && selectedModel === "eleven_v3"; // gates the v3-only rows
  const supportsLangCode = isEleven && caps.langCode;
  // v3 has no speed/similarity knobs — it is directed with tags and stability.
  const supportsSpeed = isEleven && caps.classic;
  const activeVibe = vibeById(enhanceVibe);

  const ttsBody = (() => {
    const b = { model: modelFull, input };
    if (config.hasLanguageHint && languageHint) b.language = languageHint;
    if (config.hasStyleInput && style.trim()) b.style = style.trim();
    if (isEleven) b.stability = stability;
    if (supportsLangCode && langOverride && langCode) b.language_code = langCode;
    if (supportsSpeed && speed !== 1) b.speed = speed;
    if (isEleven && outputFormat) b.output_format = outputFormat;
    return b;
  })();
  // The snippet embeds the entire input and rewraps a <pre> that can hold 40,000
  // characters on Flash/Turbo. Deferring it keeps typing responsive — the
  // snippet catches up once the urgent render is done.
  const deferredInput = useDeferredValue(input);
  const curlSnippet = `curl -X POST ${endpoint}/v1/audio/speech${responseFormat === "json" ? "?response_format=json" : ""} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey || "YOUR_KEY"}" \\
  -d '${JSON.stringify({ ...ttsBody, input: deferredInput })}' \\
  ${responseFormat === "json" ? "" : "--output speech.mp3"}`;

  // Eleven v3: insert an audio tag at the current caret position (not just append)
  const insertTag = (tag) => {
    const el = inputRef.current;
    const hasCaret = el && typeof el.selectionStart === "number";
    const start = hasCaret ? el.selectionStart : input.length;
    const end = hasCaret ? el.selectionEnd : input.length;
    const before = input.slice(0, start);
    const after = input.slice(end);
    const lead = before && !/\s$/.test(before) ? " " : "";          // space before tag if needed
    const trail = after && !/^\s/.test(after) ? " " : "";           // space after tag if needed
    const piece = `${lead}${tag}${trail}`;
    caretRef.current = start + piece.length;                        // caret lands right after inserted tag
    setInput(before + piece + after);
  };

  // "Get started" preset: fill the editor with a demo script + matching settings
  const applyStarter = (s) => {
    setInput(s.text);
    setStability(s.stability);
    setEnhanceVibe(s.vibe);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) { el.focus(); el.setSelectionRange(s.text.length, s.text.length); }
    });
  };

  // Restore caret after a tag insert re-renders the controlled input
  useEffect(() => {
    if (caretRef.current == null || !inputRef.current) return;
    const pos = caretRef.current;
    caretRef.current = null;
    inputRef.current.focus();
    inputRef.current.setSelectionRange(pos, pos);
  }, [input]);

  // Revoke the previous blob: URL when audioUrl is replaced or the card unmounts
  useEffect(() => {
    if (!audioUrl?.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  // Eleven v3 "Enhance": ask 9router's own LLM to auto-insert audio tags
  const handleEnhance = async () => {
    if (!input.trim() || enhancing) return;
    setEnhancing(true);
    setError("");
    try {
      const mr = await fetch("/api/v1/models");
      const md = await mr.json();
      const ids = (md.data || []).map((m) => m.id).filter(Boolean);
      if (!ids.length) {
        setError("Enhance needs an LLM provider — connect one in Providers first.");
        return;
      }
      // Best first, then a few alternates. Free tiers meter per model — Gemini's
      // daily allowance is per-model, so a 429 on one candidate says nothing about
      // the next — and a single hard-coded pick turns any transient failure into a
      // dead button. Scored once per id, not once per comparison.
      const candidates = ids
        .map((id) => ({ id, score: scoreModel(id) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 4)
        .map((c) => c.id);

      let lastStatus = 0;
      let lastError = "";
      for (const model of candidates) {
        const res = await fetch("/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: buildEnhancePrompt(enhanceVibe) },
              { role: "user", content: input.trim() },
            ],
            stream: false,
            temperature: 0.7,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          const enhanced = data?.choices?.[0]?.message?.content?.trim();
          if (enhanced) { setInput(enhanced); return; }
        }
        lastStatus = res.status;
        lastError = typeof data?.error === "string" ? data.error : data?.error?.message || "";
      }

      // Providers answer quota failures with a wall of JSON — say what to do instead.
      setError(lastStatus === 429
        ? `Every model tried is rate-limited or out of quota (tried ${candidates.length}). Wait a moment or connect another LLM provider.`
        : (lastError.slice(0, 200) || `Enhance failed (HTTP ${lastStatus || "no response"})`));
    } catch (e) {
      setError(e.message || "Enhance failed");
    } finally {
      setEnhancing(false);
    }
  };

  const handleRun = async () => {
    if (!input.trim() || !modelFull || overLimit) return;
    setRunning(true);
    setError("");
    setAudioUrl("");
    setJsonResponse(null);
    const start = Date.now();
    try {
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const url = `/api/v1/audio/speech${responseFormat === "json" ? "?response_format=json" : ""}`;
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...ttsBody, input: input.trim() }),
      });
      setLatency(Date.now() - start);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error?.message || d?.error || `HTTP ${res.status}`);
        return;
      }
      
      let audioBlob;
      if (responseFormat === "json") {
        const data = await res.json();
        // Keep only what the preview renders. The full base64 string is ~1.33×
        // the audio bytes and the decoded Blob is already held separately, so
        // retaining it in state would pin two copies for the session.
        setJsonResponse({
          format: data.format,
          audioPreview: data.audio ? `${data.audio.substring(0, 100)}...` : "",
        });
        const format = data.format || "mp3";
        // Assign the outer binding (no shadowing) so the shared setAudioUrl below
        // and the history entry both see the blob.
        audioBlob = await fetch(`data:audio/${format};base64,${data.audio}`).then(r => r.blob());
      } else {
        audioBlob = await res.blob();
      }
      setAudioUrl(URL.createObjectURL(audioBlob));

      // Persist to history (IndexedDB) so the clip can be replayed later
      try {
        await addTtsClip({
          id: `${start}-${Math.round(Math.random() * 1e6)}`,
          provider: providerId,
          model: selectedModel || "",
          voiceId: activeVoiceId || "",
          voiceName: selectedVoiceName || activeVoiceId || "",
          text: input.trim(),
          stability: isEleven ? stability : undefined,
          blob: audioBlob,
          size: audioBlob.size,
          latency: Date.now() - start,
          createdAt: Date.now(),
        });
        refreshHistory();
      } catch { /* history is best-effort; never block playback */ }

      // Notify the credit display (ConnectionsCard) that usage changed → auto-refresh
      window.dispatchEvent(new CustomEvent(TTS_GENERATED_EVENT, { detail: { provider: providerId } }));
    } catch (e) {
      setError(e.message || "Network error");
    } finally {
      setRunning(false);
    }
  };

  // History actions
  const playClip = (clip) => {
    if (!clip?.blob) return;
    setJsonResponse(null);
    // Point the visible player at the clip and start it, rather than also
    // building a detached Audio — two elements would decode the same clip twice
    // and the detached one could not be stopped. The audioUrl effect revokes the
    // previous object URL when this replaces it.
    setAudioUrl(URL.createObjectURL(clip.blob));
    // Start it once React has committed the new src.
    requestAnimationFrame(() => { audioRef.current?.play().catch(() => {}); });
  };
  const downloadClip = (clip) => {
    const u = URL.createObjectURL(clip.blob);
    const a = document.createElement("a");
    a.href = u; a.download = `speech-${clip.createdAt}.mp3`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  };
  const reuseClip = (clip) => {
    setInput(clip.text);
    if (clip.voiceId) {
      setSelectedVoice(clip.voiceId);
      if (config.hasVoiceIdInput) setVoiceId(clip.voiceId);
    }
    if (clip.voiceName) setSelectedVoiceName(clip.voiceName);
    if (clip.model && config.hasModelSelector) setSelectedModel(clip.model);
    if (typeof clip.stability === "number") setStability(clip.stability);
  };
  // Drop the row locally rather than re-reading the whole store for a deletion
  // whose outcome is already known.
  const removeClip = async (id) => {
    try {
      await deleteTtsClip(id);
      setHistory((prev) => prev.filter((c) => c.id !== id));
    } catch { /* leave the row in place if the delete failed */ }
  };
  const clearHistory = async () => {
    if (!confirm("Clear all audio history for this provider?")) return;
    try { await clearTtsClips(providerId); refreshHistory(); } catch {}
  };

  const runClipAction = (key, clip) => {
    if (key === "play") return playClip(clip);
    if (key === "reuse") return reuseClip(clip);
    if (key === "download") return downloadClip(clip);
    return removeClip(clip.id);
  };

  return (
    <>
      <Card>
        <h2 className="text-lg font-semibold mb-4">Example</h2>

        <div className="flex flex-col gap-2.5">
          {/* Endpoint + API Key as read-only text */}
          <Row label="Endpoint">
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <span className="w-full min-w-0 flex-1 px-3 py-1.5 text-sm font-mono text-text-main bg-sidebar rounded-lg truncate">
                {endpoint}/v1/audio/speech
              </span>
              {tunnelEndpoint && (
                <button
                  onClick={() => setUseTunnel((v) => !v)}
                  title={useTunnel ? "Using tunnel" : "Using local"}
                  className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border shrink-0 transition-colors ${
                    useTunnel ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-text-muted hover:text-primary"
                  }`}
                >
                  <span className="material-symbols-outlined text-[14px]">wifi_tethering</span>
                  Tunnel
                </button>
              )}
            </div>
          </Row>
          <Row label="API Key">
            <span className="px-3 py-1.5 text-sm font-mono text-text-main bg-sidebar rounded-lg truncate block">
              {apiKey
                ? `${apiKey.slice(0, 8)}${"•".repeat(Math.min(20, Math.max(0, apiKey.length - 8)))}`
                : connectionCount > 0
                  ? <span className="text-text-muted italic">Using stored key(s) · {connectionCount} connection{connectionCount > 1 ? "s" : ""}</span>
                  : <span className="text-text-muted italic">No key configured</span>}
            </span>
          </Row>

          {/* Model selector — prefer PROVIDER_MODELS[kind=tts], else providerModels via modelKey */}
          {config.hasModelSelector && (config.modelKey || getModelsByProviderId(providerId).some(m => getModelKind(m) === "tts")) && (
            <Row label="Model">
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              >
                {(() => {
                  const ttsModels = getModelsByProviderId(providerId).filter(m => getModelKind(m) === "tts");
                  return (ttsModels.length ? ttsModels : getModelsByProviderId(config.modelKey) || []).map((m) => (
                    <option key={m.id} value={m.id}>{m.name || m.id}</option>
                  ));
                })()}
              </select>
            </Row>
          )}

          {/* Language hint dropdown (Gemini, Xiaomi MiMo) — sends body.language to guide pronunciation */}
          {config.hasLanguageHint && (
            <Row label="Language">
              <select
                value={languageHint}
                onChange={(e) => setLanguageHint(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              >
                <option value="">Auto-detect</option>
                {(config.languageOptions || GOOGLE_TTS_LANGUAGES).map((l) =>
                  typeof l === "string"
                    ? <option key={l} value={l}>{l}</option>
                    : <option key={l.id} value={l.name}>{l.name}</option>
                )}
              </select>
            </Row>
          )}

          {/* Language row + Browse button (edge-tts, local-device, elevenlabs) */}
          {config.hasBrowseButton && (
            <Row label="Language">
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <button
                  onClick={openModal}
                  className="w-full min-w-0 flex-1 px-3 py-1.5 text-sm border border-border rounded-lg bg-background font-mono truncate text-left hover:border-primary/40 transition-colors"
                >
                  {selectedLang
                    ? <span className="text-text-main">{languages.find((l) => l.code === selectedLang)?.name || selectedLang}</span>
                    : <span className="text-text-muted">No language selected</span>}
                </button>
                <button
                  onClick={openModal}
                  className="flex w-full items-center justify-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-border text-text-muted hover:text-primary hover:border-primary/40 transition-colors sm:w-auto sm:shrink-0"
                >
                  <span className="material-symbols-outlined text-[14px]">language</span>
                  Select language
                </button>
              </div>
            </Row>
          )}

          {/* Voice chips — shown after language picked (edge-tts, local-device) or always (OpenAI/ElevenLabs/MiMo) */}
          {countryVoices.length > 0 && (
            <Row label="Voice">
              <div className="flex flex-wrap gap-1.5">
                {countryVoices.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => {
                      setSelectedVoice(v.id);
                      setSelectedVoiceName(v.name);
                      if (config.hasVoiceIdInput) setVoiceId(v.id);
                    }}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                      selectedVoice === v.id
                        ? "bg-primary/15 border-primary/40 text-primary font-medium"
                        : "border-border text-text-muted hover:text-primary hover:border-primary/40"
                    }`}
                  >
                    {v.name}
                    {v.language ? ` · ${v.language}` : ""}
                    {v.gender ? ` · ${v.gender[0].toUpperCase()}` : ""}
                    {v.free_users_allowed === true && (
                      <span className="ml-1.5 px-1 py-0.5 text-[9px] font-semibold rounded bg-green-500/15 text-green-600 border border-green-500/20">Free</span>
                    )}
                    {v.free_users_allowed === false && (
                      <span className="ml-1.5 px-1 py-0.5 text-[9px] font-semibold rounded bg-amber-500/15 text-amber-600 border border-amber-500/20">Paid</span>
                    )}
                  </button>
                ))}
              </div>
            </Row>
          )}

          {/* Voice ID input (ElevenLabs) — manual entry or auto-fill from chip */}
          {config.hasVoiceIdInput && (
            <Row label="Voice ID">
              <div className="flex flex-col gap-1">
                <div className="relative">
                  <input
                    value={voiceId}
                    onChange={(e) => {
                      setVoiceId(e.target.value);
                      setSelectedVoice(e.target.value);
                    }}
                    placeholder="e.g. CwhRBWXzGAHq8TQ4Fs17"
                    className="w-full px-3 py-1.5 pr-7 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary font-mono"
                  />
                  {voiceId && (
                    <button
                      type="button"
                      onClick={() => { setVoiceId(""); setSelectedVoice(""); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary transition-colors"
                    >
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  )}
                </div>
              </div>
            </Row>
          )}

          {/* Google TTS: Language dropdown */}
          {config.hasLanguageDropdown && (
            <Row label="Language">
              <select
                value={selectedVoice}
                onChange={(e) => {
                  const m = getModelsByProviderId(providerId).filter((m) => getModelKind(m) === "tts").find((m) => m.id === e.target.value);
                  setSelectedVoice(e.target.value);
                  setSelectedVoiceName(m?.name || e.target.value);
                }}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              >
                {getModelsByProviderId(providerId).filter((m) => getModelKind(m) === "tts").map((m) => (
                  <option key={m.id} value={m.id}>{m.name || m.id}</option>
                ))}
              </select>
            </Row>
          )}

          {/* Input */}
          <Row label="Input">
            <div className="flex flex-col gap-1">
              <div className="relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  rows={4}
                  className={`w-full resize-y min-h-[88px] px-3 py-1.5 pr-7 text-sm leading-relaxed border rounded-lg bg-background focus:outline-none ${overLimit ? "border-red-500 focus:border-red-500" : "border-border focus:border-primary"}`}
                />
                {input && (
                  <button
                    type="button"
                    onClick={() => setInput("")}
                    title={translate("Clear input")}
                    className="absolute right-2 top-2 text-text-muted hover:text-primary transition-colors"
                  >
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 text-[10px]">
                {isEleven && input.length > 0 && (
                  <span className="text-text-muted" title={translate("Estimate (1 character ≈ 1 credit)")}>≈ {input.length.toLocaleString()} credits</span>
                )}
                <span className={overLimit ? "text-red-500 font-medium" : "text-text-muted"}>
                  {isEleven
                    ? `${input.length.toLocaleString()} / ${maxChars.toLocaleString()}`
                    : input.length}
                  {" "}characters
                </span>
              </div>
              {overLimit && (
                <span className="text-[11px] text-red-500">Over the model&apos;s character limit — shorten the text or switch model (Flash/Turbo allow 40,000).</span>
              )}
            </div>
          </Row>

          {/* Style / voice instructions (Xiaomi MiMo) */}
          {config.hasStyleInput && (
            <Row label={translate("Style")}>
              <div className="relative">
                <textarea
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  placeholder={translate("e.g. a warm, gentle voice, speaking slowly with a British accent")}
                  rows={2}
                  className="w-full px-3 py-1.5 pr-7 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary resize-none"
                />
                {style && (
                  <button
                    type="button"
                    onClick={() => setStyle("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary transition-colors"
                  >
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                )}
              </div>
            </Row>
          )}

          {/* ElevenLabs stability — Creative / Natural / Robust */}
          {isEleven && (
            <SettingRow
              label="Stability"
              hint="Voice expressiveness. Creative follows audio tags most closely; Robust is the steadiest but responds least to them."
            >
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { v: 0,   name: "Creative", hint: "Expressive and varied — can even sing" },
                    { v: 0.5, name: "Natural",  hint: "Balanced, natural conversation" },
                    { v: 1,   name: "Robust",   hint: "Accurate, stable, predictable" },
                  ].map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      title={translate(opt.hint)}
                      onClick={() => setStability(opt.v)}
                      className={`px-3 py-1 rounded-lg text-xs border transition-colors ${
                        stability === opt.v
                          ? "bg-primary/15 border-primary/40 text-primary font-medium"
                          : "border-border text-text-muted hover:text-primary hover:border-primary/40"
                      }`}
                    >
                      {opt.name}
                    </button>
                  ))}
                </div>
            </SettingRow>
          )}

          {/* Speed — v3 has no speed control, so only classic models show this */}
          {supportsSpeed && (
            <SettingRow label="Speed" hint="Playback rate, 0.70× to 1.20×. Values far from 1 can affect quality.">
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="0.7"
                    max="1.2"
                    step="0.05"
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))}
                    className="w-40 accent-primary"
                  />
                  <span className="text-xs text-text-muted tabular-nums">{speed.toFixed(2)}×</span>
                  {speed !== 1 && (
                    <button
                      type="button"
                      onClick={() => setSpeed(1)}
                      className="text-[11px] text-text-muted hover:text-primary transition-colors"
                    >
                      {translate("Reset")}
                    </button>
                  )}
                </div>
            </SettingRow>
          )}

          {/* Audio encoding — ElevenLabs output_format */}
          {isEleven && (
            <SettingRow
              label="Audio Quality"
              hint="Higher MP3 bitrates and PCM require a paid plan; µ-law 8 kHz is for telephony."
            >
                <select
                  value={outputFormat}
                  onChange={(e) => setOutputFormat(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
                >
                  <option value="">Provider default (MP3 44.1 kHz 128 kbps)</option>
                  {ELEVEN_OUTPUT_FORMATS.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
            </SettingRow>
          )}

          {/* ElevenLabs language override — only for models that accept language_code */}
          {supportsLangCode && (
            <SettingRow
              label="Language Override"
              hint="Off: the model auto-detects the language. On: force the chosen language (best with Eleven v3)."
            >
                <div className="flex items-center gap-2 flex-wrap">
                  <Toggle size="sm" checked={langOverride} onChange={setLangOverride} />
                  {langOverride && (
                    <select
                      value={langCode}
                      onChange={(e) => setLangCode(e.target.value)}
                      className="px-2 py-1 text-xs border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
                    >
                      {ELEVEN_LANGUAGES.map((l) => (
                        <option key={l.code} value={l.code}>{l.name} ({l.code})</option>
                      ))}
                    </select>
                  )}
                </div>
            </SettingRow>
          )}

          {/* Eleven v3 quick-start presets */}
          {isElevenV3 && (
            <Row label="Get started">
              <div className="flex flex-wrap gap-1.5">
                {ELEVEN_STARTERS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => applyStarter(s)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border text-xs text-text-main hover:text-primary hover:border-primary/40 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[14px] text-text-muted">{s.icon}</span>
                    {s.label}
                  </button>
                ))}
              </div>
            </Row>
          )}

          {/* Eleven v3 audio tags + AI Enhance */}
          {isElevenV3 && (
            <Row label="Audio Tags">
              <div className="flex flex-col gap-2.5">
                {ELEVEN_V3_TAG_GROUPS.map((group) => (
                  <div key={group.label} className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{group.label}</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {group.tags.map((t) => (
                        <button
                          key={t.ins}
                          type="button"
                          title={t.ins}
                          onClick={() => insertTag(t.ins)}
                          className="px-2 py-0.5 rounded-full text-[11px] border border-border text-text-muted hover:text-primary hover:border-primary/40 transition-colors"
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleEnhance}
                    disabled={enhancing || !input.trim()}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border border-primary/40 bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span
                      className="material-symbols-outlined text-[14px]"
                      style={enhancing ? { animation: "spin 1s linear infinite" } : undefined}
                    >
                      {enhancing ? "progress_activity" : "auto_awesome"}
                    </span>
                    {enhancing ? "Enhancing…" : "Enhance with AI"}
                  </button>
                  <div ref={vibeRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setVibeOpen((o) => !o)}
                      disabled={enhancing}
                      title={translate("Performance style the AI should aim for")}
                      className="inline-flex items-center gap-1.5 pl-2 pr-1.5 py-1 text-xs font-medium rounded-lg border border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="material-symbols-outlined text-[14px] text-primary/70">tune</span>
                      {activeVibe.label}
                      <span className={`material-symbols-outlined text-[16px] text-primary/70 transition-transform ${vibeOpen ? "rotate-180" : ""}`}>expand_more</span>
                    </button>
                    {vibeOpen && (
                      <div className="absolute left-0 top-full mt-1 z-50 min-w-52 rounded-xl border border-border bg-bg shadow-lg overflow-hidden py-1">
                        {ENHANCE_VIBES.map((v) => (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => { setEnhanceVibe(v.id); setVibeOpen(false); }}
                            className={`w-full text-left px-3 py-1.5 transition-colors ${enhanceVibe === v.id ? "bg-primary/10" : "hover:bg-sidebar"}`}
                          >
                            <span className={`flex items-center gap-1.5 text-xs font-medium ${enhanceVibe === v.id ? "text-primary" : "text-text-main"}`}>
                              {enhanceVibe === v.id && <span className="material-symbols-outlined text-[14px]">check</span>}
                              {v.label}
                            </span>
                            <span className="block text-[10px] text-text-muted mt-0.5">{v.hint}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <span className="text-[11px] text-text-muted">
                  Click a tag to insert it, or let AI add tags automatically (uses your configured LLM via 9router).
                </span>
              </div>
            </Row>
          )}

          {/* Output Format */}
          <Row label="Output Format">
            <select
              value={responseFormat}
              onChange={(e) => setResponseFormat(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
            >
              <option value="mp3">MP3 (Binary)</option>
              <option value="json">JSON (Base64)</option>
            </select>
          </Row>

          {/* Curl + Run */}
          <div className="mt-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-1.5">
              <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Request</span>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <button
                  onClick={() => copyCurl(curlSnippet)}
                  className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px]">{copiedCurl ? "check" : "content_copy"}</span>
                  {copiedCurl ? "Copied" : "Copy"}
                </button>
                <button
                  onClick={handleRun}
                  disabled={running || !input.trim() || !modelFull || overLimit}
                  className="flex w-full sm:w-auto items-center justify-center gap-1.5 px-3 py-1 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="material-symbols-outlined text-[14px]" style={running ? { animation: "spin 1s linear infinite" } : undefined}>
                    play_arrow
                  </span>
                  {running ? "Generating..." : "Run"}
                </button>
              </div>
            </div>
            <pre className="bg-sidebar rounded-lg px-3 py-2.5 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all">{curlSnippet}</pre>
          </div>

          {error && <p className="text-xs text-red-500 break-words">{error}</p>}

          {/* Audio player */}
          {audioUrl ? (
            <div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-1.5">
                <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Response {latency && <span className="font-normal normal-case">&#9889; {latency}ms</span>}
                </span>
                <a href={audioUrl} download="speech.mp3" className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors">
                  <span className="material-symbols-outlined text-[14px]">download</span>
                  Download
                </a>
              </div>
              <audio ref={audioRef} controls src={audioUrl} className="w-full" />
              
              {/* JSON Response (if format is json) */}
              {jsonResponse && (
                <div className="mt-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-1.5">
                    <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">JSON Response</span>
                  </div>
                  <pre className="bg-sidebar rounded-lg px-3 py-2.5 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all">
                    {JSON.stringify({
                      format: jsonResponse.format,
                      audio: jsonResponse.audioPreview
                    }, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div>
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Response</span>
            <pre className="mt-1.5 bg-sidebar rounded-lg px-3 py-2.5 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all opacity-50">{DEFAULT_TTS_RESPONSE_EXAMPLE}</pre>
          </div>
          )}

          {/* History — generated clips (persisted in IndexedDB) */}
          {history.length > 0 && (
            <div className="mt-1">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  History <span className="font-normal normal-case">({history.length})</span>
                </span>
                <button
                  onClick={clearHistory}
                  className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-red-500 transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px]">delete_sweep</span>
                  Clear all
                </button>
              </div>
              <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
                {history.map((clip) => (
                  <div key={clip.id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-border bg-sidebar/50">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-text-main truncate" title={clip.text}>{clip.text}</p>
                      <p className="text-[10px] text-text-muted truncate">
                        {clip.voiceName || clip.voiceId || "—"}
                        {clip.model ? ` · ${clip.model}` : ""}
                        {` · ${getRelativeTime(clip.createdAt)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {CLIP_ACTIONS.map((a) => (
                        <button
                          key={a.key}
                          onClick={() => runClipAction(a.key, clip)}
                          title={translate(a.title)}
                          className={`p-1 rounded text-text-muted transition-colors ${a.danger ? "hover:text-red-500" : "hover:text-primary"}`}
                        >
                          <span className="material-symbols-outlined text-[16px]">{a.icon}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Country Picker Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)" }}
          onClick={() => setModalOpen(false)}
        >
          <div
            className="border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 flex flex-col max-h-[80vh]"
            style={{ backgroundColor: "var(--color-bg)", isolation: "isolate" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0 rounded-t-xl">
              <h3 className="text-sm font-semibold">Select Language</h3>
              <button onClick={() => setModalOpen(false)} className="text-text-muted hover:text-primary transition-colors">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Search */}
            <div className="px-4 py-2.5 border-b border-border shrink-0">
              <input
                autoFocus
                value={modalSearch}
                onChange={(e) => setModalSearch(e.target.value)}
                placeholder="Search language..."
                className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              />
            </div>

            {/* Language list */}
            <div className="overflow-y-auto flex-1 p-2">
              {modalError && <p className="text-xs text-red-500 px-2 py-1">{modalError}</p>}
              {modalLoading ? (
                <p className="text-xs text-text-muted px-2 py-3">Loading...</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {filteredLanguages.map((c) => (
                    <button
                      key={c.code}
                      onClick={() => handlePickLanguage(c)}
                      className={`flex items-center justify-between w-full px-3 py-2 rounded-lg text-left hover:bg-sidebar transition-colors ${
                        selectedLang === c.code ? "bg-primary/10 text-primary" : ""
                      }`}
                    >
                      <span className="text-sm">{c.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-text-muted">{c.voices.length} voices</span>
                        {selectedLang === c.code && (
                          <span className="material-symbols-outlined text-[16px] text-primary">check</span>
                        )}
                      </div>
                    </button>
                  ))}
                  {filteredLanguages.length === 0 && (
                    <p className="text-xs text-text-muted px-2 py-3">No languages found.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
