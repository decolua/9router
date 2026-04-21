"use client";

import { Badge, Button, Card } from "@/shared/components";

function sanitizePreviewValue(value, key = "") {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizePreviewValue(entry));
  }

  const loweredKey = key.toLowerCase();
  const isSensitiveKey =
    loweredKey.includes("secret") ||
    loweredKey.includes("token") ||
    loweredKey.includes("apikey") ||
    loweredKey.includes("api_key");

  if (!value || typeof value !== "object") {
    if (isSensitiveKey) return "********";
    return value;
  }

  if (isSensitiveKey) {
    return "********";
  }

  const objectLooksSecret = value.secret === true || value.isSecret === true;

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => {
      const loweredEntryKey = entryKey.toLowerCase();
      const sensitiveEntry =
        loweredEntryKey.includes("secret") ||
        loweredEntryKey.includes("token") ||
        loweredEntryKey.includes("apikey") ||
        loweredEntryKey.includes("api_key");

      if (objectLooksSecret && loweredEntryKey === "value") {
        return [entryKey, "********"];
      }

      if (sensitiveEntry) {
        return [entryKey, "********"];
      }

      return [entryKey, sanitizePreviewValue(entryValue, entryKey)];
    })
  );
}

export default function BundlePreviewCard({ preview, loading = false, error = "", onRefresh }) {
  const safePreview = sanitizePreviewValue(preview || null);

  return (
    <Card
      title="Generated server bundle"
      subtitle="Preview the sanitized server response that the sync plugin resolves from current saved preferences."
      icon="data_object"
      action={
        <Button variant="secondary" size="sm" onClick={onRefresh} loading={loading}>
          Refresh preview
        </Button>
      }
    >
      <div className="space-y-4">
        {error ? (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        ) : null}

        {preview?.preview ? (
          <div className="flex flex-wrap gap-2">
            <Badge variant="primary">{preview.preview.variant}</Badge>
            {preview.preview.customTemplate ? <Badge>{preview.preview.customTemplate}</Badge> : null}
            <Badge>{preview.preview.modelCount} models</Badge>
            <Badge>{preview.preview.pluginCount} plugins</Badge>
            {preview.revision ? <Badge>rev {preview.revision}</Badge> : null}
          </div>
        ) : null}

        <pre className="max-h-[42rem] overflow-auto rounded-lg border border-black/5 bg-black px-4 py-3 text-xs leading-6 text-slate-100 dark:border-white/5">
          <code>{JSON.stringify(safePreview, null, 2)}</code>
        </pre>
      </div>
    </Card>
  );
}
