"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Input, Modal, Select, Toggle } from "@/shared/components";
import { planBulkAdd, splitBulkLines } from "@/shared/utils/bulkAdd";
import { translate } from "@/i18n/runtime";

const NONE_PROXY_POOL_VALUE = "__none__";

export default function BulkAddCustomKeysModal({
  isOpen,
  onClose,
  providerId,
  providerName,
  isAnthropic = false,
  existingNames = [],
  proxyPools = [],
  onSuccess,
}) {
  const [rawKeys, setRawKeys] = useState("");
  const [namePrefix, setNamePrefix] = useState(providerName || "Key");
  const [defaultModel, setDefaultModel] = useState(
    isAnthropic ? "claude-3-5-sonnet-latest" : "gpt-4o-mini"
  );
  const [proxyPoolId, setProxyPoolId] = useState(NONE_PROXY_POOL_VALUE);
  const [validateOnImport, setValidateOnImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);

  const resetForm = () => {
    setRawKeys("");
    setNamePrefix(providerName || "Key");
    setDefaultModel(isAnthropic ? "claude-3-5-sonnet-latest" : "gpt-4o-mini");
    setProxyPoolId(NONE_PROXY_POOL_VALUE);
    setValidateOnImport(false);
    setProgress(null);
    setResult(null);
  };

  const handleClose = () => {
    if (importing) return;
    resetForm();
    onClose();
  };

  const handleSubmit = async () => {
    if (importing) return;
    const lines = splitBulkLines(rawKeys);
    if (!lines.length) return;

    const baseName = namePrefix.trim() || providerName || "Key";
    const model = defaultModel.trim();

    const plan = planBulkAdd(lines, existingNames, {
      defaultBaseName: baseName,
      defaultModel: model || undefined,
    });

    if (!plan.length) return;

    setImporting(true);
    setResult(null);
    setProgress({ current: 0, total: plan.length });

    let successCount = 0;
    let failedCount = 0;
    const errors = [];

    // Process keys sequentially or with small batching to prevent overwhelming the local db or remote gateway
    for (let i = 0; i < plan.length; i++) {
      const entry = plan[i];
      setProgress({ current: i + 1, total: plan.length });

      let isValid = false;
      if (validateOnImport) {
        try {
          const vres = await fetch("/api/providers/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: providerId,
              apiKey: entry.apiKey,
            }),
          });
          const vdata = await vres.json().catch(() => ({}));
          isValid = !!vdata.valid;
        } catch {
          isValid = false;
        }
      }

      try {
        const payload = {
          provider: providerId,
          apiKey: entry.apiKey,
          name: entry.name,
          priority: 1,
          defaultModel: model || undefined,
          proxyPoolId: proxyPoolId !== NONE_PROXY_POOL_VALUE ? proxyPoolId : null,
          testStatus: validateOnImport ? (isValid ? "active" : "unknown") : "unknown",
          ...(entry.providerSpecificData ? { providerSpecificData: entry.providerSpecificData } : {}),
        };

        const res = await fetch("/api/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          successCount++;
        } else {
          failedCount++;
          const errData = await res.json().catch(() => ({}));
          if (errData?.error) {
            errors.push(`${entry.name}: ${errData.error}`);
          }
        }
      } catch (err) {
        failedCount++;
        errors.push(`${entry.name}: ${err.message || "Network error"}`);
      }
    }

    setImporting(false);
    setResult({
      success: successCount,
      failed: failedCount,
      errors: errors.slice(0, 5), // Keep only top 5 error details
    });

    if (successCount > 0 && typeof onSuccess === "function") {
      onSuccess();
    }
  };

  const previewLines = splitBulkLines(rawKeys);
  const totalKeys = previewLines.length;

  return (
    <Modal
      isOpen={isOpen}
      title={`${translate("Bulk Add API Keys")} - ${providerName || providerId}`}
      onClose={handleClose}
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-muted">
          {translate(
            "Paste multiple API keys (one per line, or comma-separated). You can also use name|apiKey format."
          )}
        </p>

        {/* Textarea */}
        <div className="flex flex-col gap-1">
          <textarea
            className="w-full rounded border border-accent/30 bg-sidebar p-2.5 text-sm font-mono resize-y min-h-[140px] focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder={`sk-key-1\nsk-key-2\n# or with custom name:\nPrimary|sk-key-3`}
            value={rawKeys}
            onChange={(e) => setRawKeys(e.target.value)}
            disabled={importing}
          />
          {totalKeys > 0 && (
            <span className="text-right text-xs text-text-muted">
              {totalKeys} {totalKeys === 1 ? "key detected" : "keys detected"}
            </span>
          )}
        </div>

        {/* Options grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label={translate("Name Prefix")}
            value={namePrefix}
            onChange={(e) => setNamePrefix(e.target.value)}
            placeholder={providerName || "Key"}
            disabled={importing}
          />
          <Input
            label={translate("Default Model")}
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            placeholder={isAnthropic ? "claude-3-5-sonnet-latest" : "gpt-4o-mini"}
            disabled={importing}
          />
        </div>

        {proxyPools && proxyPools.length > 0 && (
          <Select
            label={translate("Proxy Pool")}
            value={proxyPoolId}
            onChange={(e) => setProxyPoolId(e.target.value)}
            options={[
              { value: NONE_PROXY_POOL_VALUE, label: translate("None") },
              ...proxyPools.map((p) => ({ value: p.id, label: p.name })),
            ]}
            disabled={importing}
          />
        )}

        <div className="flex items-center justify-between rounded-lg border border-accent/20 bg-sidebar/50 p-3">
          <div className="flex flex-col">
            <span className="text-sm font-medium text-text-main">
              {translate("Test connections during import")}
            </span>
            <span className="text-xs text-text-muted">
              {translate(
                "Validates each key before saving. Disable for faster bulk imports."
              )}
            </span>
          </div>
          <Toggle
            checked={validateOnImport}
            onChange={setValidateOnImport}
            disabled={importing}
          />
        </div>

        {/* Progress display */}
        {importing && progress && (
          <div className="flex flex-col gap-1.5 rounded-lg border border-primary/20 bg-primary/5 p-3">
            <div className="flex justify-between text-xs text-text-main">
              <span>{translate("Importing keys...")}</span>
              <span>
                {progress.current} / {progress.total}
              </span>
            </div>
            <div className="w-full bg-accent/20 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-primary h-1.5 rounded-full transition-all duration-200"
                style={{
                  width: `${Math.round((progress.current / progress.total) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Result summary */}
        {result && (
          <div
            className={`rounded-lg p-3 text-sm font-medium border ${
              result.failed > 0
                ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-500 dark:text-yellow-400"
                : "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400"
            }`}
          >
            <div>
              ✓ {result.success} {translate("added successfully")}
              {result.failed > 0 && `, ✗ ${result.failed} ${translate("failed")}`}
            </div>
            {result.errors?.length > 0 && (
              <ul className="mt-2 list-disc list-inside text-xs font-normal opacity-90">
                {result.errors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 pt-2">
          <Button
            onClick={handleSubmit}
            fullWidth
            disabled={importing || totalKeys === 0}
            icon={importing ? undefined : "playlist_add"}
          >
            {importing
              ? `${translate("Adding")} (${progress?.current || 0}/${progress?.total || 0})...`
              : `${translate("Add All Keys")} (${totalKeys})`}
          </Button>
          <Button onClick={handleClose} variant="ghost" fullWidth disabled={importing}>
            {result ? translate("Close") : translate("Cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

BulkAddCustomKeysModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  providerId: PropTypes.string.isRequired,
  providerName: PropTypes.string,
  isAnthropic: PropTypes.bool,
  existingNames: PropTypes.arrayOf(PropTypes.string),
  proxyPools: PropTypes.array,
  onSuccess: PropTypes.func,
};
