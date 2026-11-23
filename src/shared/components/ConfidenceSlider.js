"use client";

import { useTranslation } from "@/i18n/useTranslation";
import styles from "./ConfidenceSlider.module.css";

const MIN = 50;
const MAX = 95;

export default function ConfidenceSlider({ id, value, onChange }) {
  const t = useTranslation();
  const progress = Math.max(0, Math.min(100, (value - MIN) / (MAX - MIN) * 100));
  return (
    <div className="rounded-xl border border-border/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-xs font-medium">{t("Switch confidence")}</label>
        <output htmlFor={id} className="font-mono text-sm font-medium text-primary">{value}%</output>
      </div>
      <input id={id} type="range" min={MIN} max={MAX} step="1" value={value} onChange={event => onChange(Number(event.target.value))}
        aria-valuetext={`${value}%`} className={styles.slider} style={{ "--range-progress": `${progress}%` }} />
      <div aria-hidden="true" className="flex justify-between text-[10px] text-text-muted"><span>{MIN}%</span><span>{MAX}%</span></div>
      <div className="mt-3 grid grid-cols-6 gap-1" role="group" aria-label={t("Confidence presets")}>
        {[60, 70, 75, 80, 85, 90].map(preset => <button key={preset} type="button" onClick={() => onChange(preset)} aria-pressed={value === preset}
          className={`flex h-8 min-w-0 items-center justify-center rounded-md text-xs tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${value === preset ? "bg-primary/10 font-medium text-primary" : "text-text-muted hover:bg-surface-2"}`}>{preset}%</button>)}
      </div>
    </div>
  );
}
