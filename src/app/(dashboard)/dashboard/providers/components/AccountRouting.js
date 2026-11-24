"use client";

import { useId, useState } from "react";
import { Button, Input, Select } from "@/shared/components";
import { ACCOUNT_STRATEGIES, MIN_WEIGHT, MAX_WEIGHT } from "@/shared/constants/accountRouting";

const strategyOptions = [
  { value: "global", label: "Use global strategy" },
  ...Object.entries(ACCOUNT_STRATEGIES).map(([value, label]) => ({ value, label })),
];
const compactInput = "h-7 py-0! sm:text-xs!";

function useSave() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  async function submit(event, persist) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(false);
    try {
      await persist();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return { saving, error, submit };
}

export function StrategyForm({ providerId, initial, sticky, onSaved }) {
  const id = useId();
  const [strategy, setStrategy] = useState(initial || "");
  const { submit, saving, error } = useSave();

  function save(event) {
    const limit = Number(new FormData(event.currentTarget).get("sticky"));
    submit(event, async () => {
      const saved = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerRouting: { provider: providerId, strategy, stickyLimit: limit },
        }),
      });
      if (!saved.ok) throw new Error();
      onSaved(strategy, limit);
    });
  }

  return (
    <form className="flex flex-wrap items-end gap-2 text-xs" onSubmit={save}>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          Account selection
        </label>
        <Select
          id={id}
          options={strategyOptions}
          value={strategy || "global"}
          placeholder=""
          selectClassName={`${compactInput} [&>option:first-child]:hidden`}
          disabled={saving}
          onChange={(event) => setStrategy(event.target.value === "global" ? "" : event.target.value)}
        />
      </div>
      {strategy === "round-robin" && (
        <Input
          id={id + "-sticky"}
          label="Requests per account"
          inputClassName={compactInput + " w-16!"}
          name="sticky"
          type="number"
          min={1}
          step={1}
          required
          defaultValue={sticky || 1}
          disabled={saving}
        />
      )}
      <Button type="submit" size="sm" variant="outline" disabled={saving}>
        Save
      </Button>
      {error && <span role="alert">Could not save routing settings.</span>}
    </form>
  );
}

export function WeightForm({ connection, onSaved }) {
  const id = useId();
  const { submit, saving, error } = useSave();

  function save(event) {
    const weight = Number(new FormData(event.currentTarget).get("weight"));
    submit(event, async () => {
      const res = await fetch(`/api/providers/${connection.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weight }),
      });
      if (!res.ok) throw new Error();
      onSaved(weight);
    });
  }

  return (
    <form className="flex flex-wrap items-end gap-2 px-2 pb-2 text-xs" onSubmit={save}>
      <Input
        id={id}
        label="Connection weight"
        name="weight"
        inputClassName={compactInput + " w-16!"}
        type="number"
        required
        min={MIN_WEIGHT}
        max={MAX_WEIGHT}
        step={1}
        defaultValue={connection.weight ?? MIN_WEIGHT}
        disabled={saving}
      />
      <Button type="submit" size="sm" variant="outline" disabled={saving}>
        Save
      </Button>
      {error && <span role="alert">Could not save routing settings.</span>}
    </form>
  );
}
