"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Button, Input, Modal, Toggle } from "@/shared/components";

const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const DEFAULTS = { name: "", value: "", ttlMinutes: null };

export default function HeaderFormModal({ isOpen, mode, initial, existingNames = [], onSubmit, onClose }) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [persist, setPersist] = useState(false);
  const [minutes, setMinutes] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    const src = initial || DEFAULTS;
    /* eslint-disable react-hooks/set-state-in-effect */
    setName(src.name || "");
    setValue(src.value || "");
    const ttl = src.ttlMinutes;
    setPersist(ttl !== null && ttl !== undefined);
    setMinutes(ttl === null || ttl === undefined ? "" : String(ttl));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [isOpen, initial]);

  const trimmedName = name.trim();
  const nameInvalid = trimmedName !== "" && !HEADER_NAME_RE.test(trimmedName);
  const duplicate = trimmedName !== "" && existingNames.includes(trimmedName.toLowerCase());
  const minutesInvalid = persist && minutes !== "" && (!/^\d+$/.test(minutes) || Number(minutes) < 0);
  const canSave = trimmedName !== "" && !nameInvalid && !minutesInvalid;

  const handleSubmit = () => {
    if (!canSave) return;
    let ttlMinutes = null;
    if (persist) ttlMinutes = minutes === "" ? 0 : Number(minutes);
    onSubmit({ name: trimmedName, value, ttlMinutes });
  };

  return (
    // Correct stacking above the parent modal relies on DOM order: this popup
    // renders inside the parent modal's children, so it naturally paints on top.
    // The parent also passes disableEscape / closeOnOverlay={false} while this
    // popup is open, so it doesn't intercept escape/overlay clicks meant for us.
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === "edit" ? "Edit Header" : "Add Header"}
      size="sm"
      closeOnOverlay={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSave}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Header-Name"
          error={nameInvalid ? "Invalid header name" : (duplicate ? "A header with this name already exists (will replace it)" : undefined)}
        />
        <Input
          label="Value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="value or sess_{ralpha_num:26}"
          hint="Dynamic tags {ralpha|lalpha|ualpha|num|symbol[_...][:length]}, {opencode_session}, copy via {header:Other}, or {remove} to delete a preset."
        />
        <Toggle checked={persist} onChange={setPersist} label="Persist (reuse value per connection)" />
        {persist && (
          <Input
            label="Minutes (0 = permanent until restart)"
            type="number"
            min="0"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder="0"
            error={minutesInvalid ? "Enter a non-negative whole number" : undefined}
          />
        )}
      </div>
    </Modal>
  );
}

HeaderFormModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  mode: PropTypes.oneOf(["add", "edit"]).isRequired,
  initial: PropTypes.shape({ name: PropTypes.string, value: PropTypes.string, ttlMinutes: PropTypes.number }),
  existingNames: PropTypes.arrayOf(PropTypes.string),
  onSubmit: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
