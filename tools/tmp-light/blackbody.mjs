/** Colour temperature -> linear sRGB, the way a renderer means it.
 *
 *  Blender has a Blackbody node and should be given the KELVIN, not a colour: it walks the
 *  Planckian locus itself and stays right under any view transform. This is the fallback for the
 *  consumers that have no such node — glTF viewers, the canvas — so `lamp/1` carries both and says
 *  which is which.
 *
 *  Kim et al.'s cubic for the locus in CIE 1931 xy, then xyY -> XYZ -> linear sRGB, normalised so
 *  the brightest channel is 1. Normalising on the channel rather than on luminance is deliberate:
 *  a light's colour and its output are separate numbers here, and `lumens` already carries the
 *  second one. Multiplying them together in the colour would double-count it.
 */

const poly = (c, t) => c.reduce((s, k, i) => s + k * Math.pow(t, i), 0);

/** Planckian locus x for 1667 K <= T <= 25000 K. */
function locusX(T) {
  const t = 1000 / T;
  return T <= 4000
    ? poly([0.179910, 0.8776956, -0.2343589, -0.2661239], t)
    : poly([0.240390, 0.2226347, 2.1070379, -3.0258469], t);
}

function locusY(T, x) {
  if (T <= 2222) return poly([-0.20219683, 2.18555832, -1.34811020, -1.1063814], x);
  if (T <= 4000) return poly([-0.16748867, 2.09137015, -1.37418593, -0.9549476], x);
  return poly([-0.37001483, 3.75112997, -5.87338670, 3.0817580], x);
}

/** @returns {[number, number, number]} linear sRGB, max channel 1. */
export function blackbodyRGB(kelvin) {
  const T = Math.min(25000, Math.max(1667, kelvin));
  const x = locusX(T);
  const y = locusY(T, x);
  const X = x / y, Y = 1, Z = (1 - x - y) / y;
  const rgb = [
    3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
    -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z,
    0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
  ].map((v) => Math.max(0, v));
  const m = Math.max(...rgb) || 1;
  return rgb.map((v) => Number((v / m).toFixed(6)));
}

/** The one constant that ties photometry to a renderer's watts — and the same 683 the Emissive
 *  materials already use for `luminance / 683`. Keeping them equal is what lets a lit diffuser and
 *  the lamp behind it be reconciled instead of guessed at. */
export const LM_PER_W = 683;
export const wattsFromLumens = (lm) => Number((lm / LM_PER_W).toFixed(6));
