import type { ElevRect } from "../flow/eval/floorplanElevation";

/** Floorplan "Views" overlay aligned to the live plan. The four elevations sit in edge strips around the
 *  plan (Back top / Front bottom / Left / Right) and are drawn through the SAME pan/zoom transform as the
 *  canvas on their shared axis — so a wall / door / window lines up vertically with Front & Back and
 *  horizontally with Left & Right. Height is drawn at true scale (ppm × zoom) from a ground line next to
 *  the plan. The centre stays clear so the live canvas plan shows through.
 *
 *  World → screen on the shared axis: `a * scale + position[axis]` (matches the canvas WorldViewport). */
export function AlignedElevations({
  front, back, left, right, scale, position, ppm, width, height,
}: {
  front: ElevRect[]; back: ElevRect[]; left: ElevRect[]; right: ElevRect[];
  scale: number; position: { x: number; y: number }; ppm: number; width: number; height: number;
}) {
  const s = scale, px = position.x, py = position.y, mpp = ppm * scale; // metres → screen px
  const topH = height * 0.24, botY = height * 0.76, leftW = width * 0.22, rightX = width * 0.78;
  const stroke = "#0f172a";

  const KIND_COLOR = { wall: stroke, door: "#b45309", window: "#2563eb" } as const;
  // Draw one element cell: dotted grey for hidden lines, else coloured by kind — doors get a hinge leaf,
  // windows a mid mullion + sill line — so the elevation reads as doors/windows, not plain boxes.
  const cell = (key: string, x: number, y: number, w: number, h: number, kind: ElevRect["kind"], dashed?: boolean) => {
    if (w < 0.5 || h < 0.5) return null;
    if (dashed) return <rect key={key} x={x} y={y} width={w} height={h} fill="none" stroke="#94a3b8" strokeWidth={0.75} strokeDasharray="3 2" />;
    const c = KIND_COLOR[kind] ?? stroke;
    const extras: JSX.Element[] = [];
    if (kind === "window" && h > 6) extras.push(<line key="wm" x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2} stroke={c} strokeWidth={0.6} />);
    if (kind === "door" && h > 6) extras.push(<line key="dl" x1={x + Math.min(w * 0.18, 6)} y1={y} x2={x + Math.min(w * 0.18, 6)} y2={y + h} stroke={c} strokeWidth={0.6} />);
    return <g key={key}><rect x={x} y={y} width={w} height={h} fill="none" stroke={c} strokeWidth={1} />{extras}</g>;
  };
  // Hidden (dashed) first so solid elements draw on top.
  const ordered = (rects: ElevRect[]) => [...rects].sort((a, b) => (a.dashed ? 0 : 1) - (b.dashed ? 0 : 1));
  // Front & Back share the X axis (a → screenX); height rises from a ground line toward the plan edge.
  const horizRects = (rects: ElevRect[], groundY: number) => ordered(rects).map((r, i) => {
    const x0 = r.a0 * s + px, x1 = r.a1 * s + px;
    const yTop = groundY - r.h1 * mpp, yBot = groundY - r.h0 * mpp;
    return cell(`${i}`, Math.min(x0, x1), Math.min(yTop, yBot), Math.abs(x1 - x0), Math.abs(yBot - yTop), r.kind, r.dashed);
  });
  // Left & Right share the Y axis (a → screenY); height grows horizontally away from the plan.
  const vertRects = (rects: ElevRect[], groundX: number, dir: 1 | -1) => ordered(rects).map((r, i) => {
    const y0 = r.a0 * s + py, y1 = r.a1 * s + py;
    const xFar = groundX + dir * r.h1 * mpp, xNear = groundX + dir * r.h0 * mpp;
    return cell(`${i}`, Math.min(xFar, xNear), Math.min(y0, y1), Math.abs(xFar - xNear), Math.abs(y1 - y0), r.kind, r.dashed);
  });

  const label = (t: string, x: number, y: number) => (
    <text x={x} y={y} fontSize={10} fontWeight={600} fill="#64748b" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>{t}</text>
  );

  return (
    <svg className="pointer-events-none absolute inset-0 z-20" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <clipPath id="elev-back"><rect x={0} y={0} width={width} height={topH} /></clipPath>
        <clipPath id="elev-front"><rect x={0} y={botY} width={width} height={height - botY} /></clipPath>
        <clipPath id="elev-left"><rect x={0} y={topH} width={leftW} height={botY - topH} /></clipPath>
        <clipPath id="elev-right"><rect x={rightX} y={topH} width={width - rightX} height={botY - topH} /></clipPath>
      </defs>

      {/* Strip backgrounds + separators (centre left clear for the live plan). */}
      <rect x={0} y={0} width={width} height={topH} fill="#ffffff" />
      <rect x={0} y={botY} width={width} height={height - botY} fill="#ffffff" />
      <rect x={0} y={topH} width={leftW} height={botY - topH} fill="#ffffff" />
      <rect x={rightX} y={topH} width={width - rightX} height={botY - topH} fill="#ffffff" />
      <line x1={0} y1={topH} x2={width} y2={topH} stroke="#cbd5e1" strokeWidth={1} />
      <line x1={0} y1={botY} x2={width} y2={botY} stroke="#cbd5e1" strokeWidth={1} />
      <line x1={leftW} y1={topH} x2={leftW} y2={botY} stroke="#cbd5e1" strokeWidth={1} />
      <line x1={rightX} y1={topH} x2={rightX} y2={botY} stroke="#cbd5e1" strokeWidth={1} />

      {/* Elevations — drawn through the canvas transform on the shared axis, clipped to their strips. */}
      <g clipPath="url(#elev-back)">{horizRects(back, topH - 4)}<line x1={0} y1={topH - 4} x2={width} y2={topH - 4} stroke="#94a3b8" strokeWidth={0.75} /></g>
      <g clipPath="url(#elev-front)">{horizRects(front, height - 4)}<line x1={0} y1={height - 4} x2={width} y2={height - 4} stroke="#94a3b8" strokeWidth={0.75} /></g>
      <g clipPath="url(#elev-left)">{vertRects(left, leftW - 4, -1)}<line x1={leftW - 4} y1={topH} x2={leftW - 4} y2={botY} stroke="#94a3b8" strokeWidth={0.75} /></g>
      <g clipPath="url(#elev-right)">{vertRects(right, rightX + 4, 1)}<line x1={rightX + 4} y1={topH} x2={rightX + 4} y2={botY} stroke="#94a3b8" strokeWidth={0.75} /></g>

      {label("Back", 6, 14)}
      {label("Front", 6, botY + 14)}
      {label("Left", 6, topH + 14)}
      {label("Right", rightX + 6, topH + 14)}
    </svg>
  );
}
