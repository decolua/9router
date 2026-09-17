"use client";

import PropTypes from "prop-types";
import { Modal, Button } from "@/shared/components";

/**
 * Asked before a model that a combo uses is disabled or deleted.
 *
 * Disable offers three exits, because a disabled model can stay in a combo and
 * keep routing. Delete offers two: the model ceases to exist, so "keep" is not
 * on the table.
 */
export default function ComboImpactModal({
  isOpen,
  subject,
  combos = [],
  mode = "disable",
  onRemoveAndProceed,
  onKeepAndProceed,
  onCancel,
}) {
  const isDelete = mode === "delete";
  const emptied = combos.filter((combo) => combo.remainingCount === 0);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={isDelete ? "Delete model used by combos" : "Disable model used by combos"}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          {!isDelete && (
            <Button variant="secondary" onClick={onKeepAndProceed}>
              Disable, keep in combos
            </Button>
          )}
          <Button variant="danger" onClick={onRemoveAndProceed}>
            {isDelete ? "Remove and delete" : "Remove and disable"}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-text-muted">
          <span className="font-mono">{subject}</span>{" "}
          {combos.length === 1 ? "is used by this combo:" : `is used by ${combos.length} combos:`}
        </p>

        <ul className="space-y-1">
          {combos.map((combo) => (
            <li key={combo.name} className="flex items-center justify-between gap-2">
              <code className="truncate font-mono text-xs">{combo.name}</code>
              {combo.remainingCount === 0 ? (
                <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-px text-[10px] text-amber-600 dark:text-amber-400">
                  would be left empty
                </span>
              ) : (
                <span className="shrink-0 text-[10px] text-text-muted">
                  {combo.remainingCount} model{combo.remainingCount === 1 ? "" : "s"} left
                </span>
              )}
            </li>
          ))}
        </ul>

        {emptied.length > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            A combo with no models cannot route until you add one.
          </p>
        )}

        {!isDelete && (
          <p className="text-xs text-text-muted">
            Kept in a combo, the model still routes and stays listed here, but it is no longer
            advertised in <code className="font-mono">/v1/models</code>.
          </p>
        )}
      </div>
    </Modal>
  );
}

ComboImpactModal.propTypes = {
  isOpen: PropTypes.bool,
  subject: PropTypes.string,
  combos: PropTypes.arrayOf(
    PropTypes.shape({ name: PropTypes.string, remainingCount: PropTypes.number })
  ),
  mode: PropTypes.oneOf(["disable", "delete"]),
  onRemoveAndProceed: PropTypes.func,
  onKeepAndProceed: PropTypes.func,
  onCancel: PropTypes.func,
};
