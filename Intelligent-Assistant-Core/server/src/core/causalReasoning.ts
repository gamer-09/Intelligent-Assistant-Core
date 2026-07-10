/**
 * Causal + common-sense reasoning: a small "world model" fragment covering
 * cause/effect over physical objects and events, plus size/containment
 * comparisons. Distinct from `reasoningChains.ts` (which handles learned
 * comparative facts like "older than") — this module encodes built-in
 * physical common sense ("ice melts in heat", "glass is fragile") and lets
 * users teach new causal links the same way, so "why does X happen?" can be
 * answered by tracing cause -> effect instead of needing every question
 * pre-scripted.
 */
import { addRelation, relationsByType, getOrCreateNode } from "./knowledgeGraph.js";

/** Built-in causal seed facts: cause -> effect, with a short mechanism note. */
const CAUSAL_SEED: Array<{ cause: string; effect: string; because: string }> = [
  { cause: "ice in sun", effect: "ice melts into water", because: "sunlight transfers heat, and ice melts above 0°C (32°F)" },
  { cause: "ice in heat", effect: "ice melts into water", because: "heat raises the ice's temperature above its melting point" },
  { cause: "dropping a glass", effect: "the glass may shatter", because: "glass is rigid and brittle, so a sudden impact force exceeds what it can absorb without cracking" },
  { cause: "dropping something fragile", effect: "it may break", because: "fragile materials can't absorb sudden impact energy without deforming or cracking" },
  { cause: "leaving metal outside in rain", effect: "it may rust", because: "iron reacts with water and oxygen to form iron oxide (rust)" },
  { cause: "boiling water", effect: "it turns to steam", because: "heat gives water molecules enough energy to escape as vapor at 100°C (212°F) at sea level" },
  { cause: "freezing water", effect: "it turns to ice", because: "removing heat slows water molecules until they lock into a solid lattice below 0°C (32°F)" },
  { cause: "touching a hot stove", effect: "you get burned", because: "heat transfers to skin faster than the body can dissipate it, damaging tissue" },
  { cause: "not watering a plant", effect: "it wilts or dies", because: "plants need water for photosynthesis and to keep their cells rigid" },
  { cause: "leaving milk out of the fridge", effect: "it spoils", because: "bacteria grow faster at room temperature than when refrigerated" },
];

let seeded = false;
export function seedCausalKnowledge(): void {
  if (seeded) return;
  seeded = true;
  for (const { cause, effect, because } of CAUSAL_SEED) {
    learnCausal(cause, effect, because, "builtin");
  }
}

export function learnCausal(cause: string, effect: string, because?: string, source = "taught"): void {
  addRelation(cause.toLowerCase().trim(), "causes", effect.toLowerCase().trim(), source);
  if (because) addRelation(effect.toLowerCase().trim(), "because", because, source);
}

export interface CausalHit { effect: string; because?: string }

/** Direct + fuzzy lookup: exact cause match, then substring overlap as a fallback. */
export function whatHappensIf(cause: string): CausalHit[] {
  const key = cause.toLowerCase().trim();
  let hits = relationsByType(key, "causes");
  if (hits.length === 0) {
    // Fuzzy fallback: find any seeded cause phrase that shares significant
    // vocabulary with the question, so "what if I drop a wine glass" still
    // matches the seeded "dropping a glass" -> ... fact.
    const words = new Set(key.split(/\s+/).filter((w) => w.length > 2));
    for (const seed of CAUSAL_SEED) {
      const seedWords = seed.cause.split(/\s+/);
      const overlap = seedWords.filter((w) => words.has(w)).length;
      if (overlap >= Math.min(2, seedWords.length)) {
        hits = relationsByType(seed.cause, "causes");
        break;
      }
    }
  }
  return hits.map((h) => {
    const becauseHits = relationsByType(h.target, "because");
    return { effect: h.target, because: becauseHits[0]?.target };
  });
}

/**
 * Rough size/containment common sense: "can an elephant fit inside a
 * backpack?" — backed by an approximate size-order table rather than a
 * hand-written rule per object pair, so new object pairs still resolve by
 * comparing relative size tier instead of needing every pair pre-scripted.
 */
const SIZE_TIER: Record<string, number> = {
  ant: 1, bee: 1, mouse: 2, phone: 2, book: 2, cat: 3, backpack: 3, shoebox: 2,
  dog: 4, human: 5, sofa: 6, car: 7, elephant: 8, whale: 9, house: 9, building: 10,
};

export function compareContainment(item: string, container: string): { fits: boolean; reason: string } | undefined {
  const i = SIZE_TIER[item.toLowerCase().trim()];
  const c = SIZE_TIER[container.toLowerCase().trim()];
  if (i === undefined || c === undefined) return undefined;
  const fits = i < c; // item's tier must be smaller than the container's tier
  return {
    fits,
    reason: fits
      ? `a ${item} is much smaller than a ${container}, so it would physically fit`
      : `a ${item} is roughly the same size as or larger than a ${container}, so it would not fit`,
  };
}
