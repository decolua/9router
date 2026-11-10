"use client";

import { useState } from "react";
import Modal from "./Modal";
import Button from "./Button";
import { MAX_COMBO_PROMPT_CHARS } from "open-sse/rtk/customPrompt.js";

export default function ComboPromptModal({
  isOpen,
  onClose,
  comboName,
  currentPrompt = "",
  onSave,
}) {
  // The card mounts this modal only while it is open, so the initial value is enough.
  const [prompt, setPrompt] = useState(typeof currentPrompt === "string" ? currentPrompt : "");

  const handleSave = () => {
    // Empty is saved as undefined so the key is omitted from the stored settings.
    onSave({ systemPrompt: prompt.trim() || undefined });
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`System Prompt — ${comboName || "Combo"}`}
      size="lg"
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-text-muted leading-relaxed">
          Added to the system prompt of every request routed through this combo, for all
          strategies and all members. It is appended after the client&apos;s own system prompt,
          never replaces it. Leave empty to send requests unchanged.
        </p>

        <textarea
          aria-label="Combo system prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={MAX_COMBO_PROMPT_CHARS}
          rows={8}
          placeholder="e.g. Always answer in Indonesian. Keep answers short."
          className="w-full px-3 py-2 text-xs border border-border rounded-lg bg-background focus:outline-none focus:border-primary resize-y"
        />
        <div className="text-[10px] text-text-muted text-right">
          {prompt.length} / {MAX_COMBO_PROMPT_CHARS}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave}>
            Save Prompt
          </Button>
        </div>
      </div>
    </Modal>
  );
}
