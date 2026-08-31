"use client";

import { useState, useMemo } from "react";
import PropTypes from "prop-types";
import Modal from "./Modal";
import ProviderIcon from "./ProviderIcon";
import { AI_PROVIDERS } from "@/shared/constants/providers";

// Provider-scoped API key picker. Mirrors ModelSelectModal's grouped-pill layout
// (search + provider sections + toggle pills) so it reads as the same UI family,
// but the items being toggled are provider accounts (connections) instead of models.
export default function AccountSelectModal({
  isOpen,
  onClose,
  connections = [],
  selectedIds = [],
  onToggleAccount,
  saving = false,
}) {
  const [searchQuery, setSearchQuery] = useState("");

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const groupedConnections = useMemo(() => {
    const groups = {};
    for (const conn of connections) {
      const providerInfo = AI_PROVIDERS[conn.provider] || { name: conn.provider, color: "#666" };
      if (!groups[conn.provider]) {
        groups[conn.provider] = { name: providerInfo.name, color: providerInfo.color, connections: [] };
      }
      groups[conn.provider].connections.push(conn);
    }
    return groups;
  }, [connections]);

  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return groupedConnections;
    const filtered = {};
    Object.entries(groupedConnections).forEach(([providerId, group]) => {
      const providerNameMatches = group.name.toLowerCase().includes(query);
      const accounts = group.connections.filter(
        (c) => (c.name || "").toLowerCase().includes(query) || (c.email || "").toLowerCase().includes(query)
      );
      if (accounts.length === 0 && !providerNameMatches) return;
      filtered[providerId] = { ...group, connections: providerNameMatches ? group.connections : accounts };
    });
    return filtered;
  }, [groupedConnections, searchQuery]);

  const accountLabel = (conn) => conn.name || conn.email || conn.id.slice(0, 8);

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => { onClose(); setSearchQuery(""); }}
      title="Scope Accounts"
      size="md"
      className="p-4!"
      footer={null}
    >
      {/* Info bar */}
      <div className="flex items-center gap-2 mb-3 px-2.5 py-2 bg-primary/8 border border-primary/20 rounded-lg text-xs text-text-muted">
        <span className="material-symbols-outlined text-primary shrink-0" style={{ fontSize: "14px" }}>info</span>
        <span>Click to add, click again to remove. Changes are saved automatically. {" "}Leave none selected to allow every account (unrestricted).</span>
      </div>

      {/* Search */}
      <div className="mb-3">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[16px]">
            search
          </span>
          <input
            type="text"
            placeholder="Search accounts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-surface border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
      </div>

      {/* Accounts grouped by provider */}
      <div className="max-h-[400px] overflow-y-auto space-y-3">
        {Object.entries(filteredGroups).map(([providerId, group]) => (
          <div key={providerId}>
            <div className="flex items-center gap-1.5 mb-1.5 sticky top-0 bg-surface py-0.5">
              <ProviderIcon
                providerId={providerId}
                alt={group.name}
                size={14}
                fallbackText={(group.name || providerId).slice(0, 2).toUpperCase()}
                fallbackColor={group.color}
              />
              <span className="text-xs font-medium text-primary">{group.name}</span>
              <span className="text-[10px] text-text-muted">({group.connections.length})</span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {group.connections.map((conn) => {
                const isSelected = selectedSet.has(conn.id);
                return (
                  <button
                    key={conn.id}
                    disabled={saving}
                    onClick={() => onToggleAccount(conn.id)}
                    className={`
                      px-2 py-1 rounded-xl text-xs font-medium transition-all border hover:cursor-pointer
                      ${isSelected
                        ? "bg-primary border-primary text-white hover:bg-primary-hover"
                        : "bg-surface border-border text-text-main hover:border-primary/50 hover:bg-primary/5"
                      }
                      ${saving ? "opacity-60 cursor-not-allowed" : ""}
                    `}
                  >
                    <span className="flex items-center gap-1">
                      {isSelected && (
                        <span className="material-symbols-outlined leading-none" style={{ fontSize: "10px" }}>check</span>
                      )}
                      {accountLabel(conn)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {Object.keys(filteredGroups).length === 0 && (
          <div className="text-center py-4 text-text-muted">
            <span className="material-symbols-outlined text-2xl mb-1 block">search_off</span>
            <p className="text-xs">No provider accounts found</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

AccountSelectModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  connections: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      provider: PropTypes.string.isRequired,
      name: PropTypes.string,
      email: PropTypes.string,
    })
  ),
  selectedIds: PropTypes.arrayOf(PropTypes.string),
  onToggleAccount: PropTypes.func.isRequired,
  saving: PropTypes.bool,
};
