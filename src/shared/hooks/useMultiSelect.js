import { useState, useMemo, useCallback } from 'react';

export function useMultiSelect(items, idKey = 'id') {
  const [selectedIds, setSelectedIds] = useState([]);

  const allSelected = useMemo(() =>
    items.length > 0 && items.every(item => selectedIds.includes(item[idKey])),
    [items, selectedIds, idKey]
  );

  const toggleItem = useCallback((id) => {
    setSelectedIds(prev =>
      prev.includes(id)
        ? prev.filter(x => x !== id)
        : [...prev, id]
    );
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds(prev =>
      allSelected ? [] : items.map(item => item[idKey])
    );
  }, [items, idKey, allSelected]);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const selectedItems = useMemo(() =>
    items.filter(item => selectedIds.includes(item[idKey])),
    [items, selectedIds, idKey]
  );

  return {
    selectedIds,
    selectedItems,
    allSelected,
    toggleItem,
    toggleAll,
    clearSelection,
    setSelectedIds,
  };
}
