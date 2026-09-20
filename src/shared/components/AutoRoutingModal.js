"use client";

import { useState } from "react";
import Modal from "./Modal";
import Button from "./Button";
import Input from "./Input";
import ModelSelectModal from "./ModelSelectModal";
import { AUTO_ROUTING_DEFAULTS, AUTO_ROUTING_TIERS, validateAutoRouting } from "open-sse/config/autoRouting.js";

export default function AutoRoutingModal({ config, activeProviders, onSave, onClose }) {
  const [draft, setDraft] = useState(() => ({
    classifierModel: config?.classifierModel || "",
    timeoutMs: config?.timeoutMs ?? AUTO_ROUTING_DEFAULTS.timeoutMs,
    tiers: Object.fromEntries(AUTO_ROUTING_TIERS.map(({ id }) => [id, [...(config?.tiers?.[id] || [])]])),
  }));
  const [picker, setPicker] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const setPool = (id, models) => {
    setError("");
    setDraft((prev) => ({ ...prev, tiers: { ...prev.tiers, [id]: models } }));
  };
  const move = (id, index, delta) => {
    const models = [...draft.tiers[id]];
    [models[index], models[index + delta]] = [models[index + delta], models[index]];
    setPool(id, models);
  };
  const save = async () => {
    const invalid = validateAutoRouting(draft);
    if (invalid) { setError(invalid); return; }
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
      onClose();
    } catch (err) {
      setError(err.message || "Unable to save auto routing");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal isOpen={!picker} onClose={saving ? () => {} : onClose} title="Configure Auto Routing" size="xl"
        footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Auto Routing"}</Button></>}>
        <div className="flex flex-col gap-5">
          <p className="text-sm text-text-muted">A small classifier selects the difficulty tier before the request is answered. Each classification adds an LLM call and sends bounded recent user and assistant text to the selected provider.</p>
          <div className="flex flex-col items-start gap-2">
            <span className="text-sm font-medium">Classifier model</span>
            <Button variant="secondary" icon="psychology" onClick={() => setPicker("classifier")} className="max-w-full break-all whitespace-normal text-left">
              {draft.classifierModel || "Select classifier model"}
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {AUTO_ROUTING_TIERS.map(({ id, label, description }) => (
              <section key={id} className="min-w-0 rounded-lg border border-border-subtle p-3" aria-label={`${label} tier`}>
                <h3 className="text-sm font-semibold">{label}</h3>
                <p className="mt-1 text-xs text-text-muted">{description}</p>
                <ol className="my-3 flex flex-col gap-2">
                  {draft.tiers[id].map((model, index) => (
                    <li key={model} className="flex min-w-0 items-center gap-1">
                      <span className="text-xs text-text-muted">{index + 1}.</span>
                      <code className="min-w-0 flex-1 break-all text-xs">{model}</code>
                      <button type="button" className="shrink-0 p-1 disabled:opacity-30" disabled={index === 0} onClick={() => move(id, index, -1)} aria-label={`Move ${model} up in ${label}`}>↑</button>
                      <button type="button" className="shrink-0 p-1 disabled:opacity-30" disabled={index === draft.tiers[id].length - 1} onClick={() => move(id, index, 1)} aria-label={`Move ${model} down in ${label}`}>↓</button>
                      <button type="button" className="shrink-0 p-1 text-red-500" onClick={() => setPool(id, draft.tiers[id].filter((m) => m !== model))} aria-label={`Remove ${model} from ${label}`}>×</button>
                    </li>
                  ))}
                </ol>
                <Button size="sm" variant="secondary" icon="add" onClick={() => setPicker(id)}>Add {label} model</Button>
              </section>
            ))}
          </div>
          <p className="text-xs text-text-muted">Models are tried in the order shown. If classification fails or a tier is exhausted, the combo’s emergency fallback pool is used.</p>
          <details>
            <summary className="cursor-pointer text-sm font-medium">Advanced</summary>
            <div className="mt-3">
              <Input label="Classifier timeout (ms)" aria-label="Classifier timeout (ms)" type="number" min={1} max={AUTO_ROUTING_DEFAULTS.maxTimeoutMs} value={draft.timeoutMs}
                onChange={(event) => { setError(""); setDraft((prev) => ({ ...prev, timeoutMs: event.target.value === "" ? "" : Number(event.target.value) })); }} />
            </div>
          </details>
          {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        </div>
      </Modal>
      {picker && <ModelSelectModal isOpen onClose={() => setPicker(null)} activeProviders={activeProviders} excludeCombos kindFilter="llm"
        selectionHint="Select a model. Apply your changes with Save Auto Routing."
        title={picker === "classifier" ? "Select Classifier Model" : `Select ${AUTO_ROUTING_TIERS.find(({ id }) => id === picker)?.label} Model`}
        addedModelValues={picker === "classifier" ? [draft.classifierModel].filter(Boolean) : draft.tiers[picker]}
        onSelect={(model) => {
          if (!model?.value) return;
          setError("");
          if (picker === "classifier") setDraft((prev) => ({ ...prev, classifierModel: model.value }));
          else if (!draft.tiers[picker].includes(model.value)) setPool(picker, [...draft.tiers[picker], model.value]);
          setPicker(null);
        }} />}
    </>
  );
}
