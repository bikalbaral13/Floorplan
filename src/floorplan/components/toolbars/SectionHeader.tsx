/** Shared section header for foldable toolbar groups in the left sidebar. */
export const SectionHeader = ({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) => (
  <button
    type="button"
    onClick={onToggle}
    className="flex w-full items-center justify-between rounded px-1 py-0.5 text-left hover:bg-slate-100"
  >
    <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
    <span className="text-[11px] text-slate-400">{open ? "▼" : "▶"}</span>
  </button>
);
