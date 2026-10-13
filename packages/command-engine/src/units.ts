// Numbers, lengths, angles and directions. RULES ONLY: embeddings can't tell 3 m from 4 m or left from
// right, so nothing here ever goes near a vector.

const WORD_NUM: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, half: 0.5, a: 1, an: 1,
};

/** "two" → "2" etc. (only standalone words; "a"/"an" are left alone here — too ambiguous). */
export function wordsToDigits(s: string): string {
  return s.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g, (w) => String(WORD_NUM[w]));
}

const UNIT = String.raw`(mm|millimet(?:er|re)s?|cm|centimet(?:er|re)s?|m|met(?:er|re)s?|mtrs?|ft|feet|foot|'|in|inch(?:es)?|")`;
const NUM = String.raw`(\d+(?:\.\d+)?)`;

function toMetres(v: number, unit?: string): number {
  if (!unit) return v >= 50 ? v / 1000 : v; // bare: ≥50 reads as millimetres ("900 wide"), else metres
  if (/^mm|^millim/.test(unit)) return v / 1000;
  if (/^cm|^centim/.test(unit)) return v / 100;
  if (/^(ft|feet|foot|')$/.test(unit)) return v * 0.3048;
  if (/^(in|inch|")/.test(unit)) return v * 0.0254;
  return v;
}

export interface Length { m: number; raw: string; index: number; hadUnit: boolean }

/** Every length in the text, in metres. Handles 5'6", 900 mm, 1.2 m, bare numbers. Skips numbers glued
 *  to words ("room3", "level 1" is the caller's job to strip first). */
export function lengths(s: string): Length[] {
  const out: Length[] = [];
  const feetInch = new RegExp(String.raw`(\d+)\s*(?:'|ft|feet)\s*(\d+(?:\.\d+)?)\s*(?:"|in|inch(?:es)?)`, "g");
  const taken: [number, number][] = [];
  for (const m of s.matchAll(feetInch)) {
    out.push({ m: +m[1] * 0.3048 + +m[2] * 0.0254, raw: m[0], index: m.index!, hadUnit: true });
    taken.push([m.index!, m.index! + m[0].length]);
  }
  const re = new RegExp(String.raw`(?<![\w.])${NUM}\s*${UNIT}?(?![\w])`, "g");
  for (const m of s.matchAll(re)) {
    const at = m.index!;
    if (taken.some(([a, b]) => at >= a && at < b)) continue;
    out.push({ m: toMetres(+m[1], m[2]), raw: m[0], index: at, hadUnit: !!m[2] });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** "4x3.5", "4 by 3.5 m", "4m x 3.5m" → [w, h] metres. A trailing unit applies to both. */
export function dims(s: string): [number, number] | null {
  const m = new RegExp(String.raw`${NUM}\s*${UNIT}?\s*(?:x|×|by|\*)\s*${NUM}\s*${UNIT}?`).exec(s);
  if (!m) return null;
  const u = m[4] ?? m[2];
  return [toMetres(+m[1], m[2] ?? u), toMetres(+m[3], u)];
}

/** "90 degrees", "rotate 45", "clockwise" (= 90), "anticlockwise" (= -90), "turn around" (= 180). */
export function angle(s: string): number | null {
  const m = /(-?\d+(?:\.\d+)?)\s*(?:°|deg(?:rees?)?)?/.exec(s);
  const sign = /\b(anti-?clockwise|counter-?clockwise|ccw)\b/.test(s) ? -1 : 1;
  if (m) return sign * +m[1];
  if (/\b(around|upside down)\b/.test(s)) return 180;
  if (/\b(clockwise|cw|anti-?clockwise|counter-?clockwise|ccw)\b/.test(s)) return sign * 90;
  return null;
}

export function percent(s: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(%|percent)/.exec(s);
  return m ? +m[1] / 100 : null;
}

export type Side = "N" | "S" | "E" | "W";
/** Plan convention: top of the page = north, +y down. "left/right/up/down" are screen directions. */
export function side(s: string): Side | null {
  const m = /\b(north|south|east|west|top|bottom|left|right|up|down|front|back|rear)(?:ern)?\b/.exec(s);
  if (!m) return null;
  return ({ north: "N", top: "N", up: "N", back: "N", rear: "N", south: "S", bottom: "S", down: "S", front: "S", east: "E", right: "E", west: "W", left: "W" } as Record<string, Side>)[m[1]];
}

export const SIDE_VEC: Record<Side, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
