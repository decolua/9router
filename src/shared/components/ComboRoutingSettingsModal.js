"use client";

import { useState } from "react";
import Link from "next/link";
import Modal from "./Modal";
import Button from "./Button";
import ModelSelectModal from "./ModelSelectModal";
import ModelReferenceLabel from "./ModelReferenceLabel";
import { getSmartPolicyDraft } from "../utils/comboRouting";
import { useTranslation } from "@/i18n/useTranslation";
import ConfidenceSlider from "./ConfidenceSlider";

const POLICIES = [
  { id: "smart", title: "Smart switch", icon: "auto_mode", description: "Keep the current model. Switch when a new task is detected with at least 80% confidence." },
  { id: "strict", title: "Strict lock", icon: "lock", description: "Choose once and keep the successful model for this conversation." },
  { id: "per-turn", title: "Per turn", icon: "sync", description: "Choose a model independently for every request." },
  { id: "custom", title: "Custom threshold", icon: "tune", description: "Set the confidence required to switch models during a conversation." },
];

// Mounted when opened: draft edits survive model picking, and Cancel discards them.
export default function ComboRoutingSettingsModal({ combo, strategy, activeProviders, getRouterStatus, onSave, onClose, initialSection = "model" }) {
  const t = useTranslation();
  const isSmart = strategy.fallbackStrategy === "smart";
  const showPolicy = isSmart && initialSection === "policy";
  const modelKey = isSmart ? "routerModel" : "judgeModel";
  const [model, setModel] = useState(strategy[modelKey] || "");
  const [policy, setPolicy] = useState(() => getSmartPolicyDraft(strategy).policy);
  const [threshold, setThreshold] = useState(() => Math.max(50, Math.min(95, getSmartPolicyDraft(strategy).threshold)));
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const status = isSmart ? getRouterStatus(model) : null;

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const patch = showPolicy ? {} : { [modelKey]: model };
      if (showPolicy) Object.assign(patch, {
        smartPolicy: policy,
        sessionSticky: policy !== "per-turn",
        confidenceThreshold: policy === "custom" ? threshold / 100 : policy === "smart" ? 0.8 : 0,
      });
      if (await onSave(patch) === false) throw new Error(t("Could not save routing settings. Please try again."));
      onClose();
    } catch (err) {
      setError(err.message || t("Could not save routing settings. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  if (showPicker) return (
    <ModelSelectModal isOpen onClose={() => setShowPicker(false)}
      title={isSmart ? t("Select System One Router Model") : t("Select Judge Model")}
      activeProviders={activeProviders} kindFilter={isSmart ? "systemone" : null}
      addedModelValues={model ? [model] : []} selectedModel={model}
      onSelect={choice => { setModel(choice?.value || ""); setShowPicker(false); }} closeOnSelect />
  );

  return (
    <Modal isOpen onClose={saving ? () => {} : onClose} title={showPolicy ? t("Conversation policy") : isSmart ? t("Router model") : t("Fusion settings")} size={showPolicy ? "lg" : "md"}
      footer={<><Button variant="ghost" onClick={onClose} disabled={saving}>{t("Cancel")}</Button><Button onClick={handleSave} loading={saving}>{t("Save changes")}</Button></>}>
      <div className="flex min-w-0 flex-col gap-5">
        <p className="text-xs text-text-muted">{t("Settings for")} <span className="font-mono font-medium text-text-main">{combo.name}</span></p>
        {!showPolicy && <section className="min-w-0 rounded-xl border border-border/60 p-3.5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-medium"><span aria-hidden="true" className="material-symbols-outlined text-[18px] text-primary">{isSmart ? "psychology" : "gavel"}</span>{isSmart ? t("Router model") : t("Judge model")}</h3>
            {model && <button type="button" onClick={() => setModel("")} className="rounded px-2 py-1 text-xs text-text-muted hover:bg-surface-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{t("Use Auto")}</button>}
          </div>
          <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">{model ? <ModelReferenceLabel value={model} connections={activeProviders} /> : <span className="text-sm font-medium">{t("Auto")} <span className="ml-1 text-xs font-normal text-text-muted">{isSmart ? t("Default System One model") : t("First combo member")}</span></span>}</div>
            <Button variant="outline" size="sm" onClick={() => setShowPicker(true)} aria-label={isSmart ? t("Choose router model") : t("Choose judge model")}>{t("Choose model")}</Button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-text-muted">{isSmart ? t("Selects which combo member should handle the request.") : t("Combines the panel answers into the final response.")}</p>
          {status && !status.ready && <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400"><span aria-hidden="true" className="material-symbols-outlined text-[16px]">warning</span>{t("Router account is not configured.")}<Link className="font-medium underline underline-offset-2" href={`/dashboard/media-providers/systemone/${status.providerId}`}>{t("Configure provider")}</Link></p>}
        </section>}

        {showPolicy && <section>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {POLICIES.map(option => <label key={option.id} className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition-colors ${policy === option.id ? "border-primary/60 bg-primary/[0.05]" : "border-border/60 hover:bg-surface-2"}`}>
              <input type="radio" name={`routing-policy-${combo.id}`} value={option.id} checked={policy === option.id} onChange={() => setPolicy(option.id)} className="mt-0.5 size-3.5 shrink-0 accent-primary" />
              <span className="min-w-0"><span className="flex items-center gap-1.5 text-xs font-medium"><span aria-hidden="true" className="material-symbols-outlined text-[15px] text-text-muted">{option.icon}</span>{t(option.title)}</span><span className="mt-1.5 block text-[11px] leading-relaxed text-text-muted">{t(option.description)}</span></span>
            </label>)}
          </div>
          {policy === "custom" && <div className="mt-3"><ConfidenceSlider id={`routing-threshold-${combo.id}`} value={threshold} onChange={setThreshold} /></div>}
          <p className="mt-3 text-[11px] leading-relaxed text-text-muted">{t("Keeping a conversation on the same model and account helps preserve its prompt cache. If a request fails, the combo follows its fallback settings.")}</p>
        </section>}
        {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}
