import { useMemo, useState } from "react";

export const useSelection = () => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const selectOne = (id: string | null) => {
    if (!id) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds([id]);
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((current) => current !== id);
      }
      return [...prev, id];
    });
  };

  const clearSelection = () => setSelectedIds([]);

  /** Replace the entire selection set with the given list of ids. Used after
   *  bulk operations that promote auto-rooms (whose ids change) so the multi-
   *  selection survives the promotion. */
  const setSelection = (ids: string[]) => setSelectedIds(ids);

  return useMemo(
    () => ({
      selectedIds,
      selectOne,
      toggleSelected,
      clearSelection,
      setSelection,
    }),
    [selectedIds]
  );
};
