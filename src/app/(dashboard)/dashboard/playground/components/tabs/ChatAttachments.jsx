import React, { useEffect, useRef } from "react";

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function attachmentName(file, index) {
  const name = typeof file.name === "string" && file.name.trim() ? file.name.trim() : `Image ${index + 1}`;
  return name.slice(0, 120);
}

export default function ChatAttachments({ attachments, canAttach, disabled, onChange, onError, resetKey }) {
  const inputRef = useRef(null);
  // Monotonic read generation: a FileReader completion is accepted only while
  // its generation is current AND image attachments are still allowed, so a
  // read that began before capability loss, Clear, Send, unmount, or a newer
  // selection can never re-add attachments through onChange.
  const canAttachRef = useRef(canAttach);
  canAttachRef.current = canAttach;
  const readGenRef = useRef(0);

  useEffect(() => {
    if (!canAttach && attachments.length > 0) onChange([]);
  }, [attachments.length, canAttach, onChange]);

  useEffect(() => {
    readGenRef.current += 1;
  }, [canAttach]);

  useEffect(() => {
    readGenRef.current += 1;
  }, [resetKey]);

  useEffect(() => {
    return () => { readGenRef.current += 1; };
  }, []);

  if (!canAttach) return null;

  const addFiles = (event) => {
    const files = Array.from(event.target.files || []);
    if (inputRef.current) inputRef.current.value = "";
    if (files.length === 0) return;

    const run = ++readGenRef.current;
    Promise.all(files.map((file, index) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (loadEvent) => resolve({
        dataUrl: loadEvent.target.result,
        name: attachmentName(file, index),
        size: file.size,
      });
      reader.onerror = () => reject(new Error("Unable to read image attachment."));
      reader.readAsDataURL(file);
    }))).then((newAttachments) => {
      if (run !== readGenRef.current || !canAttachRef.current) return;
      onChange([...attachments, ...newAttachments]);
    }).catch((error) => {
      onError(error.message);
    });
  };

  return (
    <div className="flex flex-col gap-2" data-testid="playground-image-preview">
      <label className="text-sm text-text-muted" htmlFor="playground-image-input">Attach images</label>
      <input
        id="playground-image-input"
        type="file"
        accept="image/*"
        multiple
        ref={inputRef}
        onChange={addFiles}
        disabled={disabled}
        data-testid="playground-image-input"
      />
      {attachments.length > 0 && (
        <>
          <span className="text-xs text-text-muted">{attachments.length} image{attachments.length === 1 ? "" : "s"} selected</span>
          <ul className="flex flex-wrap gap-2" aria-label="Selected images">
          {attachments.map((attachment, index) => (
            <li className="flex items-center gap-2 rounded border border-border px-2 py-1 text-xs" key={`${attachment.name}-${index}`}>
              <span>{attachment.name} ({formatSize(attachment.size)})</span>
              <button
                type="button"
                onClick={() => onChange(attachments.filter((_, attachmentIndex) => attachmentIndex !== index))}
                aria-label={`Remove ${attachment.name} (${index + 1})`}
                data-testid="playground-image-remove"
              >
                Remove
              </button>
            </li>
          ))}
          </ul>
        </>
      )}
    </div>
  );
}
