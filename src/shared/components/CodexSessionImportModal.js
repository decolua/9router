"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Modal, Button } from "@/shared/components";

/**
 * Codex Session Import Modal
 * Paste ChatGPT session JSON to import Codex accounts without OAuth/phone verification.
 * Accepts: single object { accessToken, user, expires } or array [{...}, {...}]
 */
export default function CodexSessionImportModal({ isOpen, onSuccess, onClose }) {
  const [sessionText, setSessionText] = useState("");
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState(null);

  const handleImport = async () => {
    setError(null);
    setResults(null);

    const trimmed = sessionText.trim();
    if (!trimmed) {
      setError("Vui lòng dán session JSON");
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      setError("JSON không hợp lệ. Hãy dán đúng nội dung từ chatgpt.com/api/auth/session");
      return;
    }

    // Validate: must have accessToken somewhere
    const sessions = Array.isArray(parsed) ? parsed : [parsed];
    const hasToken = sessions.some((s) => s.accessToken || s.access_token);
    if (!hasToken) {
      setError("Không tìm thấy accessToken trong JSON. Hãy kiểm tra lại.");
      return;
    }

    setImporting(true);
    try {
      const res = await fetch("/api/oauth/codex/import-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      setResults(data);
      if (data.success) {
        onSuccess?.();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    setSessionText("");
    setError(null);
    setResults(null);
    onClose?.();
  };

  return (
    <Modal isOpen={isOpen} title="Import Codex từ ChatGPT Session" onClose={handleClose} size="lg">
      <div className="flex flex-col gap-4">
        {/* Instructions */}
        <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p>Import tài khoản Codex bằng cách dán session từ ChatGPT (không cần xác minh số điện thoại).</p>
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <p className="font-medium text-blue-800 dark:text-blue-200 mb-1">Cách lấy session:</p>
            <ol className="list-decimal list-inside space-y-1 text-blue-700 dark:text-blue-300 text-xs">
              <li>Đăng nhập ChatGPT trên trình duyệt</li>
              <li>Mở tab mới, truy cập: <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">chatgpt.com/api/auth/session</code></li>
              <li>Copy toàn bộ JSON và dán vào ô bên dưới</li>
            </ol>
          </div>
          <p className="text-xs text-amber-600 dark:text-amber-400">
            ⚠ Hỗ trợ dán nhiều session cùng lúc dưới dạng mảng [&#123;…&#125;, &#123;…&#125;]
          </p>
        </div>

        {/* Textarea */}
        <textarea
          className="w-full h-48 p-3 text-sm font-mono border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-y focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder='{"user":{"id":"...","email":"..."},"expires":"...","accessToken":"eyJ..."}'
          value={sessionText}
          onChange={(e) => setSessionText(e.target.value)}
          disabled={importing}
        />

        {/* Error */}
        {error && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
            {error}
          </div>
        )}

        {/* Results */}
        {results && (
          <div className={`text-sm rounded-lg p-3 border ${results.success ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300" : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"}`}>
            <p className="font-medium mb-1">
              {results.success ? "✓ Import thành công!" : "Import có lỗi"}
            </p>
            {results.imported > 0 && (
              <p>Đã import: {results.imported} tài khoản</p>
            )}
            {results.connections?.map((c, i) => (
              <p key={i} className="text-xs mt-1">
                • {c.email || "Unknown"} {c.plan && `(${c.plan})`}
              </p>
            ))}
            {results.errors?.map((e, i) => (
              <p key={i} className="text-xs mt-1 text-red-600 dark:text-red-400">
                ✗ #{e.index + 1}: {e.error}
              </p>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={handleClose} disabled={importing}>
            {results?.success ? "Đóng" : "Hủy"}
          </Button>
          {!results?.success && (
            <Button onClick={handleImport} disabled={importing || !sessionText.trim()}>
              {importing ? "Đang import..." : "Import"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

CodexSessionImportModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func,
};
