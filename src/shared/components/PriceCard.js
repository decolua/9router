"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import Modal from "./Modal";
import Button from "./Button";
import Input from "./Input";
import { validatePriceForm, priceChipView } from "@/shared/utils/priceChipView.js";
import { PRICING_SOURCE } from "open-sse/config/pricingSources.js";

const FIELDS = [
  ["input", "Input"],
  ["output", "Output"],
  ["cached", "Cached input (optional)"],
  ["reasoning", "Reasoning (optional)"],
  ["cache_creation", "Cache write (optional)"],
];

function initialForm(price) {
  const p = price?.pricing || {};
  return Object.fromEntries(FIELDS.map(([k]) => [k, p[k] === undefined ? "" : String(p[k])]));
}

// Price card for one provider/model: shows the effective price and where it
// comes from, saves a per-model override (PATCH /api/pricing) or resets it
// (DELETE /api/pricing?provider=&model=). Prices are USD per 1M tokens.
// Built on the shared Modal so it is opaque and themed like every other dialog.
// The card is mounted only while open, so the form starts fresh from the
// current price every time it opens (no effect needed to sync it).
export default function PriceCard(props) {
  if (!props.isOpen) return null;
  return <PriceCardBody key={`${props.provider}/${props.model}`} {...props} />;
}

function PriceCardBody({ provider, model, price, onClose, onChanged }) {
  const [form, setForm] = useState(() => initialForm(price));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const view = priceChipView(price);
  const isOverride = price?.source === PRICING_SOURCE.OVERRIDE;

  const call = async (url, init) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      await onChanged();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const checked = validatePriceForm(form);
    if (!checked.ok) return setError(checked.error);
    call("/api/pricing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [provider]: { [model]: checked.value } }),
    });
  };
  const reset = () =>
    call(`/api/pricing?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}`, { method: "DELETE" });

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Price"
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={reset} disabled={busy || !isOverride}>Reset to built-in</Button>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save} loading={busy}>Save override</Button>
        </>
      }
    >
      <code className="block break-all text-xs text-text-muted">{provider}/{model}</code>
      <p className={`mt-2 text-sm ${view?.tone === "warn" ? "text-orange-500" : "text-text-muted"}`}>{view?.tooltip}</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {FIELDS.map(([key, label]) => (
          <Input
            key={key}
            label={label}
            type="number"
            min="0"
            step="any"
            value={form[key] ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          />
        ))}
      </div>
      <p className="mt-3 text-xs text-text-muted">USD per 1M tokens. Saving creates an override that wins over the built-in price.</p>
      {error && <p className="mt-2 text-sm text-red-500" role="alert">{error}</p>}
    </Modal>
  );
}

PriceCard.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.string,
  model: PropTypes.string,
  price: PropTypes.shape({ pricing: PropTypes.object, source: PropTypes.string }),
  onClose: PropTypes.func.isRequired,
  onChanged: PropTypes.func.isRequired,
};
