import { wordsToDigits } from "./units";
import SYNONYMS from "../data/synonyms.json";

/** Regional / alternative words → the word the catalog and rules use. Whole words only. */
const SYN: [RegExp, string][] = Object.entries(SYNONYMS as Record<string, string>)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([k, v]) => [new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), v]);

/** Common chat typos seen in this project's transcripts. */
const TYPOS: Record<string, string> = {
  kitchn: "kitchen", kichen: "kitchen", bedrom: "bedroom", bedroon: "bedroom", livingroom: "living room",
  bathrom: "bathroom", toliet: "toilet", wardobe: "wardrobe", wadrobe: "wardrobe", windo: "window",
  dor: "door", wal: "wall", seater: "seater", corridoor: "corridor", dinning: "dining", balcany: "balcony",
  plz: "please", pls: "please",
};

export function normalize(input: string): string {
  let s = input.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
  s = s.replace(/\b[a-z]+\b/g, (w) => TYPOS[w] ?? w);
  for (const [re, to] of SYN) s = s.replace(re, to);
  s = wordsToDigits(s);
  // Politeness and filler carry no meaning for a command.
  s = s.replace(/^(please|pls|can you|could you|kindly|i want to|i want you to|i want|i need|i'd like|we need|let's|lets|just)\s+/g, "");
  s = s.replace(/\s+(please|thanks|thank you)$/g, "");
  return s.replace(/[.!?]+$/, "").trim();
}

/** Embeddings read "don't move the bed" as "move the bed" — negated commands never run locally. */
export const isNegated = (s: string): boolean => /\b(don't|dont|do not|never|no need to|stop)\b/.test(s);

const VERB = String.raw`(?:add|put|place|draw|make|set|move|shift|rotate|turn|delete|remove|rename|call|hide|show|merge|combine|resize|widen|extend|replace|swap|select|create|go|switch|open|load|clear|undo|redo|tile|attach|detect)`;

/** "add a door and widen the room then hide MEP" → three commands. Only splits on "and"/"then" when a
 *  command verb follows, so "living and dining" stays whole. */
export function splitCommands(s: string): string[] {
  return s
    .split(new RegExp(String.raw`\s*(?:;|,?\s+and then\s+|,?\s+then\s+|,?\s+and\s+(?=${VERB}\b)|,\s+(?=${VERB}\b))\s*`))
    .map((x) => x.trim())
    .filter(Boolean);
}
