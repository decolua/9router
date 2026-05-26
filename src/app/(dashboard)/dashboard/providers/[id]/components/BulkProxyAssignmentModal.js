import { Button, Modal } from "@/shared/components";

export default function BulkProxyAssignmentModal({
  isOpen,
  onClose,
  connectionsCount,
  bulkUpdatingProxy,
  activePools,
  proxyPools,
  handleApplyOneToOne,
  handleApplySinglePool,
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Apply Proxy (${connectionsCount} connections)`}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col">
          <button
            onClick={handleApplyOneToOne}
            disabled={bulkUpdatingProxy || activePools.length === 0}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px] text-text-muted">
              sync_alt
            </span>
            <span className="text-sm text-text-main">One-to-one (rotate)</span>
          </button>
          <button
            onClick={() => handleApplySinglePool(null)}
            disabled={bulkUpdatingProxy}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px] text-text-muted">
              link_off
            </span>
            <span className="text-sm text-text-main">None (unbind all)</span>
          </button>
          {proxyPools.map((pool) => (
            <button
              key={pool.id}
              onClick={() => handleApplySinglePool(pool.id)}
              disabled={bulkUpdatingProxy || pool.isActive !== true}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px] text-text-muted">
                lan
              </span>
              <span className="truncate text-sm text-text-main">
                {pool.name}
              </span>
              {pool.isActive !== true && (
                <span className="text-[10px] text-text-muted">(inactive)</span>
              )}
            </button>
          ))}
        </div>

        {bulkUpdatingProxy && (
          <p className="text-xs text-text-muted">Applying...</p>
        )}

        <Button
          onClick={onClose}
          variant="ghost"
          fullWidth
          disabled={bulkUpdatingProxy}
        >
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
