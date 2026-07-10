import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import chatRouter from "./routes/chat.js";
import assistantRouter from "./routes/assistant.js";
import geminiRouter from "./routes/gemini.js";
import { isGeminiConfigured } from "./core/geminiClient.js";
import { seedKnowledgeGraph } from "./core/knowledgeGraph.js";
import { buildSemanticIndex } from "./core/semantic.js";
import { registerBuiltinTools } from "./core/registerTools.js";
import { loadPlugins } from "./core/plugins.js";
import { CAPABILITIES } from "./nlp/capabilities.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = parseInt(process.env.PORT ?? "3001", 10);

app.use(cors());
app.use(express.json());

// Bootstrap the growth/reasoning layer: knowledge graph seed data, the
// semantic (BM25) intent index built from capability examples, the formal
// tool registry, and any drop-in plugins.
const GEO_CAPITALS: Record<string, string> = { france:"Paris",germany:"Berlin",japan:"Tokyo",usa:"Washington D.C.","united states":"Washington D.C.",uk:"London","united kingdom":"London",canada:"Ottawa",australia:"Canberra",china:"Beijing",india:"New Delhi",brazil:"Brasília",russia:"Moscow",italy:"Rome",spain:"Madrid",mexico:"Mexico City",argentina:"Buenos Aires","south africa":"Pretoria",egypt:"Cairo",nigeria:"Abuja",kenya:"Nairobi",thailand:"Bangkok",indonesia:"Jakarta","south korea":"Seoul",pakistan:"Islamabad","new zealand":"Wellington",sweden:"Stockholm",norway:"Oslo",denmark:"Copenhagen",finland:"Helsinki",netherlands:"Amsterdam",portugal:"Lisbon",greece:"Athens",turkey:"Ankara",poland:"Warsaw" };
const DEFINITION_TERMS: Record<string, string> = { algorithm:"", api:"", ai:"", blockchain:"", cloud:"", database:"", encryption:"", http:"", "machine learning":"", "open source":"", recursion:"", variable:"" };
const INVENTION_TEXTS: Record<string, string> = {
  "world wide web": "Tim Berners-Lee invented the World Wide Web in 1989.",
  internet: "The internet evolved from ARPANET, developed by the US Department of Defense in the 1960s.",
  telephone: "Alexander Graham Bell is credited with inventing the telephone in 1876.",
  "light bulb": "Thomas Edison developed a practical incandescent light bulb in 1879.",
  airplane: "The Wright Brothers (Orville and Wilbur) made the first powered flight in 1903.",
  computer: "Charles Babbage conceptualised the first computer; ENIAC (1945) was one of the first electronic computers.",
  penicillin: "Alexander Fleming discovered penicillin in 1928.",
  gravity: "Isaac Newton formulated the law of universal gravitation in 1687.",
  relativity: "Albert Einstein developed special relativity (1905) and general relativity (1915).",
};
seedKnowledgeGraph({ capitals: GEO_CAPITALS, definitions: DEFINITION_TERMS, inventions: INVENTION_TEXTS });

// Map capability ids -> the actual intent name they correspond to, so the
// semantic (BM25) index's examples are labeled with real, routable intents.
const CAPABILITY_TO_INTENT: Record<string, string> = {
  "math-arithmetic": "math", "math-percentage": "math", "math-prime": "math", "math-fibonacci": "math",
  "math-factorial": "math", "math-sqrt": "math", "math-trig": "math", "math-log": "math",
  "math-gcd-lcm": "math", "math-average": "math",
  "datetime-current": "datetime", "datetime-days": "datetime",
  "convert-temperature": "conversion", "convert-distance": "conversion", "convert-weight": "conversion",
  "text-wordcount": "text_analysis", "text-charcount": "text_analysis", "text-reverse": "text_analysis",
  "text-palindrome": "text_analysis", "text-case": "text_analysis",
  "knowledge-capitals": "general_knowledge", "knowledge-countries": "general_knowledge",
  "knowledge-inventions": "general_knowledge", "knowledge-definitions": "definition",
  "number-facts": "number_fact", "number-random-fact": "number_fact",
  "word-spell": "word_game", "word-scramble": "word_game",
  "list-manage": "list", "reminder-set": "reminder",
  "convo-greeting": "greeting", "convo-joke": "joke", "convo-smalltalk": "small_talk", "convo-help": "help",
  "learn-teach": "teach", "learn-correct": "correct", "learn-reasoning": "reasoning",
  "learn-challenge": "challenge", "learn-research": "research",
};
buildSemanticIndex(
  CAPABILITIES.flatMap((c) => c.examples.map((text) => ({ intent: CAPABILITY_TO_INTENT[c.id] ?? c.category.toLowerCase(), text })))
);
registerBuiltinTools();
loadPlugins().then((loaded) => {
  if (loaded.length) console.log(`   Plugins: ${loaded.join(", ")}`);
});

// API routes
app.use("/api/chat", chatRouter);
app.use("/api/assistant", assistantRouter);
app.use("/api/gemini", geminiRouter);

// Health check
app.get("/api/healthz", (_req, res) => res.json({ status: "ok" }));

// Serve built frontend in production
const CLIENT_DIST = path.join(__dirname, "..", "..", "client", "dist");
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`\n🤖 Intelligent Assistant Core`);
  console.log(`   API:    http://localhost:${PORT}/api`);
  if (fs.existsSync(CLIENT_DIST)) {
    console.log(`   App:    http://localhost:${PORT}`);
  } else {
    console.log(`   Client: run "npm run dev:client" separately`);
  }
  console.log(`   Mode:   self-contained NLP (no external APIs)`);
  console.log(`   Gemini tab: ${isGeminiConfigured() ? "enabled (GEMINI_API_KEY set)" : "disabled — set GEMINI_API_KEY to enable"}\n`);
});
