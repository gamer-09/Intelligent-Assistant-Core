/**
 * Symbolic multi-step reasoning over comparative relations, e.g.:
 *   "John is older than Sarah." "Sarah is older than Mike." "Who is oldest?"
 * Facts are stored as directed edges; answering "who is X-est" or
 * "is A more X than B" requires walking the transitive closure of the
 * relation graph — deterministic graph reasoning, no LLM involved.
 */
import { stmts, type RelationFactRow } from "../db/index.js";

const COMPARATIVES: Record<string, { relation: string; superlative: string[] }> = {
  older: { relation: "older_than", superlative: ["oldest"] },
  younger: { relation: "younger_than", superlative: ["youngest"] },
  taller: { relation: "taller_than", superlative: ["tallest"] },
  shorter: { relation: "shorter_than", superlative: ["shortest"] },
  faster: { relation: "faster_than", superlative: ["fastest"] },
  slower: { relation: "slower_than", superlative: ["slowest"] },
  bigger: { relation: "bigger_than", superlative: ["biggest", "largest"] },
  smaller: { relation: "smaller_than", superlative: ["smallest"] },
  stronger: { relation: "stronger_than", superlative: ["strongest"] },
  weaker: { relation: "weaker_than", superlative: ["weakest"] },
  richer: { relation: "richer_than", superlative: ["richest"] },
  poorer: { relation: "poorer_than", superlative: ["poorest"] },
  heavier: { relation: "heavier_than", superlative: ["heaviest"] },
  lighter: { relation: "lighter_than", superlative: ["lightest"] },
};

const INVERSE: Record<string, string> = {
  older_than: "younger_than", younger_than: "older_than",
  taller_than: "shorter_than", shorter_than: "taller_than",
  faster_than: "slower_than", slower_than: "faster_than",
  bigger_than: "smaller_than", smaller_than: "bigger_than",
  stronger_than: "weaker_than", weaker_than: "stronger_than",
  richer_than: "poorer_than", poorer_than: "richer_than",
  heavier_than: "lighter_than", lighter_than: "heavier_than",
};

export interface LearnComparativeResult { subject: string; relation: string; object: string; contradiction?: string }

/**
 * Parse "X is <comparative> than Y" statements into a stored relation fact.
 *
 * Self-critique (review §15): before inserting, checks whether the opposite
 * relation already holds between the same pair (or transitively, a cycle
 * would form) — e.g. teaching "Sarah is older than John" after "John is
 * older than Sarah" was already taught. Previously this was inserted
 * silently, leaving two contradictory edges in the graph forever with
 * nothing ever noticing. Now it's still stored (so "what's the latest
 * claim" still works) but the contradiction is surfaced to the caller.
 */
export function learnComparative(sentence: string): LearnComparativeResult | null {
  const m = sentence.match(/^([\w\s]+?)\s+(?:is|are)\s+(\w+)\s+than\s+([\w\s]+?)[.!]?$/i);
  if (!m) return null;
  const word = m[2].toLowerCase();
  const comp = COMPARATIVES[word];
  if (!comp) return null;
  const subject = m[1].trim().toLowerCase();
  const object = m[3].trim().toLowerCase();

  let contradiction: string | undefined;
  if (isRelated(object, comp.relation, subject)) {
    contradiction = `This contradicts what I already know: I previously learned that **${object}** ${comp.relation.replace("_", " ")} **${subject}** (directly, or through a chain of other facts) — the opposite of what you just told me.`;
  }

  stmts.insertRelationFact.run(subject, comp.relation, object);
  const inv = INVERSE[comp.relation];
  if (inv) stmts.insertRelationFact.run(object, inv, subject);
  return { subject, relation: comp.relation, object, contradiction };
}

function buildGraph(relation: string): Map<string, Set<string>> {
  const rows = stmts.relationFactsByRelation.all(relation) as unknown as RelationFactRow[];
  const graph = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!graph.has(r.subject)) graph.set(r.subject, new Set());
    graph.get(r.subject)!.add(r.object);
  }
  return graph;
}

/** Transitive closure reachability: does subject --relation*--> object hold? */
export function isRelated(subject: string, relation: string, object: string): boolean {
  const graph = buildGraph(relation);
  const seen = new Set<string>();
  const stack = [subject.toLowerCase()];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === object.toLowerCase()) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of graph.get(cur) ?? []) stack.push(next);
  }
  return false;
}

/** Rank a set of entities by a relation using transitive closure + topological depth. */
export function rankByRelation(relation: string, candidates?: string[]): string[] {
  const graph = buildGraph(relation);
  const nodes = candidates
    ? candidates.map((c) => c.toLowerCase())
    : [...new Set([...graph.keys(), ...[...graph.values()].flatMap((s) => [...s])])];

  // Count how many nodes each node transitively beats — higher = "more" in this relation.
  const score = new Map<string, number>();
  for (const node of nodes) {
    const seen = new Set<string>();
    const stack = [node];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const next of graph.get(cur) ?? []) {
        if (!seen.has(next)) { seen.add(next); stack.push(next); }
      }
    }
    score.set(node, seen.size);
  }
  return [...nodes].sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0));
}

export function resolveComparativeWord(word: string): { relation: string } | undefined {
  const c = COMPARATIVES[word.toLowerCase()];
  return c ? { relation: c.relation } : undefined;
}

export function resolveSuperlativeWord(word: string): { relation: string; direction: "max" } | undefined {
  const lower = word.toLowerCase();
  for (const [, c] of Object.entries(COMPARATIVES)) {
    if (c.superlative.includes(lower)) return { relation: c.relation, direction: "max" };
  }
  return undefined;
}
