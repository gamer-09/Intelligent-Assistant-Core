import { test } from "node:test";
import assert from "node:assert/strict";
import { stitchAnswers, markFailures } from "./planner.js";

test("flags a subtask whose answer matches a known failure signature", () => {
  const marked = markFailures([
    { subtask: "what is 2+2", answer: "= **4**" },
    { subtask: "asdkjhaskjdh", answer: "I didn't quite catch that. Try: ..." },
  ]);
  assert.equal(marked[0].failed, false);
  assert.equal(marked[1].failed, true);
});

test("stitched output reports how many steps failed", () => {
  const text = stitchAnswers([
    { subtask: "a", answer: "ok" },
    { subtask: "b", answer: "I'm not confident I understood that (confidence 10%)." },
  ]);
  assert.match(text, /1 of 2 step\(s\)/);
});
