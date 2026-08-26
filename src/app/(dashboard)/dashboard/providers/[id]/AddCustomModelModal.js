"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Modal } from "@/shared/components";

let nextRowId = 1;

function createRow() {
  return {
    id: nextRowId++,
    modelId: "",
    testStatus: null,
    testError: "",
  };
}

export default function AddCustomModelModal({ isOpen, providerAlias, providerDisplayAlias, existingModelIds = [], onSave, onClose }) {
  const [rows, setRows] = useState(() => [createRow()]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const handleClose = () => {
    setRows([createRow()]);
    setSaving(false);
    setFormError("");
    onClose();
  };

  const stripAlias = (id) => {
    const value = String(id || "").trim();
    for (const prefix of [providerAlias, providerDisplayAlias].filter(Boolean)) {
      if (value.startsWith(`${prefix}/`)) return value.slice(prefix.length + 1);
    }
    return value;
  };

  const updateRow = (rowId, patch) => {
    setRows((current) => current.map((row) => row.id === rowId ? { ...row, ...patch } : row));
    setFormError("");
  };

  const handleTest = async (rowId) => {
    const row = rows.find((item) => item.id === rowId);
    const modelId = stripAlias(row?.modelId);
    if (!modelId || row?.testStatus === "testing") return;

    updateRow(rowId, { testStatus: "testing", testError: "" });
    try {
      const response = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerAlias}/${modelId}` }),
      });
      const data = await response.json().catch(() => ({}));
      updateRow(rowId, {
        testStatus: response.ok && data.ok === true ? "ok" : "error",
        testError: response.ok && data.ok === true ? "" : (data.error || "模型不可用"),
      });
    } catch (error) {
      updateRow(rowId, { testStatus: "error", testError: error.message || "网络错误" });
    }
  };

  const handleSave = async () => {
    if (saving) return;
    const modelIds = rows.map((row) => stripAlias(row.modelId)).filter(Boolean);
    if (!modelIds.length) {
      setFormError("请至少填写一个模型 ID");
      return;
    }

    const uniqueModelIds = [...new Set(modelIds)];
    if (uniqueModelIds.length !== modelIds.length) {
      setFormError("模型 ID 不能重复");
      return;
    }

    const existing = new Set(existingModelIds.map((modelId) => String(modelId)));
    const duplicate = uniqueModelIds.find((modelId) => existing.has(modelId));
    if (duplicate) {
      setFormError(`模型已存在：${duplicate}`);
      return;
    }

    setSaving(true);
    try {
      await onSave(uniqueModelIds);
      handleClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="添加模型" size="md">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <div key={row.id} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={row.modelId}
                  onChange={(event) => updateRow(row.id, { modelId: event.target.value, testStatus: null, testError: "" })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleTest(row.id);
                    }
                  }}
                  placeholder={index === 0 ? "输入模型 ID" : "输入另一个模型 ID"}
                  className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                  autoFocus={index === 0}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  icon="science"
                  loading={row.testStatus === "testing"}
                  onClick={() => handleTest(row.id)}
                  disabled={!row.modelId.trim() || row.testStatus === "testing"}
                >
                  测试
                </Button>
              </div>
              {row.testStatus === "ok" && <p className="text-xs text-green-600">模型可用</p>}
              {row.testStatus === "error" && <p className="break-words text-xs text-red-500">{row.testError || "模型不可用"}</p>}
            </div>
          ))}
        </div>

        {formError && <p className="break-words text-xs text-red-500">{formError}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <Button variant="ghost" size="sm" onClick={handleClose} disabled={saving}>取消</Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" icon="add" onClick={() => setRows((current) => [...current, createRow()])} disabled={saving}>新增一行</Button>
            <Button size="sm" onClick={handleSave} loading={saving} disabled={saving}>确认</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

AddCustomModelModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  existingModelIds: PropTypes.arrayOf(PropTypes.string),
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
