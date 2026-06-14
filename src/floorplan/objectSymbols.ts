/**
 * objectSymbols.ts
 *
 * Primitive top-view (plan) SVG symbols for "object" nodes (furniture / fixtures). Each symbol is
 * drawn in a 0–100 square viewBox and stretched to the object's width × height when rendered in the
 * Architectural view. Strokes use `currentColor`-free explicit colours so the data-URL renders
 * identically as a Konva image.
 *
 * Keep these primitive and schematic — they're plan annotations, not detailed furniture art.
 */

const STROKE = "#334155";
const FILL = "rgba(148,163,184,0.18)";

/** Wrap inner markup in a square viewBox with shared stroke defaults. */
const svg = (inner: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="${STROKE}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">${inner}</svg>`;

/** Outer body rectangle shared by most symbols. */
const body = (r = 4) => `<rect x="4" y="4" width="92" height="92" rx="${r}" fill="${FILL}"/>`;

export const OBJECT_SYMBOL_SVGS: Record<string, string> = {
  // Bed: mattress with a pillow band at the top and a turned-down sheet line.
  bed: svg(`${body(6)}<rect x="12" y="10" width="76" height="22" rx="4"/><line x1="50" y1="10" x2="50" y2="32"/><line x1="4" y1="48" x2="96" y2="48"/>`),
  // Sofa: thick back (top) + two arms (sides) + seat cushions.
  sofa: svg(`${body(8)}<rect x="4" y="4" width="92" height="22" rx="6"/><rect x="4" y="22" width="20" height="74" rx="6"/><rect x="76" y="22" width="20" height="74" rx="6"/><line x1="50" y1="30" x2="50" y2="92"/>`),
  // Table: plain top with a faint inner outline.
  table: svg(`${body(6)}<rect x="16" y="16" width="68" height="68" rx="4"/>`),
  // Chair: seat square with a back bar along the top edge.
  chair: svg(`${body(6)}<rect x="10" y="6" width="80" height="14" rx="4"/><rect x="14" y="24" width="72" height="68" rx="6"/>`),
  // Desk: worktop with a thin modesty panel strip at the back.
  desk: svg(`${body(4)}<rect x="4" y="4" width="92" height="16" rx="2"/>`),
  // Wardrobe: two doors with handles.
  wardrobe: svg(`${body(2)}<line x1="50" y1="4" x2="50" y2="96"/><line x1="42" y1="44" x2="42" y2="56"/><line x1="58" y1="44" x2="58" y2="56"/>`),
  // Bookshelf: horizontal shelves.
  bookshelf: svg(`${body(2)}<line x1="4" y1="29" x2="96" y2="29"/><line x1="4" y1="50" x2="96" y2="50"/><line x1="4" y1="71" x2="96" y2="71"/>`),
  // Cabinet: two doors with small round knobs.
  cabinet: svg(`${body(2)}<line x1="50" y1="4" x2="50" y2="96"/><circle cx="42" cy="50" r="3"/><circle cx="58" cy="50" r="3"/>`),
  // Refrigerator: freezer/fridge split with a vertical handle.
  refrigerator: svg(`${body(4)}<line x1="4" y1="40" x2="96" y2="40"/><line x1="80" y1="14" x2="80" y2="30"/><line x1="80" y1="52" x2="80" y2="84"/>`),
  // Stove: four burners.
  stove: svg(`${body(4)}<circle cx="34" cy="34" r="12"/><circle cx="66" cy="34" r="12"/><circle cx="34" cy="66" r="12"/><circle cx="66" cy="66" r="12"/>`),
  // Sink: basin (rounded rect) with a faucet circle at the back.
  sink: svg(`${body(4)}<rect x="20" y="28" width="60" height="56" rx="8"/><circle cx="50" cy="16" r="4"/>`),
  // Toilet: cistern (top rect) + bowl (oval).
  toilet: svg(`${body(6)}<rect x="20" y="6" width="60" height="20" rx="3"/><ellipse cx="50" cy="58" rx="26" ry="32"/>`),
  // Bathtub: outer tub with inner basin and a drain.
  bathtub: svg(`${body(14)}<rect x="14" y="14" width="72" height="72" rx="10"/><circle cx="50" cy="78" r="4"/>`),
  // Washbasin: oval basin with a faucet.
  washbasin: svg(`${body(10)}<ellipse cx="50" cy="54" rx="34" ry="26"/><circle cx="50" cy="16" r="4"/>`),
  // TV unit: long cabinet with a centred screen mark.
  "tv-unit": svg(`${body(2)}<line x1="4" y1="60" x2="96" y2="60"/><rect x="34" y="14" width="32" height="34" rx="2"/>`),
};

/** Fallback symbol for an unknown kind — a plain labelled box. */
const FALLBACK = svg(`${body(4)}<line x1="20" y1="50" x2="80" y2="50"/><line x1="50" y1="20" x2="50" y2="80"/>`);

/** A data URL for the given object kind's primitive symbol, usable as an <img>/Konva Image src. */
export const objectSymbolDataUrl = (kind?: string): string => {
  const markup = (kind && OBJECT_SYMBOL_SVGS[kind]) || FALLBACK;
  return `data:image/svg+xml;utf8,${encodeURIComponent(markup)}`;
};
