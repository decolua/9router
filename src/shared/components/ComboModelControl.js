"use client";

import { useId, useState } from "react";
import { parseModelReference } from "open-sse/utils/modelReference.js";
import { useTranslation } from "@/i18n/useTranslation";
import SegmentedControl from "./SegmentedControl";
import Tooltip from "./Tooltip";

export default function ComboModelControl({ comboName, isSmart, model, policyLabel, routerStatus, onSelectAuto, onConfigure }) {
  const t = useTranslation();
  const controlId = useId();
  const [section, setSection] = useState("model");
  const modelLabel = parseModelReference(model).model;
  const label = isSmart ? t("Router settings") : t("Judge model");
  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-black/[0.015] p-3 dark:bg-white/[0.02]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-medium text-text-main">
          {label}
          {routerStatus && <span role="img" aria-label={t(routerStatus.label)} title={t(routerStatus.label)} className={`size-1.5 shrink-0 rounded-full ${routerStatus.ready ? "bg-emerald-500" : "bg-amber-500"}`} />}
        </span>
        <Tooltip text={isSmart ? t("Choose the router model or conversation policy using the tabs below.") : t("Auto uses the first combo member to combine the panel answers. Custom lets you choose a judge model and account.")}>
          <button type="button" aria-label={`${t("About routing settings")}: ${comboName}`} className="flex size-5 items-center justify-center rounded text-text-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><span aria-hidden="true" className="material-symbols-outlined text-[15px]">info</span></button>
        </Tooltip>
      </div>
      {isSmart ? <>
        <SegmentedControl variant="panel" size="sm" asTabs ariaLabel={`${t("Router settings")}: ${comboName}`} value={section} onChange={setSection}
          options={[{ value: "model", label: t("Router model"), id: `${controlId}-model`, controls: `${controlId}-panel` }, { value: "policy", label: t("Conversation policy"), id: `${controlId}-policy`, controls: `${controlId}-panel` }]} />
        <div id={`${controlId}-panel`} role="tabpanel" aria-labelledby={`${controlId}-${section}`} className="mt-2">
          <button type="button" onClick={() => onConfigure(section)} aria-label={`${section === "model" ? t("Configure router model") : t("Configure conversation policy")}: ${comboName}`}
            className="flex min-h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-border/60 bg-surface px-2.5 py-1.5 text-left text-xs text-text-main hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <span className="min-w-0 truncate" title={section === "model" ? modelLabel : policyLabel}>{section === "model" ? modelLabel || t("Auto") : policyLabel}</span>
            <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-[18px] text-text-muted">expand_more</span>
          </button>
          {section === "model" && !routerStatus?.ready && <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">{t("Router account needs configuration.")}</p>}
        </div>
      </> : <>
        <SegmentedControl variant="panel" ariaLabel={`${t("Judge model")}: ${comboName}`} value={model ? "custom" : "auto"}
          onChange={value => value === "auto" ? onSelectAuto() : onConfigure("model")}
          options={[{ value: "auto", label: t("Auto model"), icon: "auto_mode" }, { value: "custom", label: t("Custom model"), icon: "tune" }]} />
        <button type="button" onClick={() => onConfigure("model")} aria-label={`${t("Configure Fusion")}: ${comboName}`} title={modelLabel || t("First combo member is the judge.")}
          className="mt-2 flex w-full min-w-0 items-start justify-between gap-2 rounded text-left text-[11px] leading-relaxed text-text-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <span className="min-w-0 truncate">{modelLabel || t("First combo member is the judge.")}</span><span className="shrink-0 font-medium text-primary">{t("Configure")}</span>
        </button>
      </>}
    </div>
  );
}
