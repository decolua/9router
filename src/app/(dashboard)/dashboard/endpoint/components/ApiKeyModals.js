"use client";

import PropTypes from "prop-types";
import { Button, Input, Modal } from "@/shared/components";
import { buildCreatedKeyValue } from "../utils/endpointLimitHelpers";
import { ApiKeyLimitFormFields } from "./ApiKeyLimitFormFields";
import { StatusAlert } from "./StatusAlert";

export function ApiKeyModals({
  showAddModal,
  newKeyName,
  newKeyLimit,
  createdKey,
  editingKey,
  editKeyName,
  editKeyLimit,
  keyFormError,
  savingKeyId,
  copied,
  onNewKeyNameChange,
  onNewKeyLimitChange,
  onCreatedKeyClose,
  onEditKeyNameChange,
  onEditKeyLimitChange,
  onCreateKey,
  onSaveKey,
  onCloseAddModal,
  onCloseEditModal,
  onCopy,
}) {
  return (
    <>
      <Modal
        isOpen={showAddModal}
        title="Create API Key"
        onClose={onCloseAddModal}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Key Name"
            value={newKeyName}
            onChange={(e) => onNewKeyNameChange(e.target.value)}
            placeholder="Production Key"
          />

          <ApiKeyLimitFormFields
            form={newKeyLimit}
            onChange={onNewKeyLimitChange}
            description="One limit per key. Block applies after recorded usage exceeds the configured limit."
          />

          {keyFormError && (
            <StatusAlert status={{ type: "error", message: keyFormError }} />
          )}

          <div className="flex gap-2">
            <Button
              onClick={onCreateKey}
              fullWidth
              disabled={!newKeyName.trim() || savingKeyId === "new"}
            >
              {savingKeyId === "new" ? "Creating..." : "Create"}
            </Button>
            <Button onClick={onCloseAddModal} variant="ghost" fullWidth>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!editingKey}
        title="Edit API Key Limit"
        onClose={onCloseEditModal}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Key Name"
            value={editKeyName}
            onChange={(e) => onEditKeyNameChange(e.target.value)}
            placeholder="Production Key"
          />

          <ApiKeyLimitFormFields
            form={editKeyLimit}
            onChange={onEditKeyLimitChange}
            description="Configure requests, tokens, or cost on daily or monthly windows."
          />

          {keyFormError && (
            <StatusAlert status={{ type: "error", message: keyFormError }} />
          )}

          <div className="flex gap-2">
            <Button
              onClick={onSaveKey}
              fullWidth
              disabled={!editingKey || savingKeyId === editingKey?.id}
            >
              {savingKeyId === editingKey?.id ? "Saving..." : "Save"}
            </Button>
            <Button onClick={onCloseEditModal} variant="ghost" fullWidth>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!createdKey}
        title="API Key Created"
        onClose={onCreatedKeyClose}
      >
        <div className="flex flex-col gap-4">
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-2 font-medium">
              Save this key now!
            </p>
            <p className="text-sm text-yellow-700 dark:text-yellow-300">
              This is the only time you will see this key. Store it securely.
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              value={buildCreatedKeyValue(createdKey)}
              readOnly
              className="flex-1 font-mono text-sm"
            />
            <Button
              variant="secondary"
              icon={copied === "created_key" ? "check" : "content_copy"}
              onClick={() =>
                onCopy(buildCreatedKeyValue(createdKey), "created_key")
              }
            >
              {copied === "created_key" ? "Copied!" : "Copy"}
            </Button>
          </div>
          <Button onClick={onCreatedKeyClose} fullWidth>
            Done
          </Button>
        </div>
      </Modal>
    </>
  );
}

const limitFormShape = PropTypes.shape({
  enabled: PropTypes.bool.isRequired,
  metricType: PropTypes.string.isRequired,
  periodType: PropTypes.string.isRequired,
  limitValue: PropTypes.oneOfType([PropTypes.string, PropTypes.number])
    .isRequired,
});

ApiKeyModals.propTypes = {
  showAddModal: PropTypes.bool.isRequired,
  newKeyName: PropTypes.string.isRequired,
  newKeyLimit: limitFormShape.isRequired,
  createdKey: PropTypes.oneOfType([PropTypes.object, PropTypes.string]),
  editingKey: PropTypes.object,
  editKeyName: PropTypes.string.isRequired,
  editKeyLimit: limitFormShape.isRequired,
  keyFormError: PropTypes.string.isRequired,
  savingKeyId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  copied: PropTypes.string,
  onNewKeyNameChange: PropTypes.func.isRequired,
  onNewKeyLimitChange: PropTypes.func.isRequired,
  onCreatedKeyClose: PropTypes.func.isRequired,
  onEditKeyNameChange: PropTypes.func.isRequired,
  onEditKeyLimitChange: PropTypes.func.isRequired,
  onCreateKey: PropTypes.func.isRequired,
  onSaveKey: PropTypes.func.isRequired,
  onCloseAddModal: PropTypes.func.isRequired,
  onCloseEditModal: PropTypes.func.isRequired,
  onCopy: PropTypes.func.isRequired,
};
