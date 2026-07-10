/**
 * Example plugin: proves the plugin architecture works end-to-end.
 * Drop any file here that default-exports a ToolSpec and it's auto-loaded.
 */
import type { ToolSpec } from "../core/tools.js";

const FACTS = [
  "Octopuses have three hearts and blue blood.",
  "Honey never spoils if stored properly — archaeologists have found edible honey in ancient Egyptian tombs.",
  "A day on Venus is longer than its year.",
  "Bananas are berries, but strawberries technically aren't.",
  "The Eiffel Tower can grow about 15cm taller in summer due to thermal expansion.",
];

const plugin: ToolSpec = {
  name: "random_science_fact",
  description: "Returns a random self-contained science/trivia fact (example plugin).",
  capabilities: ["plugin_demo"],
  permission: "read",
  inputs: "None",
  outputs: "A short trivia sentence",
  execute: () => FACTS[Math.floor(Math.random() * FACTS.length)],
};

export default plugin;
