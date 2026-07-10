import { test } from "node:test";
import assert from "node:assert/strict";
import { detectIntent } from "./intent-detector.js";

test("detects a math intent for an arithmetic expression", () => {
  const r = detectIntent("what is 12 * 4?");
  assert.equal(r.intent, "math");
  assert.ok(r.confidence > 0);
});

test("detects a datetime intent for date questions", () => {
  const r = detectIntent("what is today's date?");
  assert.equal(r.intent, "datetime");
});

test("falls back to low confidence on unrecognized input", () => {
  const r = detectIntent("xyzzy plugh zzzork");
  assert.ok(r.confidence < 0.5);
});
