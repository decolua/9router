"use client";

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Badge } from "@/shared/components";

export default function ErrorHistoryModal({ isOpen, connectionId, connectionName, onClose }) {
  const [records, setRecords] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 0, totalItems: 0 });
  const [loading, setLoading] = useState(false);

  const fetchHistory = useCallback(async (page = 1) => {
    if (!connectionId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/error-history?connectionId=${connectionId}&page=${page}&pageSize=10`);
      const data = await res.json();
      setRecords(data.records || []);
      setPagination(data.pagination || { page: 1, totalPages: 0, totalItems: 0 });
    } catch (err) {
      console.error("Failed to fetch error history:", err);
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    if (isOpen && connectionId) fetchHistory(1);
  }, [isOpen, connectionId, fetchHistory]);

  const handleClear = async () => {
    if (!confirm("Clear all error history for this connection?")) return;
    try {
      await fetch(`/api/error-history?connectionId=${connectionId}`, { method: "DELETE" });
      setRecords([]);
      setPagination({ page: 1, totalPages: 0, totalItems: 0 });
    } catch (err) {
      console.error("Failed to clear error history:", err);
    }
  };

  const formatTime = (ts) => {
    try {
      const d = new Date(ts);
      return d.toLocaleString();
    } catch {
      return ts;
    }
  };

  const getStatusColor = (code) => {
    if (code === 401 || code === 403) return "text-red-500";
    if (code === 429) return "text-orange-500";
    if (code >= 500) return "text-yellow-600 dark:text-yellow-400";
    return "text-text-muted";
  };

  return (
    <Modal isOpen={isOpen} title={`Error History — ${connectionName || connectionId}`} onClose={onClose} size="lg">
      <div className="flex flex-col gap-3">
        {loading ? (
          <div className="h-20 animate-pulse bg-black/5 dark:bg-white/5 rounded-lg" />
        ) : records.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-6">No error history</p>
        ) : (
          <>
            <div className="text-xs text-text-muted mb-1">{pagination.totalItems} error(s) total</div>
            <div className="flex flex-col divide-y divide-border max-h-[400px] overflow-y-auto">
              {records.map((r) => (
                <div key={r.id} className="py-2 flex flex-col gap-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-mono text-sm font-bold ${getStatusColor(r.statusCode)}`}>{r.statusCode}</span>
                    <span className="text-xs text-text-muted">{r.provider}/{r.model}</span>
                    <span className="text-xs text-text-muted ml-auto">{formatTime(r.timestamp)}</span>
                    {r.notified && <Badge variant="success" size="sm">notified</Badge>}
                  </div>
                  <p className="text-xs text-text-main break-all">{r.errorMessage}</p>
                </div>
              ))}
            </div>

            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!pagination.hasPrev}
                  onClick={() => fetchHistory(pagination.page - 1)}
                >
                  Prev
                </Button>
                <span className="text-xs text-text-muted">
                  {pagination.page} / {pagination.totalPages}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!pagination.hasNext}
                  onClick={() => fetchHistory(pagination.page + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          {records.length > 0 && (
            <Button size="sm" variant="ghost" onClick={handleClear}>
              Clear History
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

ErrorHistoryModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  connectionId: PropTypes.string,
  connectionName: PropTypes.string,
  onClose: PropTypes.func.isRequired,
};
