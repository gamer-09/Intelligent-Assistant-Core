/**
 * Knowledge graph: entities (nodes) connected by typed relations (edges),
 * seeded from the static dictionaries and learned facts. Lets the assistant
 * traverse relationships ("Python" --created_by--> "Guido van Rossum")
 * instead of treating every fact as an isolated string.
 */
import { db, stmts, type KgEdgeRow } from "../db/index.js";

export function getOrCreateNode(name: string, kind = "concept", source = "builtin"): number {
  const key = name.toLowerCase().trim();
  stmts.upsertNode.run(key, kind, source);
  const row = stmts.getNode.get(key) as { id: number } | undefined;
  return row!.id;
}

export function addRelation(from: string, relation: string, to: string, source = "builtin", weight = 1.0): void {
  const fromId = getOrCreateNode(from, "concept", source);
  const toId = getOrCreateNode(to, "concept", source);
  stmts.insertEdge.run(fromId, relation, toId, null, weight, source);
}

export function addLiteralRelation(from: string, relation: string, literal: string, source = "builtin", weight = 1.0): void {
  const fromId = getOrCreateNode(from, "concept", source);
  stmts.insertEdge.run(fromId, relation, null, literal, weight, source);
}

export interface RelationHit { relation: string; target: string; weight: number; source: string; }

/** All outgoing relations for a node (case-insensitive match on name). */
export function relationsFrom(name: string): RelationHit[] {
  const node = stmts.getNode.get(name.toLowerCase().trim()) as { id: number } | undefined;
  if (!node) return [];
  const rows = stmts.edgesFrom.all(node.id) as unknown as KgEdgeRow[];
  return rows.map((r) => ({ relation: r.relation, target: (r.to_name ?? r.to_literal ?? "") as string, weight: r.weight, source: r.source }));
}

export function relationsByType(name: string, relation: string): RelationHit[] {
  const node = stmts.getNode.get(name.toLowerCase().trim()) as { id: number } | undefined;
  if (!node) return [];
  const rows = stmts.edgesFromByRelation.all(node.id, relation) as unknown as KgEdgeRow[];
  return rows.map((r) => ({ relation: r.relation, target: (r.to_name ?? r.to_literal ?? "") as string, weight: r.weight, source: r.source }));
}

/** 2-hop traversal: "X --r1--> Y --r2--> Z", used for simple chained lookups. */
export function traverse2Hop(name: string, r1: string, r2: string): RelationHit[] {
  const first = relationsByType(name, r1);
  const out: RelationHit[] = [];
  for (const hop of first) {
    out.push(...relationsByType(hop.target, r2));
  }
  return out;
}

let seeded = false;

/**
 * Seed the graph from the static knowledge dictionaries. Idempotent
 * (upserts), safe to call on every boot.
 */
export function seedKnowledgeGraph(data: {
  capitals: Record<string, string>;
  definitions: Record<string, string>;
  inventions: Record<string, string>;
}): void {
  if (seeded) return;
  seeded = true;
  db.exec("BEGIN");
  try {
    for (const [country, capital] of Object.entries(data.capitals)) {
      addRelation(country, "capital_of", capital, "builtin");
      addRelation(capital, "is_capital_of", country, "builtin");
    }
    for (const [term] of Object.entries(data.definitions)) {
      addLiteralRelation(term, "is_a", "concept", "builtin");
    }
    // Inventions: "telephone" -> invented_by -> "Alexander Graham Bell" (+ year if parseable)
    for (const [thing, text] of Object.entries(data.inventions)) {
      const m = text.match(/^([A-Z][^.]+?)\s+(?:is credited with )?(?:invented|developed|discovered|conceptualised|made|formulated)[^.]*?\bin\s+(\d{4})/i)
        ?? text.match(/^([A-Z][^.]+?)\s+(?:invented|developed|discovered|conceptualised|made|formulated)/i);
      if (m) {
        addRelation(thing, "invented_by", m[1].trim(), "builtin");
        const yearM = text.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
        if (yearM) addLiteralRelation(thing, "invented_year", yearM[1], "builtin");
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Record a taught fact as a graph edge too, so KG-based reasoning sees it. */
export function addTaughtFact(key: string, value: string): void {
  addLiteralRelation(key, "taught_as", value, "taught");
}

// ─── Category membership + property inheritance (transfer learning) ───────────
//
// Review finding: "if Yang learns 'a kiwi is a bird', can it infer kiwis lay
// eggs without a separate stored fact?" Previously no — every fact was an
// isolated string with no inheritance. This adds a real (if small) is-a
// hierarchy: membership in a category (`X is_a_kind_of Y`) plus a table of
// properties known for common categories, so a new member of a known
// category immediately inherits those properties without being taught them
// individually. This is genuine transfer of knowledge, not more storage.

/** A handful of built-in category -> property facts, used for inheritance. */
const CATEGORY_PROPERTIES: Record<string, Record<string, string>> = {
  bird: { lays_eggs: "yes", can_fly: "usually (most, not all — e.g. penguins and kiwis can't)", warm_blooded: "yes", has_feathers: "yes" },
  fish: { lives_in: "water", warm_blooded: "no", lays_eggs: "usually" },
  mammal: { warm_blooded: "yes", lays_eggs: "no (with rare exceptions like the platypus)", nurses_young: "yes" },
  reptile: { warm_blooded: "no", lays_eggs: "usually" },
  insect: { leg_count: "6", warm_blooded: "no" },
  amphibian: { warm_blooded: "no", lays_eggs: "usually", lives_in: "water and land" },
  plant: { photosynthesizes: "yes", can_move: "no" },
  vehicle: { man_made: "yes", can_move: "yes" },
};

/** Learn "X is a Y" as category membership, distinct from a generic literal fact. */
export function learnIsA(entity: string, category: string): void {
  addRelation(entity.toLowerCase().trim(), "is_a_kind_of", category.toLowerCase().trim(), "taught");
}

/** Walk the is-a chain up to `maxHops`, collecting every category the entity belongs to. */
export function categoryChain(entity: string, maxHops = 4): string[] {
  const seen = new Set<string>();
  let frontier = [entity.toLowerCase().trim()];
  for (let hop = 0; hop < maxHops && frontier.length; hop++) {
    const next: string[] = [];
    for (const item of frontier) {
      for (const hit of relationsByType(item, "is_a_kind_of")) {
        if (!seen.has(hit.target)) { seen.add(hit.target); next.push(hit.target); }
      }
    }
    frontier = next;
  }
  return [...seen];
}

/**
 * Transfer-learning lookup: does `entity` have `property`? Checks the is-a
 * chain against the built-in category property table rather than requiring
 * the fact to be individually taught for every entity.
 */
export function inferCategoryProperty(entity: string, property: string): { value: string; via: string } | undefined {
  for (const category of categoryChain(entity)) {
    const props = CATEGORY_PROPERTIES[category];
    if (props && props[property]) return { value: props[property], via: category };
  }
  return undefined;
}

/** List every known property a category confers, for explanatory answers. */
export function categoryProperties(category: string): Record<string, string> | undefined {
  return CATEGORY_PROPERTIES[category.toLowerCase().trim()];
}
