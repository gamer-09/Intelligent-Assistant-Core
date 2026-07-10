import { test } from "node:test";
import assert from "node:assert/strict";
import { learnComparative, isRelated, rankByRelation } from "./reasoningChains.js";

// Uses unique entity names so repeated test runs against the shared local
// SQLite file don't collide with real taught facts.
const A = "__test_alice__";
const B = "__test_bob__";
const C = "__test_cara__";

test("learns a comparative relation and its inverse", () => {
  const fact = learnComparative(`${A} is older than ${B}`);
  assert.ok(fact);
  assert.equal(fact?.relation, "older_than");
  assert.ok(isRelated(A, "older_than", B));
  assert.ok(isRelated(B, "younger_than", A));
});

test("resolves transitive closure across multiple hops", () => {
  learnComparative(`${A} is older than ${B}`);
  learnComparative(`${B} is older than ${C}`);
  assert.ok(isRelated(A, "older_than", C), "A should be transitively older than C");
});

test("ranks candidates by relation depth", () => {
  learnComparative(`${A} is older than ${B}`);
  learnComparative(`${B} is older than ${C}`);
  const ranked = rankByRelation("older_than", [A, B, C]);
  assert.equal(ranked[0], A);
});
