import { test } from "node:test";
import assert from "node:assert/strict";
import { seedCausalKnowledge, whatHappensIf, compareContainment, learnCausal } from "./causalReasoning.js";

seedCausalKnowledge();

test("answers a seeded cause with an effect and mechanism", () => {
  const hits = whatHappensIf("ice in the sun");
  assert.ok(hits.length > 0);
  assert.match(hits[0].effect, /melt/i);
  assert.ok(hits[0].because);
});

test("fuzzy-matches a novel phrasing of a seeded cause", () => {
  const hits = whatHappensIf("dropping a wine glass");
  assert.ok(hits.length > 0);
  assert.match(hits[0].effect, /shatter|break/i);
});

test("newly taught causal facts are retrievable", () => {
  learnCausal("__test_pressing_test_button__", "__test_alarm_sounds__", "it triggers a test circuit");
  const hits = whatHappensIf("__test_pressing_test_button__");
  assert.equal(hits[0].effect, "__test_alarm_sounds__");
});

test("size/containment common sense resolves fit questions", () => {
  const elephantInBackpack = compareContainment("elephant", "backpack");
  assert.equal(elephantInBackpack?.fits, false);
  const phoneInBackpack = compareContainment("phone", "backpack");
  assert.equal(phoneInBackpack?.fits, true);
});
