import { test } from "node:test";
import assert from "node:assert/strict";
import { learnIsA, categoryChain, inferCategoryProperty } from "./knowledgeGraph.js";

const KIWI = "__test_kiwi_bird__";

test("transfers category properties without an explicit fact", () => {
  learnIsA(KIWI, "bird");
  assert.ok(categoryChain(KIWI).includes("bird"));
  const inferred = inferCategoryProperty(KIWI, "lays_eggs");
  assert.ok(inferred);
  assert.equal(inferred?.via, "bird");
});

test("returns undefined for unknown categories instead of guessing", () => {
  const inferred = inferCategoryProperty("__test_unknown_thing__", "lays_eggs");
  assert.equal(inferred, undefined);
});
