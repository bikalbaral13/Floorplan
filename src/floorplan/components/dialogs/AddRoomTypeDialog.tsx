import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";
import type { AreaTypeDef, ParamDef } from "../../types";

export type TypeCategory = "Room" | "Segment";

/** Built-in slugs per category that user-defined types must not collide with. */
const RESERVED_SLUGS_BY_CATEGORY: Record<TypeCategory, Set<string>> = {
  Room: new Set(["room", "floorplate-boundary", "plot-boundary"]),
  Segment: new Set(["wall", "door", "window", "plot-boundary"]),
};

/** Lowercase, replace non-alphanum with `-`, trim leading/trailing dashes. */
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Camel-case identifier from a label, used as default for ParamDef.key. */
const toCamelKey = (s: string) => {
  const parts = s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts[0] + parts.slice(1).map((p) => p[0].toUpperCase() + p.slice(1)).join("");
};

type DraftParam = {
  uid: string; // local row id, not persisted
  label: string;
  key: string;
  keyTouched: boolean; // once user edits key, stop auto-deriving
  kind: ParamDef["kind"];
  // numeric
  min?: string;
  max?: string;
  step?: string;
  unit?: string;
  // shared default (string-form so a single input handles all kinds)
  default?: string;
  // select
  options?: string; // comma-separated
};

interface AddRoomTypeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing custom slugs — used to flag duplicates inline. */
  existingSlugs: string[];
  /** What kind of type is being added — controls title, placeholders, and reserved slugs.
   *  Defaults to "Room" for back-compat with the original room-only call sites. */
  category?: TypeCategory;
  onConfirm: (def: AreaTypeDef) => void;
}

export const AddRoomTypeDialog = ({
  open,
  onOpenChange,
  existingSlugs,
  category = "Room",
  onConfirm,
}: AddRoomTypeDialogProps) => {
  const reserved = RESERVED_SLUGS_BY_CATEGORY[category];
  const namePlaceholder = category === "Segment" ? "e.g. Parapet" : "e.g. Open Yard";
  const slugPlaceholder = category === "Segment" ? "parapet" : "open-yard";
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [fill, setFill] = useState("#cbd5e1");
  const [params, setParams] = useState<DraftParam[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const reset = () => {
    setName(""); setSlug(""); setSlugTouched(false); setFill("#cbd5e1");
    setParams([]); setErrors({});
  };

  const handleNameChange = (v: string) => {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
  };

  const addParam = () => {
    const uid = Math.random().toString(36).slice(2, 8);
    setParams((prev) => [...prev, {
      uid, label: "", key: "", keyTouched: false, kind: "number",
      min: "0", max: "100", step: "1", default: "0", unit: "",
    }]);
  };

  const removeParam = (uid: string) =>
    setParams((prev) => prev.filter((p) => p.uid !== uid));

  const updateParam = (uid: string, patch: Partial<DraftParam>) =>
    setParams((prev) => prev.map((p) => p.uid === uid ? { ...p, ...patch } : p));

  /** Validate and emit AreaTypeDef. Returns null on validation failure (errors set inline). */
  const validate = (): AreaTypeDef | null => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Name is required";
    const cleanSlug = slugify(slug);
    if (!cleanSlug) errs.slug = "Name produces an empty identifier — try a different name";
    else if (reserved.has(cleanSlug)) errs.slug = "Name clashes with a built-in type — try a different name";
    else if (existingSlugs.includes(cleanSlug)) errs.slug = "A type with this name already exists";

    // Param-level checks: each must have label + valid key, keys unique.
    const seenKeys = new Set<string>();
    for (const p of params) {
      if (!p.label.trim()) errs[`p_${p.uid}_label`] = "Label required";
      const key = p.key.trim() || toCamelKey(p.label);
      if (!key) errs[`p_${p.uid}_key`] = "Key required";
      else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) errs[`p_${p.uid}_key`] = "Invalid identifier";
      else if (seenKeys.has(key)) errs[`p_${p.uid}_key`] = "Duplicate key";
      else seenKeys.add(key);
      if (p.kind === "select" && !(p.options ?? "").split(",").map((s) => s.trim()).filter(Boolean).length) {
        errs[`p_${p.uid}_options`] = "At least one option required";
      }
    }

    setErrors(errs);
    if (Object.keys(errs).length > 0) return null;

    const builtParams: ParamDef[] = params.map((p) => {
      const key = p.key.trim() || toCamelKey(p.label);
      const label = p.label.trim();
      if (p.kind === "number") {
        const def: ParamDef = {
          key, label, kind: "number",
          min: p.min !== undefined && p.min !== "" ? +p.min : undefined,
          max: p.max !== undefined && p.max !== "" ? +p.max : undefined,
          step: p.step !== undefined && p.step !== "" ? +p.step : undefined,
          default: p.default !== undefined && p.default !== "" ? +p.default : undefined,
          unit: p.unit?.trim() || undefined,
        };
        return def;
      }
      if (p.kind === "boolean") {
        return { key, label, kind: "boolean", default: p.default === "true" };
      }
      if (p.kind === "select") {
        const opts = (p.options ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        return { key, label, kind: "select", options: opts, default: p.default || opts[0] };
      }
      return { key, label, kind: "text", default: p.default ?? "" };
    });

    return { id: cleanSlug, displayName: name.trim(), fill: fill || undefined, params: builtParams };
  };

  const handleConfirm = () => {
    const def = validate();
    if (!def) return;
    onConfirm(def);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add {category} Type</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Name</label>
            <Input value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder={namePlaceholder} autoFocus />
            {errors.name && <p className="mt-1 text-[10px] text-red-600">{errors.name}</p>}
            {/* Slug is auto-derived from the name and hidden from the UI; it's still
                used as the internal id stored on rooms (room.roomType = slug). */}
            {errors.slug && <p className="mt-1 text-[10px] text-red-600">{errors.slug}</p>}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Fill colour</label>
            <div className="flex items-center gap-2">
              <input type="color" value={fill} onChange={(e) => setFill(e.target.value)} className="h-8 w-12 rounded border border-slate-200" />
              <Input value={fill} onChange={(e) => setFill(e.target.value)} className="flex-1" />
            </div>
          </div>

          <div className="rounded border border-slate-200 p-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Parameters</span>
              <Button size="sm" variant="outline" onClick={addParam} className="h-7 text-xs">
                <Plus className="mr-1 h-3 w-3" /> Add parameter
              </Button>
            </div>

            {params.length === 0 && (
              <p className="text-[11px] italic text-slate-400">
                No parameters. The type will only carry the standard polygon properties.
              </p>
            )}

            {params.map((p) => (
              <div key={p.uid} className="rounded border border-slate-100 bg-slate-50 p-2 space-y-1.5">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <label className="mb-0.5 block text-[10px] text-slate-500">Label</label>
                    <Input
                      value={p.label}
                      onChange={(e) => {
                        const newLabel = e.target.value;
                        // Key is hidden from the UI but still derived internally so the
                        // ParamDef has a stable identifier for storage on room.customParams.
                        updateParam(p.uid, {
                          label: newLabel,
                          key: toCamelKey(newLabel),
                        });
                      }}
                      placeholder="Max height"
                      className="h-7 text-xs"
                    />
                    {errors[`p_${p.uid}_label`] && <p className="mt-0.5 text-[10px] text-red-600">{errors[`p_${p.uid}_label`]}</p>}
                    {errors[`p_${p.uid}_key`] && <p className="mt-0.5 text-[10px] text-red-600">{errors[`p_${p.uid}_key`]}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeParam(p.uid)}
                    className="mt-5 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    title="Remove parameter"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div>
                  <label className="mb-0.5 block text-[10px] text-slate-500">Kind</label>
                  <select
                    value={p.kind}
                    onChange={(e) => updateParam(p.uid, { kind: e.target.value as ParamDef["kind"] })}
                    className="h-7 w-full rounded border border-slate-200 bg-white px-2 text-xs"
                  >
                    <option value="number">Number</option>
                    <option value="text">Text</option>
                    <option value="boolean">Boolean</option>
                    <option value="select">Select</option>
                  </select>
                </div>

                {p.kind === "number" && (
                  <div className="grid grid-cols-4 gap-1.5">
                    <div>
                      <label className="block text-[10px] text-slate-500">Min</label>
                      <Input value={p.min ?? ""} onChange={(e) => updateParam(p.uid, { min: e.target.value })} className="h-7 text-xs" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500">Max</label>
                      <Input value={p.max ?? ""} onChange={(e) => updateParam(p.uid, { max: e.target.value })} className="h-7 text-xs" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500">Step</label>
                      <Input value={p.step ?? ""} onChange={(e) => updateParam(p.uid, { step: e.target.value })} className="h-7 text-xs" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500">Default</label>
                      <Input value={p.default ?? ""} onChange={(e) => updateParam(p.uid, { default: e.target.value })} className="h-7 text-xs" />
                    </div>
                    <div className="col-span-4">
                      <label className="block text-[10px] text-slate-500">Unit (optional)</label>
                      <Input value={p.unit ?? ""} onChange={(e) => updateParam(p.uid, { unit: e.target.value })} className="h-7 text-xs" placeholder="m, m², %, etc." />
                    </div>
                  </div>
                )}

                {p.kind === "text" && (
                  <div>
                    <label className="block text-[10px] text-slate-500">Default</label>
                    <Input value={p.default ?? ""} onChange={(e) => updateParam(p.uid, { default: e.target.value })} className="h-7 text-xs" />
                  </div>
                )}

                {p.kind === "boolean" && (
                  <div>
                    <label className="block text-[10px] text-slate-500">Default</label>
                    <select
                      value={p.default ?? "false"}
                      onChange={(e) => updateParam(p.uid, { default: e.target.value })}
                      className="h-7 w-full rounded border border-slate-200 bg-white px-2 text-xs"
                    >
                      <option value="false">false</option>
                      <option value="true">true</option>
                    </select>
                  </div>
                )}

                {p.kind === "select" && (
                  <div className="space-y-1">
                    <div>
                      <label className="block text-[10px] text-slate-500">Options (comma separated)</label>
                      <Input
                        value={p.options ?? ""}
                        onChange={(e) => updateParam(p.uid, { options: e.target.value })}
                        placeholder="A, B, C"
                        className="h-7 text-xs"
                      />
                      {errors[`p_${p.uid}_options`] && <p className="mt-0.5 text-[10px] text-red-600">{errors[`p_${p.uid}_options`]}</p>}
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500">Default</label>
                      <Input value={p.default ?? ""} onChange={(e) => updateParam(p.uid, { default: e.target.value })} className="h-7 text-xs" />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
