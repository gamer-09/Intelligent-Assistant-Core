import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateExpression } from "./mathParser.js";

test("evaluates basic arithmetic with correct precedence", () => {
  const r = evaluateExpression("2 + 3 * 4");
  assert.equal(r.error, null);
  assert.equal(r.value, 14);
});

test("evaluates functions and constants", () => {
  const r = evaluateExpression("sqrt(16) + round(pi)");
  assert.equal(r.error, null);
  assert.equal(r.value, 7);
});

test("rejects malformed expressions instead of throwing", () => {
  const r = evaluateExpression("2 + * 3");
  assert.equal(r.value, null);
  assert.ok(r.error);
});

test("enforces a length ceiling", () => {
  const r = evaluateExpression("1+".repeat(500));
  assert.equal(r.value, null);
  assert.ok(r.error);
});
