import { Plus, X } from "lucide-react";
import { renderPrims, type RenderPrim } from "./flowTypes";

let primSeq = 1;
export const nextPrimId = () => `pr_${primSeq++}_${Math.random().toString(36).slice(2, 6)}`;

/** The kinds each Render node offers, with the fields that kind actually uses. Adding a kind here is the
 *  whole change — the editor and both evaluators read this table. */
const KINDS_2D: { value: string; label: string; fields: (keyof RenderPrim)[] }[] = [
  { value: "polygon", label: "Polygon", fields: [] },
  { value: "circle", label: "Circle", fields: ["radius", "x", "y"] },
  // Stroke takes a SEGMENT list, not a point list, and thickens each segment to a band of Width — the open
  // -path row the two fill kinds could not express.
  { value: "stroke", label: "Stroke", fields: ["width"] },
];
const KINDS_3D: { value: string; label: string; fields: (keyof RenderPrim)[] }[] = [
  { value: "cuboid", label: "Cuboid", fields: ["length", "breadth", "height", "x", "y", "z"] },
  { value: "cylinder", label: "Cylinder", fields: ["radius", "height", "x", "y", "z"] },
  // The solid-of-revolution / tapered kinds — the row twins of the standalone 3D-primitive nodes. Each maps
  // straight through as the mass's `shape`, which the 3D canvas already meshes, so a row and the equivalent
  // node build the identical solid. Wire a position list and one row builds one per point.
  { value: "sphere", label: "Sphere", fields: ["radius", "x", "y", "z"] },
  { value: "cone", label: "Cone", fields: ["radius", "height", "x", "y", "z"] },
  // Capsule's Length is the MID length (the straight part); the pill stands `length + 2 × radius` tall.
  { value: "capsule", label: "Capsule", fields: ["radius", "length", "x", "y", "z"] },
  // Frustum: Radius is the BOTTOM, Top radius the top — equal gives a cylinder, 0 gives a cone.
  { value: "frustum", label: "Frustum", fields: ["radius", "radiusTop", "height", "x", "y", "z"] },
  { value: "tapered-box", label: "Tapered Box", fields: ["length", "breadth", "topLength", "topBreadth", "height", "x", "y", "z"] },
  // Torus is the POINT-positioned donut, lying flat: Radius is the ring (hole centre → tube centre), Tube
  // radius the section, Arc° the sweep. Ring below is the same solid oriented by a wired axis segment.
  { value: "torus", label: "Torus", fields: ["radius", "tubeRadius", "arcDeg", "x", "y", "z"] },
  // Polyhedron takes its whole shape from the wired FACE LIST, so it has no dimension fields — X / Y / Z
  // shift the finished mesh. The 3D twin of the Polygon row.
  { value: "polyhedron", label: "Polyhedron", fields: ["x", "y", "z"] },
  // Tube / Ring read an AXIS-SEGMENT list and so carry their own orientation — the one thing a Cylinder row
  // cannot, its axis being fixed to vertical. Ring's Radius is the ring; Tube radius is the section.
  { value: "tube", label: "Tube", fields: ["radius", "x", "y", "z"] },
  { value: "ring", label: "Ring", fields: ["radius", "tubeRadius", "x", "y", "z"] },
  // Loft has no dimensions either — the wired SECTION STACK is the solid, exactly as Polyhedron's face list
  // is. X / Y / Z shift the finished mesh.
  { value: "loft", label: "Loft", fields: ["x", "y", "z"] },
];
const FIELD_LABEL: Partial<Record<keyof RenderPrim, string>> = {
  radius: "Radius", width: "Width", tubeRadius: "Tube radius",
  length: "Length", breadth: "Breadth", height: "Height", x: "X", y: "Y", z: "Z",
  radiusTop: "Top radius", topLength: "Top length", topBreadth: "Top breadth", arcDeg: "Arc°",
};

export const kindsFor = (is3d: boolean) => (is3d ? KINDS_3D : KINDS_2D);

/** The primitive-row editor shared by the 2D and 3D Render nodes — the drawing twin of InputPropsEditor.
 *  Each row is a KIND + its numeric fields + colour + layer, and `onRowRef` anchors the row so the node can
 *  hang that row's own `valin-<id>` / `val-<id>` endpoints beside it. */
export const RenderPrimsEditor = ({
  params,
  is3d,
  onParamChange,
  onRowRef,
  nodrag,
}: {
  params: Record<string, unknown>;
  is3d: boolean;
  onParamChange: (key: string, value: unknown) => void;
  onRowRef?: (primId: string, el: HTMLDivElement | null) => void;
  nodrag?: boolean;
}) => {
  const prims = renderPrims(params, is3d);
  const kinds = kindsFor(is3d);
  const nd = nodrag ? " nodrag" : "";
  const setPrims = (next: RenderPrim[]) => onParamChange("prims", next);
  const update = (id: string, patch: Partial<RenderPrim>) =>
    setPrims(prims.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const addPrim = () => setPrims([...prims, {
    id: nextPrimId(), kind: kinds[0].value, name: "", color: is3d ? "#94a3b8" : "#0891b2", layer: "",
    radius: 1, width: 0.1, tubeRadius: 0.1, length: 3, breadth: 2, height: 3, x: 0, y: 0, z: 0,
    radiusTop: 0.8, topLength: 2, topBreadth: 1.5, arcDeg: 360,
    lineStyle: "solid", fillMode: "filled", hatch: "none", hatchSpacing: 8, hatchWeight: 1,
    opacity: 1, displayType: "solid", showEdges: false, show: true,
  }]);
  const inputCls = `h-6 rounded border border-slate-200 px-1.5 text-[10px]${nd}`;

  return (
    <div className="space-y-1.5">
      {prims.map((p, i) => {
        const fields = kinds.find((k) => k.value === p.kind)?.fields ?? [];
        return (
          <div
            key={p.id}
            ref={(el) => { onRowRef?.(p.id, el); }}
            className="space-y-1 rounded border border-slate-200 bg-slate-50/70 p-1.5"
          >
            {/* Row 1 — kind + name + remove. The kind picks which fields show below. */}
            <div className="flex items-center gap-1">
              <select
                className={`${inputCls} w-24 shrink-0`}
                value={p.kind}
                onChange={(e) => update(p.id, { kind: e.target.value })}
              >
                {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
              <input
                type="text"
                className={`${inputCls} min-w-0 flex-1`}
                placeholder={`Primitive ${i + 1}`}
                value={p.name}
                onChange={(e) => update(p.id, { name: e.target.value })}
              />
              <label className="flex shrink-0 items-center" title="Draw this row">
                <input type="checkbox" className={nd.trim()} checked={p.show} onChange={(e) => update(p.id, { show: e.target.checked })} />
              </label>
              <button
                type="button"
                title="Remove primitive"
                className="nodrag flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                onClick={() => setPrims(prims.filter((x) => x.id !== p.id))}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            {/* Row 2 — the numeric fields this kind uses. A wired list's extra columns override them
                per piece (Circle: a third column is that circle's radius; 3D: a third column is its Z). */}
            {fields.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                {fields.map((f) => (
                  <label key={String(f)} className="flex items-center gap-1 text-[9px] text-slate-500">
                    {FIELD_LABEL[f] ?? String(f)}
                    <input
                      type="number"
                      step="0.05"
                      className={`${inputCls} w-14`}
                      value={Number(p[f] ?? 0)}
                      onChange={(e) => update(p.id, { [f]: Number(e.target.value) || 0 } as Partial<RenderPrim>)}
                    />
                  </label>
                ))}
              </div>
            )}
            {/* Row 3 — colour + the LAYER the drawn pieces are created on (both nodes). */}
            <div className="flex items-center gap-1">
              <input
                type="color"
                className={`h-6 w-8 shrink-0 cursor-pointer rounded border border-slate-200 bg-white${nd}`}
                value={p.color}
                onChange={(e) => update(p.id, { color: e.target.value })}
              />
              <input
                type="text"
                className={`${inputCls} min-w-0 flex-1`}
                placeholder="Layer"
                value={p.layer}
                onChange={(e) => update(p.id, { layer: e.target.value })}
              />
            </div>
            {/* Row 4 — material. 2D: line style · fill · hatch, so a row can be a dashed setting-out line, a
                hollow outline or a hatched poché without a second node. 3D: opacity · solid/wireframe · edges,
                the same three a Display 3D node sets — on the row, so one node can carry several materials.
                A Stroke row is a band, not a ring: only its line style applies. */}
            {is3d ? (
              <div className="flex flex-wrap items-center gap-1">
                <label className="flex items-center gap-1 text-[9px] text-slate-500">
                  Opacity
                  <input
                    type="number" step="0.05" min="0" max="1"
                    className={`${inputCls} w-14`}
                    value={p.opacity}
                    onChange={(e) => update(p.id, { opacity: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })}
                  />
                </label>
                <select
                  className={`${inputCls} w-24`}
                  value={p.displayType}
                  onChange={(e) => update(p.id, { displayType: e.target.value as RenderPrim["displayType"] })}
                >
                  <option value="solid">Solid</option>
                  <option value="wireframe">Wireframe</option>
                </select>
                <label className="flex items-center gap-1 text-[9px] text-slate-500" title="Draw the mesh's edge outline">
                  <input type="checkbox" className={nd.trim()} checked={p.showEdges} onChange={(e) => update(p.id, { showEdges: e.target.checked })} />
                  Edges
                </label>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1">
                <select
                  className={`${inputCls} w-20`}
                  value={p.lineStyle}
                  onChange={(e) => update(p.id, { lineStyle: e.target.value as RenderPrim["lineStyle"] })}
                  title="Outline style"
                >
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                  <option value="dotted">Dotted</option>
                </select>
                {p.kind !== "stroke" && (
                  <>
                    <select
                      className={`${inputCls} w-20`}
                      value={p.fillMode}
                      onChange={(e) => update(p.id, { fillMode: e.target.value as RenderPrim["fillMode"] })}
                      title="Fill mode"
                    >
                      <option value="filled">Filled</option>
                      <option value="outlined">Outlined</option>
                    </select>
                    <select
                      className={`${inputCls} w-20`}
                      value={p.hatch}
                      onChange={(e) => update(p.id, { hatch: e.target.value as RenderPrim["hatch"] })}
                      title="Poché hatch"
                    >
                      <option value="none">No hatch</option>
                      <option value="diagonal">Diagonal</option>
                      <option value="dots">Dots</option>
                    </select>
                    {p.hatch !== "none" && (
                      <label className="flex items-center gap-1 text-[9px] text-slate-500">
                        Pitch
                        <input
                          type="number" step="1" min="2"
                          className={`${inputCls} w-12`}
                          value={p.hatchSpacing}
                          onChange={(e) => update(p.id, { hatchSpacing: Math.max(2, Number(e.target.value) || 8) })}
                        />
                      </label>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className="nodrag flex h-6 w-full items-center justify-center gap-1 rounded border border-dashed border-slate-300 text-[10px] text-slate-500 hover:bg-slate-50"
        onClick={addPrim}
      >
        <Plus className="h-3 w-3" /> Add primitive
      </button>
    </div>
  );
};
