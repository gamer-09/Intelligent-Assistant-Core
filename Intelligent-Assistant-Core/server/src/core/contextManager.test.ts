import { test } from "node:test";
import assert from "node:assert/strict";
import { rememberTopic, resolveReference } from "./contextManager.js";

test("resolves a bare pronoun follow-up to the last remembered topic", () => {
  const session = "__test_session_ref__";
  rememberTopic(session, "the Eiffel Tower");
  const r = resolveReference(session, "what about that one?");
  assert.equal(r.resolved, true);
  assert.equal(r.text, "the Eiffel Tower");
});

test("leaves concrete questions untouched", () => {
  const session = "__test_session_ref_2__";
  rememberTopic(session, "the Eiffel Tower");
  const r = resolveReference(session, "what is 2 + 2?");
  assert.equal(r.resolved, false);
});

test("does nothing when there is no prior topic", () => {
  const r = resolveReference("__test_session_never_seen__", "continue");
  assert.equal(r.resolved, false);
});
