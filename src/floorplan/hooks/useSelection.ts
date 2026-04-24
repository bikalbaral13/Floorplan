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

  return useMemo(
    () => ({
      selectedIds,
      selectOne,
      toggleSelected,
      clearSelection,
    }),
    [selectedIds]
  );
};
