"use client";

import { createContext, useContext } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * Sortable wrapper for a connection card in the Quota Tracker.
 *
 * Only the drag handle is draggable (not the whole card) so the card stays
 * clickable — it carries toggles, quota-row hide buttons and a reset-credit
 * action that would otherwise be swallowed by the pointer sensor.
 *
 * The handle gets its dnd-kit props through context instead of prop drilling,
 * because the card body is a large block of JSX owned by the page.
 */
const SortableCardContext = createContext(null);

export function SortableProviderCard({ id, disabled = false, className = "", children }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({
    id,
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    // No transition: it fights React's re-render on drop (same reasoning as the
    // combo model list).
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 999 : undefined,
  };

  return (
    <SortableCardContext.Provider value={{ attributes, listeners, isDragging, disabled }}>
      <div
        ref={setNodeRef}
        style={style}
        className={`min-w-0 ${isDragging ? "rounded-xl shadow-md ring-1 ring-primary/30" : ""} ${className}`}
      >
        {children}
      </div>
    </SortableCardContext.Provider>
  );
}

export function ProviderDragHandle({ title = "Drag to move this provider" }) {
  const context = useContext(SortableCardContext);
  if (!context || context.disabled) return null;
  const { attributes, listeners } = context;

  return (
    <button
      {...attributes}
      {...listeners}
      type="button"
      className="shrink-0 cursor-grab touch-none rounded p-0.5 text-text-muted transition-colors hover:text-primary active:cursor-grabbing"
      title={title}
      aria-label={title}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="9" cy="4" r="2" />
        <circle cx="15" cy="4" r="2" />
        <circle cx="9" cy="12" r="2" />
        <circle cx="15" cy="12" r="2" />
        <circle cx="9" cy="20" r="2" />
        <circle cx="15" cy="20" r="2" />
      </svg>
    </button>
  );
}
