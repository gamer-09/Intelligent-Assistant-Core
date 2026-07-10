import type { DetectedIntent } from "./intent-detector.js";
import { stmts, type ConversationRow, type LearnedFactRow } from "../db/index.js";
import {
  teachFact,
  findFactMatch,
  learnCorrection,
  findCorrection,
  noteResearchGap,
  normalizeQuery,
} from "./memory.js";
import { evaluateExpression } from "../core/mathParser.js";
import { addTaughtFact, relationsFrom, relationsByType } from "../core/knowledgeGraph.js";
import { learnComparative, isRelated, rankByRelation, resolveSuperlativeWord } from "../core/reasoningChains.js";
import { bestFactMatch } from "../core/memoryRanking.js";
import { lookupTopic, formatWebResult } from "../core/webIntel.js";
import { searchTavily, formatTavilyResult } from "../core/tavily.js";
import { indexDocumentFile, searchDocuments, listIndexedDocuments, DOCS_ROOT } from "../core/docIntel.js";
import { findSymbol } from "../core/codeIntel.js";
import { startGoal, getActiveGoal, completeStep, formatGoal } from "../core/goals.js";
import { formatToolList } from "../core/tools.js";
import { getLastTopic, getLastUserQuery, getLastAssistantResponse } from "../core/contextManager.js";
import path from "path";

// Session-scoped in-memory state
const sessionReminders = new Map<string, string[]>();
const sessionLists = new Map<string, string[]>();
const sessionChallenges = new Map<string, { question: string; answer: number }>();
// Tracks the original question awaiting a correction across a two-turn
// "that's wrong" -> "actually it's X" exchange, so the correction is
// applied to the original question rather than the "that's wrong" message.
const pendingCorrections = new Map<string, { question: string; wrongAnswer?: string }>();

export function clearSession(sessionId: string): void {
  sessionReminders.delete(sessionId);
  sessionLists.delete(sessionId);
  sessionChallenges.delete(sessionId);
  pendingCorrections.delete(sessionId);
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;
  for (let i = 3; i <= Math.sqrt(n); i += 2) if (n % i === 0) return false;
  return true;
}

function fibonacci(n: number): number[] {
  const seq = [0, 1];
  for (let i = 2; i < n; i++) seq.push(seq[i - 1] + seq[i - 2]);
  return seq.slice(0, n);
}

function factorial(n: number): bigint {
  let r = BigInt(1);
  for (let i = 2; i <= n; i++) r *= BigInt(i);
  return r;
}

function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }
function lcm(a: number, b: number): number { return (a * b) / gcd(a, b); }

// Real recursive-descent parser/evaluator (core/mathParser.ts) — no dynamic
// code execution. Word-operators are normalized to symbols first since the
// parser grammar only knows symbolic operators.
function safeMath(expr: string): number | null {
  const cleaned = expr
    .replace(/\bplus\b/gi, "+").replace(/\bminus\b/gi, "-")
    .replace(/\btimes\b/gi, "*").replace(/\bdivided by\b/gi, "/")
    .replace(/\bmultiplied by\b/gi, "*").replace(/×/g, "*").replace(/÷/g, "/")
    .replace(/\^/g, "^");
  const { value } = evaluateExpression(cleaned);
  return value;
}

function fmt(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString();
  return parseFloat(n.toFixed(6)).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

// ─── Conversion helpers ───────────────────────────────────────────────────────

function convertTemp(value: number, from: string, to: string): string {
  const f = from.toUpperCase()[0], t = to.toUpperCase()[0];
  let c = f === "F" ? (value - 32) * 5 / 9 : f === "K" ? value - 273.15 : value;
  const r = t === "F" ? c * 9 / 5 + 32 : t === "K" ? c + 273.15 : c;
  const u = (x: string) => x === "C" ? "°C" : x === "F" ? "°F" : "K";
  return `${fmt(value)} ${u(f)} = **${fmt(parseFloat(r.toFixed(4)))} ${u(t)}**`;
}

function convertDist(value: number, from: string, to: string): string {
  const toM: Record<string, number> = { km:1000, m:1, cm:0.01, mm:0.001, mile:1609.34, miles:1609.34, mi:1609.34, feet:0.3048, foot:0.3048, ft:0.3048, yard:0.9144, yards:0.9144, inch:0.0254, inches:0.0254 };
  const fv = toM[from.toLowerCase()] ?? toM[from.toLowerCase().replace(/s$/,"")];
  const tv = toM[to.toLowerCase()] ?? toM[to.toLowerCase().replace(/s$/,"")];
  if (!fv || !tv) return `Unknown unit "${from}" or "${to}". Try: km, m, cm, mm, miles, feet, yards, inches.`;
  return `${fmt(value)} ${from} = **${fmt(parseFloat(((value * fv) / tv).toFixed(6)))} ${to}**`;
}

function convertWeight(value: number, from: string, to: string): string {
  const toG: Record<string, number> = { kg:1000, kilogram:1000, kilograms:1000, g:1, gram:1, grams:1, mg:0.001, lb:453.592, lbs:453.592, pound:453.592, pounds:453.592, oz:28.3495, ounce:28.3495, ounces:28.3495, ton:1e6, tons:1e6 };
  const fv = toG[from.toLowerCase()] ?? toG[from.toLowerCase().replace(/s$/,"")];
  const tv = toG[to.toLowerCase()] ?? toG[to.toLowerCase().replace(/s$/,"")];
  if (!fv || !tv) return `Unknown unit "${from}" or "${to}". Try: kg, g, mg, lb, oz, ton.`;
  return `${fmt(value)} ${from} = **${fmt(parseFloat(((value * fv) / tv).toFixed(6)))} ${to}**`;
}

// ─── Knowledge data ───────────────────────────────────────────────────────────

const GEO: Record<string, string> = {
  france:"France is a country in Western Europe. Capital: Paris. Population: ~68M. Most visited country in the world.",
  germany:"Germany is in Central Europe. Capital: Berlin. Population: ~84M. Largest economy in the EU.",
  japan:"Japan is an island nation in East Asia. Capital: Tokyo. Population: ~125M. Known for technology, anime, and sushi.",
  usa:"The United States. Capital: Washington D.C. Population: ~335M. World's largest economy by nominal GDP.",
  "united states":"The United States. Capital: Washington D.C. Population: ~335M.",
  uk:"The United Kingdom. Capital: London. Population: ~68M. Comprises England, Scotland, Wales, and Northern Ireland.",
  "united kingdom":"The United Kingdom. Capital: London. Population: ~68M.",
  canada:"Canada is the second-largest country by area. Capital: Ottawa. Population: ~40M. Bilingual (English/French).",
  australia:"Australia is both a country and a continent. Capital: Canberra. Population: ~26M. Home to the Great Barrier Reef.",
  china:"China. Capital: Beijing. Population: ~1.4B. World's second-largest GDP. Oldest continuous civilisation.",
  india:"India is the world's most populous country (~1.44B). Capital: New Delhi. World's largest democracy.",
  brazil:"Brazil is the largest country in South America. Capital: Brasília. Population: ~216M. Largest rainforest in the world.",
  russia:"Russia is the world's largest country by area. Capital: Moscow. Spans 11 time zones.",
  italy:"Italy is in southern Europe. Capital: Rome. Population: ~60M. Known for art, architecture, and cuisine.",
  spain:"Spain is in southwestern Europe. Capital: Madrid. Population: ~47M. Famous for flamenco and football.",
  mexico:"Mexico is in North America. Capital: Mexico City. Population: ~130M. Ancient Aztec and Maya civilisations.",
  argentina:"Argentina is in southern South America. Capital: Buenos Aires. Population: ~46M. Tango and Messi's homeland.",
  "south africa":"South Africa is at the tip of the African continent. Capital: Pretoria. Population: ~60M. Known for the Kruger National Park.",
  egypt:"Egypt is in North Africa. Capital: Cairo. Population: ~104M. Home to the ancient pyramids and Sphinx.",
  nigeria:"Nigeria is the most populous country in Africa (~220M). Capital: Abuja. Largest economy in Africa.",
  kenya:"Kenya is in East Africa. Capital: Nairobi. Population: ~55M. Known for wildlife safaris and the Maasai Mara.",
  thailand:"Thailand is in Southeast Asia. Capital: Bangkok. Population: ~72M. Known for temples, beaches, and cuisine.",
  indonesia:"Indonesia is the world's largest archipelago (17,000+ islands). Capital: Jakarta. Population: ~274M.",
  "south korea":"South Korea is in East Asia. Capital: Seoul. Population: ~52M. Home of K-pop, Samsung, and Hyundai.",
  pakistan:"Pakistan is in South Asia. Capital: Islamabad. Population: ~230M.",
  "new zealand":"New Zealand is in the South Pacific. Capital: Wellington. Population: ~5M. Famous for LOTR filming locations.",
  sweden:"Sweden is in Northern Europe. Capital: Stockholm. Population: ~10M. Known for IKEA, Volvo, and ABBA.",
  norway:"Norway is in Northern Europe. Capital: Oslo. Population: ~5.4M. Consistently ranks highest in happiness indices.",
  denmark:"Denmark is in Northern Europe. Capital: Copenhagen. Population: ~5.9M. Birthplace of LEGO.",
  finland:"Finland is in Northern Europe. Capital: Helsinki. Population: ~5.5M. World's happiest country (multiple years).",
  netherlands:"The Netherlands is in Western Europe. Capital: Amsterdam. Population: ~17.5M. Famous for tulips, windmills, and cycling.",
  portugal:"Portugal is in southwestern Europe. Capital: Lisbon. Population: ~10.3M. First global maritime empire.",
  greece:"Greece is in southeastern Europe. Capital: Athens. Population: ~10.4M. Birthplace of democracy and the Olympics.",
  turkey:"Turkey spans Europe and Asia. Capital: Ankara. Population: ~85M. Famous for the Bosphorus and Hagia Sophia.",
  poland:"Poland is in Central Europe. Capital: Warsaw. Population: ~38M. Largest economy in Central Europe.",
  "saudi arabia":"Saudi Arabia is in the Middle East. Capital: Riyadh. Population: ~36M. World's largest oil exporter.",
  "united arab emirates":"The UAE is in the Middle East. Capital: Abu Dhabi. Population: ~10M. Home to the world's tallest building, the Burj Khalifa.",
  israel:"Israel is in the Middle East. Capital: Jerusalem. Population: ~9.8M. One of the world's most advanced tech hubs.",
  singapore:"Singapore is a city-state in Southeast Asia. Population: ~5.9M. One of the world's most prosperous countries.",
  switzerland:"Switzerland is in Central Europe. Capital: Bern. Population: ~8.8M. Known for banking, chocolate, and neutrality.",
  ukraine:"Ukraine is in Eastern Europe. Capital: Kyiv. Population: ~44M. Largest country entirely within Europe.",
  ethiopia:"Ethiopia is in East Africa. Capital: Addis Ababa. Population: ~120M. Oldest independent African nation.",
  colombia:"Colombia is in South America. Capital: Bogotá. Population: ~52M. Famous for coffee and emeralds.",
  ghana:"Ghana is in West Africa. Capital: Accra. Population: ~34M. First sub-Saharan country to gain independence (1957).",
};

const CAPITALS: Record<string, string> = {
  france:"Paris",germany:"Berlin",japan:"Tokyo",usa:"Washington D.C.","united states":"Washington D.C.",uk:"London","united kingdom":"London",canada:"Ottawa",australia:"Canberra",china:"Beijing",india:"New Delhi",brazil:"Brasília",russia:"Moscow",italy:"Rome",spain:"Madrid",mexico:"Mexico City",argentina:"Buenos Aires","south africa":"Pretoria",egypt:"Cairo",nigeria:"Abuja",kenya:"Nairobi",thailand:"Bangkok",indonesia:"Jakarta","south korea":"Seoul",pakistan:"Islamabad","new zealand":"Wellington",sweden:"Stockholm",norway:"Oslo",denmark:"Copenhagen",finland:"Helsinki",netherlands:"Amsterdam",portugal:"Lisbon",greece:"Athens",turkey:"Ankara",poland:"Warsaw",
  "saudi arabia":"Riyadh","united arab emirates":"Abu Dhabi",uae:"Abu Dhabi",israel:"Jerusalem",singapore:"Singapore",switzerland:"Bern",ukraine:"Kyiv",ethiopia:"Addis Ababa",colombia:"Bogotá",ghana:"Accra",peru:"Lima",chile:"Santiago","czech republic":"Prague",czechia:"Prague",hungary:"Budapest",romania:"Bucharest",austria:"Vienna",belgium:"Brussels",ireland:"Dublin",vietnam:"Hanoi",philippines:"Manila",malaysia:"Kuala Lumpur",bangladesh:"Dhaka","sri lanka":"Colombo",nepal:"Kathmandu",iran:"Tehran",iraq:"Baghdad",jordan:"Amman",qatar:"Doha",oman:"Muscat",libya:"Tripoli",algeria:"Algiers",morocco:"Rabat",tunisia:"Tunis",sudan:"Khartoum",tanzania:"Dodoma",zambia:"Lusaka",zimbabwe:"Harare",angola:"Luanda",rwanda:"Kigali",uganda:"Kampala",mozambique:"Maputo",iceland:"Reykjavik",croatia:"Zagreb",serbia:"Belgrade",albania:"Tirana",slovakia:"Bratislava",slovenia:"Ljubljana",estonia:"Tallinn",latvia:"Riga",lithuania:"Vilnius",belarus:"Minsk",georgia:"Tbilisi",armenia:"Yerevan",azerbaijan:"Baku",afghanistan:"Kabul",taiwan:"Taipei",venezuela:"Caracas",ecuador:"Quito",bolivia:"Sucre",paraguay:"Asunción",uruguay:"Montevideo",cuba:"Havana",jamaica:"Kingston",haiti:"Port-au-Prince","dominican republic":"Santo Domingo","costa rica":"San José",panama:"Panama City","el salvador":"San Salvador",nicaragua:"Managua",honduras:"Tegucigalpa",guatemala:"Guatemala City",
};

const DEFINITIONS: Record<string, string> = {
  algorithm:"An **algorithm** is a step-by-step set of instructions for solving a problem. It's the recipe a computer follows.",
  api:"An **API** (Application Programming Interface) is a set of rules that lets different software communicate with each other.",
  ai:"**Artificial Intelligence** is the simulation of human intelligence in machines — including machine learning, NLP, and computer vision.",
  blockchain:"A **blockchain** is a distributed ledger — a tamper-resistant chain of records stored across many computers.",
  cloud:"**Cloud computing** means delivering computing services (servers, storage, software) over the internet instead of local hardware.",
  database:"A **database** is an organised collection of structured data that allows efficient storage, retrieval, and management.",
  encryption:"**Encryption** converts readable data into an unreadable format using a key — only authorised parties can decrypt it.",
  http:"**HTTP** (HyperText Transfer Protocol) is the foundation of web communication. HTTPS is its secure, encrypted version.",
  "machine learning":"**Machine Learning** is a type of AI where computers learn from data rather than being explicitly programmed.",
  "open source":"**Open source** software has publicly available source code — anyone can view, use, modify, and distribute it.",
  recursion:"**Recursion** is when a function calls itself to solve a smaller version of the same problem.",
  variable:"A **variable** is a named container in programming that stores a value which can change as the program runs.",
  // New additions
  "object-oriented":"**Object-Oriented Programming (OOP)** organises code around *objects* — bundles of data and behaviour — making code more modular and reusable.",
  oop:"**Object-Oriented Programming (OOP)** organises code around *objects* — bundles of data and behaviour — making code more modular and reusable.",
  "functional programming":"**Functional programming** treats computation as the evaluation of mathematical functions, avoiding shared state and mutable data.",
  "big o":"**Big-O notation** describes how an algorithm's runtime or space usage grows as its input size increases (e.g. O(n) = linear, O(n²) = quadratic).",
  cache:"A **cache** stores frequently accessed data in fast memory so future requests are served faster. The trade-off is memory vs. speed.",
  concurrency:"**Concurrency** means multiple tasks make progress at the same time by interleaving execution — distinct from true parallelism.",
  parallelism:"**Parallelism** means multiple tasks literally execute simultaneously on multiple CPU cores, unlike concurrency which interleaves.",
  "rest api":"A **REST API** (Representational State Transfer) exposes resources via standard HTTP verbs (GET, POST, PUT, DELETE) with stateless requests.",
  tcp:"**TCP** (Transmission Control Protocol) is a reliable, connection-oriented protocol that ensures all packets arrive in order.",
  "tcp/ip":"**TCP/IP** is the foundational communication protocol of the internet — TCP ensures delivery, IP handles addressing and routing.",
  dns:"**DNS** (Domain Name System) translates human-readable domain names (e.g. google.com) into IP addresses computers can route to.",
  "ip address":"An **IP address** is a unique numerical label assigned to each device on a network, enabling routing of traffic.",
  "binary":"**Binary** is the base-2 numeral system using only 0s and 1s — the fundamental language of all digital computers.",
  bit:"A **bit** is the smallest unit of data in computing — a single 0 or 1.",
  byte:"A **byte** is 8 bits. Files, memory, and storage are measured in bytes, kilobytes, megabytes, gigabytes, etc.",
  compiler:"A **compiler** translates high-level source code (e.g. C++) into machine code before the program runs.",
  interpreter:"An **interpreter** executes source code line by line at runtime (e.g. Python, JavaScript in browsers).",
  os:"An **operating system (OS)** manages hardware and provides services for programs — examples: Windows, macOS, Linux.",
  git:"**Git** is a distributed version control system that tracks code changes and enables collaboration via branches, commits, and merges.",
  "version control":"**Version control** systems (e.g. Git) track changes to files over time so you can revert, branch, and collaborate.",
  docker:"**Docker** packages software into **containers** — isolated, portable environments that run consistently anywhere.",
  kubernetes:"**Kubernetes** (K8s) automates deployment, scaling, and management of containerised applications across clusters.",
  cpu:"The **CPU** (Central Processing Unit) is the primary processor — it executes instructions and performs calculations.",
  gpu:"The **GPU** (Graphics Processing Unit) excels at parallel computation — originally for graphics, now essential for AI/ML.",
  ram:"**RAM** (Random Access Memory) is fast, temporary memory used while a program runs. Data is lost when powered off.",
  sql:"**SQL** (Structured Query Language) is the standard language for querying and manipulating relational databases.",
  nosql:"**NoSQL** databases store data in non-tabular formats (documents, key-value, graph) and scale horizontally with ease.",
  typescript:"**TypeScript** is a typed superset of JavaScript that compiles to plain JS — it adds static typing and modern features.",
  python:"**Python** is a high-level, readable programming language widely used for data science, AI, web development, and scripting.",
  javascript:"**JavaScript** is the language of the web — it runs in browsers and (via Node.js) on servers to power interactivity.",
};

const INVENTIONS: Record<string, string> = {
  "world wide web":"Tim Berners-Lee invented the World Wide Web in 1989 at CERN.",
  internet:"The internet evolved from ARPANET, developed by the US Department of Defense in the 1960s.",
  telephone:"Alexander Graham Bell is credited with inventing the telephone in 1876.",
  "light bulb":"Thomas Edison developed a practical incandescent light bulb in 1879.",
  airplane:"The Wright Brothers (Orville and Wilbur) made the first powered flight at Kitty Hawk in 1903.",
  computer:"Charles Babbage conceptualised the first mechanical computer; ENIAC (1945) was one of the first electronic computers.",
  penicillin:"Alexander Fleming discovered penicillin in 1928, revolutionising medicine and saving millions of lives.",
  gravity:"Isaac Newton formulated the law of universal gravitation in 1687 (reportedly inspired by a falling apple).",
  relativity:"Albert Einstein developed special relativity (1905) and general relativity (1915), reshaping our understanding of space and time.",
  // New additions
  steam_engine:"James Watt significantly improved the steam engine in 1769, powering the Industrial Revolution.",
  "steam engine":"James Watt significantly improved the steam engine in 1769, powering the Industrial Revolution.",
  printing:"Johannes Gutenberg invented the movable-type printing press around 1440, democratising knowledge.",
  "printing press":"Johannes Gutenberg invented the movable-type printing press around 1440, democratising knowledge.",
  television:"Philo Farnsworth demonstrated the first electronic television in 1927.",
  radio:"Guglielmo Marconi demonstrated the first long-distance radio transmission in 1901.",
  vaccine:"Edward Jenner created the first successful vaccine (smallpox) in 1796.",
  gps:"The GPS system was developed by the US Department of Defense and became fully operational in 1995.",
  laser:"Theodore Maiman built the first working laser in 1960.",
  transistor:"The transistor was invented at Bell Labs by Shockley, Bardeen, and Brattain in 1947 — the foundation of modern electronics.",
  microchip:"Jack Kilby (Texas Instruments) and Robert Noyce (Fairchild) independently invented the integrated circuit (microchip) in 1958–59.",
  "integrated circuit":"Jack Kilby and Robert Noyce invented the integrated circuit in 1958–59.",
  nuclear:"Nuclear fission was discovered by Hahn and Strassmann in 1938. The first nuclear reactor was built by Fermi in 1942.",
  rna:"mRNA vaccine technology was pioneered by Katalin Karikó and Drew Weissman, recognised by the 2023 Nobel Prize in Medicine.",
  python:"Python was created by Guido van Rossum, with its first version released in 1991.",
  linux:"Linux was created by Linus Torvalds in 1991 as a free, open-source Unix-like operating system.",
  wikipedia:"Wikipedia was founded by Jimmy Wales and Larry Sanger in 2001.",
  electricity:"Benjamin Franklin demonstrated lightning as electricity (1752); practical generation/distribution by Faraday and Tesla/Edison in the 1800s.",
  evolution:"Charles Darwin and Alfred Russel Wallace independently developed the theory of evolution by natural selection (~1858).",
  dna:"The structure of DNA was discovered by Watson and Crick in 1953, building on X-ray work by Rosalind Franklin.",
};

const JOKES = [
  "Why don't scientists trust atoms?\nBecause they make up everything!",
  "Why did the programmer quit his job?\nBecause he didn't get arrays.",
  "How do you comfort a JavaScript bug?\nYou console it.",
  "Why did the math book look so sad?\nBecause it had too many problems.",
  "Why do programmers prefer dark mode?\nBecause light attracts bugs!",
  "What do you call a fish without eyes?\nA fsh.",
  "I told my computer I needed a break.\nNow it won't stop sending me Kit-Kat ads.",
  "Why did the bicycle fall over?\nBecause it was two-tired.",
  "What's a computer's favorite snack?\nMicrochips.",
  "What did the ocean say to the beach?\nNothing, it just waved.",
  "Why can't you trust an atom?\nThey make up literally everything.",
  "What do you call a group of disorganised cats?\nA cat-astrophe.",
  "I tried to write a joke about infinity.\nBut I didn't know where to stop.",
  "Why was the developer always calm?\nBecause they knew how to handle exceptions.",
  "There are 10 types of people in the world:\nThose who understand binary and those who don't.",
  "Why did the function call itself?\nBecause it had unresolved issues.",
  "How many programmers does it take to change a light bulb?\nNone — that's a hardware problem.",
  "A SQL query walks into a bar, walks up to two tables and asks...\n'Can I join you?'",
  "Why is it so hard to play hide-and-seek with mountains?\nBecause they always peak.",
  "I asked my dog what 2 minus 2 is.\nHe said nothing.",
  "I used to think I was indecisive.\nBut now I'm not so sure.",
  "Why do cows wear bells?\nBecause their horns don't work.",
  "What do you call a fake noodle?\nAn impasta.",
  "Did you hear about the claustrophobic astronaut?\nHe just needed a little space.",
];

// ─── Main generator ───────────────────────────────────────────────────────────

export async function generateResponse(text: string, detected: DetectedIntent, sessionId: string, tavilyApiKey?: string): Promise<string> {
  const { intent, entities } = detected;
  const lower = text.toLowerCase().trim();
  const nums = entities.numbers as number[] | undefined;
  const [a, b] = nums ?? [];

  // Self-correction check: if this exact question was corrected before,
  // prefer the taught answer over regenerating (possibly wrong) logic —
  // this is how the assistant avoids repeating a known mistake.
  if (intent !== "correct" && intent !== "teach") {
    const prior = findCorrection(text);
    if (prior) return prior.correct_answer;
  }

  switch (intent) {
    case "teach": return handleTeach(entities);
    case "correct": return handleCorrect(entities, sessionId);
    case "reasoning": return handleReasoning(text, lower);
    case "challenge": return handleChallenge(text, lower, sessionId);
    case "research": return await handleResearch(entities, lower, tavilyApiKey);
    case "greeting": return ["Hello! I'm your Intelligent Assistant. What can I help you with?","Hey there! Ready to assist — what's on your mind?","Hi! Type 'what can you do?' to see everything I can help with."][Math.floor(Math.random()*3)];
    case "farewell": return ["Goodbye! Come back anytime.","See you later! I'll be here when you need me.","Take care!"][Math.floor(Math.random()*3)];
    case "joke": return "Here's one:\n\n" + JOKES[Math.floor(Math.random() * JOKES.length)];
    case "help": return "I can help with:\n\n🔢 **Math** — arithmetic, primes, Fibonacci, trig, logs\n🕐 **Date & Time** — current date/time, days until a date\n🔄 **Conversions** — temperature, distance, weight\n📝 **Text Analysis** — word count, reverse, palindromes\n🌍 **Knowledge** — countries, capitals, inventions, definitions\n📋 **Lists & Reminders** — session-based\n😄 **Jokes** — always ready\n🔎 **Internet lookup** — paste a Tavily API key in the box above to let me search the live web for anything I don't already know\n\nVisit the **Guide** page for the full list with examples!";
    case "datetime": return handleDatetime(lower);
    case "math": return handleMath(text, lower, entities, nums, a, b);
    case "conversion": return handleConversion(text, lower, nums);
    case "text_analysis": return handleTextAnalysis(text, lower, entities);
    case "small_talk": return handleSmallTalk(lower);
    case "weather": return tavilyApiKey ? await handleTavilySearch(text, tavilyApiKey) : "I don't have real-time weather data locally.\n\nPaste a Tavily API key in the box above the chat to let me search the live web for current weather — or I *can* convert temperatures: try **\"Convert 72°F to Celsius\"**.";
    case "reminder": return handleReminder(text, entities, sessionId);
    case "list": return handleList(text, lower, sessionId);
    case "definition": return await handleDefinition(lower, tavilyApiKey);
    case "general_knowledge": return await handleKnowledge(lower, nums, tavilyApiKey);
    case "number_fact": return handleNumberFact(nums);
    case "word_game": return handleWordGame(lower);
    case "comparative_teach": return handleComparativeTeach(text);
    case "comparative_query": return handleComparativeQuery(text, entities);
    case "goal": return handleGoal(text, entities, sessionId);
    case "tools": return `Here's my current tool registry:\n\n${formatToolList()}`;
    case "web_research": return await handleWebResearch(entities, tavilyApiKey);
    case "document": return await handleDocument(entities);
    case "code_lookup": return handleCodeLookup(entities);
    case "follow_up": return await handleFollowUp(sessionId, tavilyApiKey);
    case "opinion": return handleOpinion(lower);
    case "hypothetical": return handleHypothetical(lower);
    default: return await handleFallback(lower, text, tavilyApiKey);
  }
}

// ─── Internet lookup (Tavily) ──────────────────────────────────────────────────

async function handleTavilySearch(topic: string, apiKey: string): Promise<string> {
  try {
    const result = await searchTavily(topic, apiKey);
    if (!result) return `I couldn't find anything on the web for **"${topic}"**.`;
    return `Here's what I found searching the live web for **"${topic}"**:\n\n${formatTavilyResult(topic, result)}`;
  } catch (err) {
    return err instanceof Error ? err.message : "Something went wrong reaching Tavily.";
  }
}

function handleDatetime(lower: string): string {
  const now = new Date();
  if (/time/.test(lower)) return `The current time is **${now.toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit", second:"2-digit" })}** (server time).`;
  if (/year/.test(lower)) return `The current year is **${now.getFullYear()}**.`;
  if (/month/.test(lower)) return `The current month is **${now.toLocaleString("en-US", { month:"long" })}**.`;

  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  const untilMatch = lower.match(/how\s+many\s+days?\s+(?:until|till|before|in)\s+(.+)/i);
  if (untilMatch) {
    const target = untilMatch[1].trim();
    const d = new Date(target);
    if (!isNaN(d.getTime())) {
      const diff = Math.ceil((d.getTime() - now.getTime()) / 86400000);
      if (diff > 0) return `There are **${diff} days** until ${target}.`;
      if (diff < 0) return `${target} was **${Math.abs(diff)} days ago**.`;
      return `${target} is **today**!`;
    }
  }

  return `Today is **${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}**.\nCurrent time: **${now.toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit" })}**`;
}

function handleMath(text: string, lower: string, entities: Record<string, unknown>, nums: number[] | undefined, a: number | undefined, b: number | undefined): string {
  if (entities.checkPrime && a !== undefined) {
    const n = Math.round(Math.abs(a));
    if (n > 10_000_000) return `${n} is too large to check here.`;
    const prime = isPrime(n);
    if (prime) return `**${n}** is a **prime** number ✓ — divisible only by 1 and ${n}.`;
    let sd = 2;
    if (n % 2 !== 0) for (let d = 3; d <= Math.sqrt(n); d += 2) { if (n % d === 0) { sd = d; break; } }
    return `**${n}** is **not** a prime number ✗ — divisible by ${sd}.`;
  }

  if ((entities.checkEven || entities.checkOdd) && a !== undefined) {
    const n = Math.round(a);
    return `**${n}** is ${n % 2 === 0 ? "an **even**" : "an **odd**"} number.`;
  }

  if (entities.factorial && a !== undefined) {
    const n = Math.round(a);
    if (n < 0) return "Factorial is not defined for negative numbers.";
    if (n > 20) {
      const digits = Math.floor(Math.log10(Math.sqrt(2 * Math.PI * n) * Math.pow(n / Math.E, n))) + 1;
      return `${n}! has approximately **${digits} digits** — too large to display here.`;
    }
    return `${n}! = **${factorial(n).toLocaleString()}**`;
  }

  if (entities.squareRoot && a !== undefined) {
    if (a < 0) return "The square root of a negative number is imaginary (not a real number).";
    return `√${fmt(a)} = **${fmt(parseFloat(Math.sqrt(a).toFixed(8)))}**`;
  }

  if (entities.fibonacci) {
    const n = a !== undefined ? Math.round(Math.min(a, 30)) : 10;
    return `First ${n} Fibonacci numbers:\n**${fibonacci(n).join(", ")}**`;
  }

  if (entities.percentage && a !== undefined && b !== undefined) return `${fmt(a)}% of ${fmt(b)} = **${fmt(parseFloat((a * b / 100).toFixed(6)))}**`;

  if (/gcd|greatest common/i.test(lower) && a !== undefined && b !== undefined) return `GCD(${Math.round(a)}, ${Math.round(b)}) = **${gcd(Math.round(a), Math.round(b))}**`;
  if (/lcm|least common/i.test(lower) && a !== undefined && b !== undefined) return `LCM(${Math.round(a)}, ${Math.round(b)}) = **${lcm(Math.round(a), Math.round(b))}**`;
  if (/average|mean/i.test(lower) && nums && nums.length > 1) {
    const avg = nums.reduce((s, n) => s + n, 0) / nums.length;
    return `Average of [${nums.join(", ")}] = **${fmt(parseFloat(avg.toFixed(6)))}**`;
  }

  const sinM = text.match(/sin\s*\(?\s*([\d.]+)/i); if (sinM) return `sin(${sinM[1]}) = **${fmt(parseFloat(Math.sin(parseFloat(sinM[1]) * Math.PI / 180).toFixed(8)))}**`;
  const cosM = text.match(/cos\s*\(?\s*([\d.]+)/i); if (cosM) return `cos(${cosM[1]}) = **${fmt(parseFloat(Math.cos(parseFloat(cosM[1]) * Math.PI / 180).toFixed(8)))}**`;
  const tanM = text.match(/tan\s*\(?\s*([\d.]+)/i); if (tanM) return `tan(${tanM[1]}) = **${fmt(parseFloat(Math.tan(parseFloat(tanM[1]) * Math.PI / 180).toFixed(8)))}**`;
  const logM = text.match(/log\s*\(?\s*([\d.]+)/i); if (logM) return `log₁₀(${logM[1]}) = **${fmt(parseFloat(Math.log10(parseFloat(logM[1])).toFixed(8)))}**`;
  const lnM  = text.match(/ln\s*\(?\s*([\d.]+)/i);  if (lnM)  return `ln(${lnM[1]}) = **${fmt(parseFloat(Math.log(parseFloat(lnM[1])).toFixed(8)))}**`;

  const sqM = text.match(/([\d.]+)\s*squared/i); if (sqM) { const n = parseFloat(sqM[1]); return `${fmt(n)}² = **${fmt(n*n)}**`; }
  const cbM = text.match(/([\d.]+)\s*cubed/i);   if (cbM) { const n = parseFloat(cbM[1]); return `${fmt(n)}³ = **${fmt(n*n*n)}**`; }

  const expr = text.replace(/what\s+is|calculate|compute|solve|evaluate|equals?/gi,"").replace(/\?/g,"").trim();
  const res = safeMath(expr);
  if (res !== null) return `${expr.trim()} = **${fmt(res)}**`;

  if (nums && nums.length >= 2) {
    for (const op of ["+","-","*","/"]) {
      if (text.includes(op)) { const r = safeMath(`${nums[0]} ${op} ${nums[1]}`); if (r !== null) return `${nums[0]} ${op} ${nums[1]} = **${fmt(r)}**`; }
    }
  }

  return "I couldn't evaluate that. Try: **\"What is 15 * 7?\"** or **\"Calculate 2^10\"**.";
}

function handleConversion(text: string, lower: string, nums: number[] | undefined): string {
  const tempM = lower.match(/([\d.]+)\s*°?\s*(fahrenheit|celsius|kelvin|[fck])\s+(?:to|in|into)\s+(fahrenheit|celsius|kelvin|[fck])/i);
  if (tempM) return convertTemp(parseFloat(tempM[1]), tempM[2], tempM[3]);
  const tempM2 = lower.match(/([\d.]+)\s*°([fck])\s+(?:to|in)\s*°?([fck])/i);
  if (tempM2) return convertTemp(parseFloat(tempM2[1]), tempM2[2], tempM2[3]);

  const du = "km|miles?|meters?|m|feet|foot|ft|yards?|yd|inches?|in|cm|mm";
  const dM = lower.match(new RegExp(`([\\d.]+)\\s*(${du})\\s+(?:to|in|into)\\s*(${du})`, "i"));
  if (dM) return convertDist(parseFloat(dM[1]), dM[2], dM[3]);

  const wu = "kg|kilograms?|grams?|g|mg|lb|lbs|pounds?|oz|ounces?|tons?";
  const wM = lower.match(new RegExp(`([\\d.]+)\\s*(${wu})\\s+(?:to|in|into)\\s*(${wu})`, "i"));
  if (wM) return convertWeight(parseFloat(wM[1]), wM[2], wM[3]);

  if (!nums?.[0]) return "Specify a value to convert. Example: **\"Convert 100°F to Celsius\"** or **\"5 km in miles\"**.";
  return "I can convert: temperature (°C/°F/K), distance (km/m/miles/feet), weight (kg/g/lb/oz). Try: **\"5 kg to pounds\"**.";
}

function handleTextAnalysis(text: string, lower: string, entities: Record<string, unknown>): string {
  let target = (entities.targetText as string | undefined) ?? "";
  const qM = text.match(/["']([^"']+)["']/); if (qM) target = qM[1];

  if (/word\s*count|how\s+many\s+words?/i.test(lower)) {
    if (!target) return "Provide the text. Example: **\"Count words in 'hello world how are you'\"**";
    const w = target.trim().split(/\s+/).filter(Boolean);
    return `"${target}" has **${w.length} word${w.length !== 1 ? "s" : ""}**.`;
  }
  if (/char(?:acter)?\s*count|how\s+many\s+(?:characters?|letters?)/i.test(lower)) {
    if (!target) return "Provide the text. Example: **\"Character count of 'hello world'\"**";
    return `"${target}"\n- With spaces: **${target.length}**\n- Without spaces: **${target.replace(/\s/g,"").length}**\n- Letters only: **${target.replace(/[^a-zA-Z]/g,"").length}**`;
  }
  if (/vowels?/i.test(lower)) {
    if (!target) return "Provide the text. Example: **\"Count vowels in 'algorithm'\"**";
    const v = target.match(/[aeiouAEIOU]/g) ?? [];
    return `"${target}" has **${v.length} vowel${v.length !== 1 ? "s" : ""}**: ${v.join(", ")}`;
  }
  if (/reverse/i.test(lower)) {
    if (!target) {
      const m = text.match(/reverse\s+(?:the\s+)?(?:word\s+|text\s+)?["']?(\S+)["']?/i);
      if (m) target = m[1];
    }
    if (!target) return "Provide text to reverse. Example: **\"Reverse 'hello'\"**";
    return `Reversed: **"${target.split("").reverse().join("")}"**`;
  }
  if (/palindrome/i.test(lower)) {
    if (!target) return "Provide a word or phrase. Example: **\"Is 'racecar' a palindrome?\"**";
    const clean = target.toLowerCase().replace(/[^a-z0-9]/g,"");
    const rev = clean.split("").reverse().join("");
    return clean === rev ? `"${target}" is ✓ a **palindrome**!` : `"${target}" is ✗ **not** a palindrome. (Reversed: "${rev}")`;
  }
  if (/uppercase|upper\s+case/i.test(lower) && target) return `Uppercase: **"${target.toUpperCase()}"**`;
  if (/lowercase|lower\s+case/i.test(lower) && target) return `Lowercase: **"${target.toLowerCase()}"**`;
  if (/title\s+case/i.test(lower) && target) return `Title case: **"${target.replace(/\b\w/g, c => c.toUpperCase())}"**`;

  return "Text analysis options: **word count**, **character count**, **vowel count**, **reverse**, **palindrome check**, **uppercase/lowercase**. Wrap text in quotes: **\"Reverse 'hello'\"**.";
}

function handleSmallTalk(lower: string): string {
  if (/your\s+name|who\s+are\s+you|what\s+are\s+you/i.test(lower)) return "I'm the **Intelligent Assistant Core (IAC)** — you can also call me **Yang**. Every response comes from built-in local logic that I keep growing; if you paste a Tavily API key above the chat, I can also search the live web when I don't already know something.";
  if (/are\s+you\s+(?:an?\s+)?(?:ai|bot|robot)/i.test(lower)) return "Yes, I'm an AI — Yang, also known as the Intelligent Assistant Core. I run mostly on local logic, no cloud LLM required — but I can optionally search the live web via Tavily if you paste an API key above the chat.";
  if (/how\s+are\s+you/i.test(lower)) return "All systems operational! How can I help you?";
  if (/do\s+you\s+(?:feel|think|dream)/i.test(lower)) return "I don't experience feelings, but I'm designed to reason, learn from corrections, and respond as helpfully as possible.";
  return "I'm Yang — the Intelligent Assistant Core. Fully self-contained, and I get better the more you teach me. Try some math, convert units, teach me a fact, or say 'what can you do?' for the full list!";
}

// ─── Teach / correct / reason / challenge / research ──────────────────────────

function handleTeach(entities: Record<string, unknown>): string {
  const key = entities.factKey as string | undefined;
  const value = entities.factValue as string | undefined;
  if (!key || !value) {
    return "Tell me what to remember in the form: **\"Remember that <thing> is <fact>\"** — e.g. \"Remember that my favorite color is blue.\"";
  }

  // Contradiction detection: check whether we already have a different value
  // for this key. If so, warn the user before silently overwriting.
  const existing = stmts.getFact.get(key.toLowerCase()) as LearnedFactRow | undefined;
  if (existing && existing.value.toLowerCase() !== value.toLowerCase()) {
    teachFact(key, value);
    addTaughtFact(key, value);
    return `✓ Updated — I had **"${existing.value}"** stored for **${key}**, but I've now updated it to **"${value}"**. If that wasn't intentional, teach me the old value again.`;
  }

  teachFact(key, value);
  addTaughtFact(key, value); // also record in the knowledge graph for multi-hop traversal
  const confirmations = [
    `✓ Got it — I'll remember that **${key}** is **${value}**. Ask me about it any time!`,
    `✓ Noted! **${key}** → **${value}**. I'll recall this whenever you ask.`,
    `✓ Remembered: **${key}** is **${value}**. You can correct me any time if it changes.`,
  ];
  return confirmations[Math.floor(Math.random() * confirmations.length)];
}

function handleCorrect(entities: Record<string, unknown>, sessionId: string): string {
  const correctAnswer = entities.correctAnswer as string | undefined;

  // If a correction is already pending (user said "that's wrong" on a
  // previous turn without giving the answer yet), target THAT original
  // question rather than the "that's wrong" message itself.
  const pending = pendingCorrections.get(sessionId);
  const priorUser = pending
    ? { text: pending.question }
    : (stmts.getLastUserMessage.get(sessionId) as unknown as ConversationRow | undefined);
  const priorWrongAnswer = pending?.wrongAnswer
    ?? (stmts.getLastAssistantMessage.get(sessionId) as unknown as ConversationRow | undefined)?.text;

  if (!priorUser) {
    return "I don't have a previous question from you this session to correct. Ask something first, then correct me if I get it wrong.";
  }

  if (!correctAnswer) {
    // No answer given yet — remember the original question so the next
    // message (the actual correction) can be applied to it.
    pendingCorrections.set(sessionId, { question: priorUser.text, wrongAnswer: priorWrongAnswer });
    return "Thanks for flagging that — what's the correct answer? Say it like: **\"Actually, it's <correct answer>\"** and I'll remember it for next time.";
  }

  pendingCorrections.delete(sessionId);
  learnCorrection(priorUser.text, correctAnswer, priorWrongAnswer);
  return `✓ Corrected. Next time you ask **"${priorUser.text}"** I'll answer **"${correctAnswer}"** instead. Thanks for teaching me.`;
}

function handleReasoning(text: string, lower: string): string {
  const topicM = lower.match(/^(?:why|how\s+come)\s+(?:is|are|does|do|did)\s+(.+?)(?:\?|$)/i)
    ?? lower.match(/explain\s+(?:why|how)\s+(.+?)(?:\?|$)/i);
  const topic = topicM?.[1]?.trim();

  const fact = topic ? findFactMatch(topic) : undefined;
  if (fact) {
    return `Step by step:\n1. You taught me that **${fact.key}** is **${fact.value}**.\n2. That's the fact I have on record — I don't invent an explanation beyond what I've been taught or what's in my built-in knowledge.\n3. So: **${fact.key} → ${fact.value}**.`;
  }

  for (const [key, def] of Object.entries(DEFINITIONS)) {
    if (topic && topic.includes(key)) {
      return `Reasoning it through:\n1. The core idea is **${key}**: ${def}\n2. That definition is the "why" behind most follow-on behavior you'll see with it.\n3. If this isn't the angle you meant, tell me more and I can refine — or correct me and I'll remember the better explanation.`;
    }
  }

  if (topic) noteResearchGap(topic);
  return topic
    ? `I don't have a built-in explanation for **"${topic}"** yet. I've noted it as something to learn — you can teach me with: **"Remember that ${topic} is ..."**`
    : "Ask me a \"why\" question about something I know (a definition, an invention, a taught fact) and I'll walk through the reasoning step by step.";
}

function handleChallenge(text: string, lower: string, sessionId: string): string {
  const pending = sessionChallenges.get(sessionId);

  // Check an answer to a previously posed challenge
  if (pending) {
    const guess = text.match(/[-+]?\d*\.?\d+/);
    if (guess) {
      const g = parseFloat(guess[0]);
      sessionChallenges.delete(sessionId);
      if (g === pending.answer) return `✓ Correct! **${pending.question}** = **${fmt(pending.answer)}**. Want another? Say "challenge me".`;
      return `Not quite. **${pending.question}** = **${fmt(pending.answer)}** (you said ${fmt(g)}). Say "challenge me" for another.`;
    }
  }

  const ops = [
    () => { const x = 2 + Math.floor(Math.random()*18), y = 2 + Math.floor(Math.random()*18); return { q: `${x} × ${y}`, a: x*y }; },
    () => { const x = 10 + Math.floor(Math.random()*90); return { q: `Is ${x} prime?`, a: isPrime(x) ? 1 : 0, prime: true, n: x }; },
    () => { const x = 2 + Math.floor(Math.random()*10); return { q: `${x} factorial`, a: Number(factorial(x)) }; },
    () => { const x = 20 + Math.floor(Math.random()*180), y = 5 + Math.floor(Math.random()*45); return { q: `${x} - ${y}`, a: x-y }; },
  ];
  const picked = ops[Math.floor(Math.random()*ops.length)]();
  if ("prime" in picked && picked.prime) {
    sessionChallenges.set(sessionId, { question: picked.q, answer: picked.a });
    return `Here's a problem: **${picked.q}** (answer 1 for yes, 0 for no)\n\nReply with your answer, and I'll tell you if you're right.`;
  }
  sessionChallenges.set(sessionId, { question: picked.q, answer: picked.a });
  return `Here's a problem: **${picked.q}** = ?\n\nReply with just the number, and I'll check it.`;
}

async function handleResearch(entities: Record<string, unknown>, lower: string, tavilyApiKey?: string): Promise<string> {
  const topic = ((entities.topic as string | undefined) ?? "").toLowerCase();
  if (!topic) return "Tell me a topic to research, e.g. **\"What do you know about France?\"** or **\"Research recursion\"**.";

  const findings: string[] = [];
  const taught = findFactMatch(topic);
  if (taught) findings.push(`Taught fact — **${taught.key}**: ${taught.value}`);
  for (const [c, f] of Object.entries(GEO)) if (c.includes(topic) || topic.includes(c)) findings.push(`Country knowledge: ${f}`);
  for (const [k, v] of Object.entries(DEFINITIONS)) if (k.includes(topic) || topic.includes(k)) findings.push(`Definition — **${k}**: ${v}`);
  for (const [k, v] of Object.entries(INVENTIONS)) if (k.includes(topic) || topic.includes(k)) findings.push(`Invention/discovery — **${k}**: ${v}`);
  const cap = CAPITALS[topic];
  if (cap) findings.push(`Capital: **${cap}**`);

  if (findings.length > 0) {
    return `Here's what I've gathered on **"${topic}"**:\n\n${findings.map(f => `• ${f}`).join("\n")}`;
  }

  if (tavilyApiKey) return await handleTavilySearch(topic, tavilyApiKey);

  noteResearchGap(topic);
  return `I don't have anything on **"${topic}"** across my knowledge or taught facts yet. I've logged it as a research gap — teach me with **"Remember that ${topic} is ..."**, or paste a Tavily API key above to let me search the live web.`;
}

function handleReminder(text: string, entities: Record<string, unknown>, sessionId: string): string {
  const rt = (entities.reminderText as string | undefined) ?? text.replace(/remind\s+me\s+(?:to|about|that)\s*/i,"").trim();
  if (!rt) return "What should I remind you about? Try: **\"Remind me to call Alice\"**";
  const list = sessionReminders.get(sessionId) ?? [];
  list.push(rt);
  sessionReminders.set(sessionId, list);
  return `✓ Reminder set: **"${rt}"**\n\nAll reminders this session:\n${list.map((r, i) => `${i+1}. ${r}`).join("\n")}`;
}

function handleList(text: string, lower: string, sessionId: string): string {
  const list = sessionLists.get(sessionId) ?? [];
  const addM = text.match(/add\s+(.+?)\s+to\s+(?:my\s+)?list/i);
  if (addM) {
    list.push(addM[1].trim());
    sessionLists.set(sessionId, list);
    return `✓ Added **"${addM[1].trim()}"** to your list.\n\nYour list (${list.length} item${list.length !== 1 ? "s" : ""}):\n${list.map((i,idx) => `${idx+1}. ${i}`).join("\n")}`;
  }
  if (/show|view|see|display/i.test(lower)) {
    return list.length === 0 ? "Your list is empty. Add items with: **\"Add milk to my list\"**" : `Your list (${list.length} items):\n${list.map((i,idx) => `${idx+1}. ${i}`).join("\n")}`;
  }
  if (/clear|empty|reset/i.test(lower)) {
    sessionLists.set(sessionId, []);
    return `✓ List cleared (${list.length} item${list.length !== 1 ? "s" : ""} removed).`;
  }
  return list.length === 0 ? "Your list is empty. Add with: **\"Add apples to my list\"**" : `Your list:\n${list.map((i,idx) => `${idx+1}. ${i}`).join("\n")}`;
}

async function handleDefinition(lower: string, tavilyApiKey?: string): Promise<string> {
  const taught = findFactMatch(lower);
  if (taught) return `**${taught.key}** is **${taught.value}** (you taught me this).`;

  for (const [key, def] of Object.entries(DEFINITIONS)) {
    if (lower.includes(key)) return def;
  }
  const topic = lower.replace(/^(?:what\s+(?:is|does|are|means?)|define|explain)\s+/i,"").trim() || lower;
  if (tavilyApiKey) return await handleTavilySearch(topic, tavilyApiKey);
  noteResearchGap(topic);
  return `I have definitions for: ${Object.keys(DEFINITIONS).join(", ")}. Try: **"What is an algorithm?"**, teach me one with **"Remember that X is Y"**, or paste a Tavily API key above to search the live web.`;
}

async function handleKnowledge(lower: string, nums?: number[], tavilyApiKey?: string): Promise<string> {
  const taught = findFactMatch(lower);
  if (taught) return `**${taught.key}** is **${taught.value}** (you taught me this).`;

  for (const [c, f] of Object.entries(GEO)) { if (lower.includes(c)) return f; }

  const capM = lower.match(/capital\s+of\s+(\w+(?:\s+\w+)?)/i);
  if (capM) {
    const c = capM[1].toLowerCase();
    const cap = CAPITALS[c];
    if (cap) return `The capital of **${capM[1]}** is **${cap}**.`;
    if (tavilyApiKey) return await handleTavilySearch(`capital of ${capM[1]}`, tavilyApiKey);
    noteResearchGap(`capital of ${c}`);
    return `I don't have the capital of "${capM[1]}" — I know: ${Object.keys(CAPITALS).join(", ")}. Teach me with **"Remember that the capital of ${capM[1]} is ..."** or paste a Tavily API key above to search the web.`;
  }

  const invM = lower.match(/who\s+(?:invented|created|discovered|founded)\s+(.+?)(?:\?|$)/i);
  if (invM) {
    const thing = invM[1].trim().toLowerCase();
    for (const [k, v] of Object.entries(INVENTIONS)) { if (thing.includes(k)) return v; }
    if (tavilyApiKey) return await handleTavilySearch(invM[1].trim(), tavilyApiKey);
    noteResearchGap(thing);
    return `I don't have that yet — I've logged "${invM[1]}" to learn. Teach me with **"Remember that ${invM[1]} was invented by ..."** or paste a Tavily API key above to search the web.`;
  }

  if (tavilyApiKey) return await handleTavilySearch(lower, tavilyApiKey);
  return "I know about countries, capitals, inventions, and tech definitions — plus anything you've taught me. Try: **\"Capital of Japan\"**, **\"Who invented the telephone?\"**, **\"Tell me about France\"** — or paste a Tavily API key above to search the live web.";
}

function handleNumberFact(nums?: number[]): string {
  const knownFacts: Record<number, string> = {
    0:"0 is the additive identity — the only number that is neither positive nor negative.",
    1:"1 is the multiplicative identity — every number multiplied by 1 equals itself.",
    2:"2 is the only even prime number.",
    7:"7 is considered lucky in many cultures. Also the number of days in a week.",
    12:"12 is highly composite — it has more divisors relative to its size than most numbers.",
    42:"42 is 'the answer to life, the universe, and everything' per The Hitchhiker's Guide to the Galaxy.",
    100:"100 is a perfect square (10²) and the base of the percentage system.",
  };

  if (nums?.[0] !== undefined) {
    const n = nums[0];
    const known = knownFacts[n];
    if (known) return `Fact about **${n}**: ${known}`;
    const parts = [`Facts about **${fmt(n)}**:`];
    if (Number.isInteger(n)) {
      parts.push(`• ${n % 2 === 0 ? "Even" : "Odd"} number`);
      if (Math.abs(n) < 10_000_000) parts.push(`• ${isPrime(Math.abs(n)) ? "Is a prime" : "Not a prime"}`);
      parts.push(`• Square: ${fmt(n*n)}`);
      parts.push(`• Square root: √${n} ≈ ${parseFloat(Math.sqrt(Math.abs(n)).toFixed(4))}`);
    }
    return parts.join("\n");
  }

  const randoms = [
    "**Pi (π)** ≈ 3.14159... — its digits never repeat and never end.",
    "**Zero** was invented in India around the 5th century AD.",
    "The **Fibonacci sequence** appears in nature: sunflowers, pinecones, and shell spirals.",
    "**Prime numbers** are infinite — there is no largest prime.",
    "**Googol** is 10^100 — a 1 followed by 100 zeros.",
  ];
  return randoms[Math.floor(Math.random() * randoms.length)];
}

function handleWordGame(lower: string): string {
  const spellM = lower.match(/(?:spell|spelling\s+of|how\s+do\s+you\s+spell)\s+["']?(\w+)["']?/i);
  if (spellM) {
    const w = spellM[1];
    return `**${w}** is spelled: **${w.toUpperCase().split("").join(" - ")}** (${w.length} letters)`;
  }
  const scramM = lower.match(/scramble\s+["']?(\w+)["']?/i);
  if (scramM) {
    const w = scramM[1];
    const s = w.split("").sort(() => Math.random() - 0.5).join("");
    return `**${w}** scrambled: **${s}**`;
  }
  return "Word games:\n- **Spell**: \"How do you spell 'necessary'?\"\n- **Scramble**: \"Scramble 'intelligent'\"\n- **Reverse**: \"Reverse 'hello'\"\n- **Palindrome**: \"Is 'racecar' a palindrome?\"";
}

async function handleFallback(lower: string, original: string, tavilyApiKey?: string): Promise<string> {
  // ── Common social phrases ───────────────────────────────────────────────
  if (/thank(?:s|\s+you)/i.test(lower)) {
    const picks = ["You're welcome! Anything else I can help with?", "Happy to help! What else?", "Of course — what's next?"];
    return picks[Math.floor(Math.random() * picks.length)];
  }
  if (/(?:you'?re?\s+)?(?:amazing|awesome|great|well\s+done|nice\s+job|good\s+job)/i.test(lower)) {
    const picks = ["Thank you! What else can I do for you?", "Glad that helped! Anything else?", "Appreciate it! What next?"];
    return picks[Math.floor(Math.random() * picks.length)];
  }
  if (/(?:sorry|apolog)/i.test(lower)) return "No need to apologise! What can I help you with?";
  if (/(?:cool|nice|wow|interesting|fascinating)/i.test(lower)) return "Glad you found that interesting! Anything else you'd like to explore?";

  // ── Try math as a bare expression ─────────────────────────────────────
  const r = safeMath(original.replace(/[^0-9+\-*/().% ]/g,""));
  if (r !== null) return `= **${fmt(r)}**`;

  // ── Try to extract a topic and look it up locally before giving up ─────
  const topicWords = lower
    .replace(/^(?:what|who|where|when|why|how|tell|give|show|can you|do you know|i want to know|i was wondering)\b/gi,"")
    .replace(/[?!.]+$/g,"")
    .trim();

  if (topicWords.length > 2) {
    // Check taught facts
    const taught = findFactMatch(topicWords);
    if (taught) return `**${taught.key}** is **${taught.value}** (you taught me this).`;

    // Check GEO
    for (const [k, v] of Object.entries(GEO)) { if (topicWords.includes(k) || k.includes(topicWords)) return v; }

    // Check DEFINITIONS
    for (const [k, v] of Object.entries(DEFINITIONS)) { if (topicWords.includes(k) || k.includes(topicWords)) return v; }

    // Check INVENTIONS
    for (const [k, v] of Object.entries(INVENTIONS)) { if (topicWords.includes(k) || k.includes(topicWords)) return v; }

    // Try Wikipedia (free, no key needed) before giving the generic message
    try {
      const wiki = await lookupTopic(topicWords);
      if (wiki) return `Here's what I found:\n\n${formatWebResult(wiki)}`;
    } catch { /* silent — network may not be available */ }
  }

  // Nothing local matched at all — if the user has given us a Tavily key,
  // reach for the live web rather than just shrugging.
  if (tavilyApiKey) return await handleTavilySearch(original, tavilyApiKey);

  // Targeted "I don't know" message that names the topic and offers a path forward
  if (topicWords.length > 2) {
    noteResearchGap(topicWords);
    return `I don't have information on **"${topicWords}"** yet — I've logged it as a gap.\n\nYou can:\n• Teach me: **"Remember that ${topicWords} is ..."**\n• Paste a **Tavily API key** above the chat to let me search the web\n• Visit the **Guide** page for things I already know`;
  }

  return `I didn't quite catch that. Try:\n- **Math**: "What is 15 * 7?"\n- **Date**: "What day is it?"\n- **Convert**: "Convert 100°F to Celsius"\n- **Knowledge**: "Tell me about Japan"\n- **Help**: "What can you do?"\n- Paste a Tavily API key above the chat and I can search the live web for anything else.`;
}

// ─── Comparative reasoning / goals / web / documents / code ───────────────────

function handleComparativeTeach(text: string): string {
  const learned = learnComparative(text.trim());
  if (!learned) return "I couldn't parse that as a comparison. Try: **\"John is older than Sarah.\"**";
  return `✓ Noted: **${learned.subject}** ${learned.relation.replace("_", " ")} **${learned.object}**. I can now reason about this transitively — ask me "who is oldest?" or "is X older than Y?".`;
}

function handleComparativeQuery(text: string, entities: Record<string, unknown>): string {
  const superlative = entities.superlative as string | undefined;
  if (superlative) {
    const resolved = resolveSuperlativeWord(superlative);
    if (!resolved) return `I don't know the comparison "${superlative}" yet. Teach me facts like **"X is ${superlative.replace(/est$/, "er")} than Y."**`;
    const ranked = rankByRelation(resolved.relation);
    if (ranked.length === 0) return `I don't have any facts about "${resolved.relation.replace("_", " ")}" yet. Tell me something like **"Alice is ${superlative.replace(/est$/, "er")} than Bob."**`;
    return `Based on what I've been told:\n1. Ranking by **${resolved.relation.replace("_", " ")}**: ${ranked.join(" > ")}\n2. So the **${superlative}** is **${ranked[0]}**.`;
  }

  const a = entities.subjectA as string | undefined;
  const b = entities.subjectB as string | undefined;
  const comp = entities.comparative as string | undefined;
  if (a && b && comp) {
    const resolvedRel = resolveSuperlativeWord(comp + "est") ?? undefined;
    const relation = resolvedRel?.relation ?? `${comp}_than`;
    const related = isRelated(a, relation, b);
    return related
      ? `Step by step: I have (transitively) that **${a}** ${comp} than **${b}** — yes.`
      : `I don't have facts establishing that **${a}** is ${comp} than **${b}** (or the reverse). Teach me with **"${a} is ${comp} than ${b}."**`;
  }

  return "Ask me things like **\"Who is oldest?\"** or **\"Is John older than Sarah?\"** once you've taught me some comparisons.";
}

function handleGoal(text: string, entities: Record<string, unknown>, sessionId: string): string {
  const title = entities.goalTitle as string | undefined;
  if (title) {
    const stepParts = title.split(/,|\band\b/i).map((s) => s.trim()).filter(Boolean);
    const steps = stepParts.length > 1 ? stepParts : [title];
    const goal = startGoal(sessionId, title, steps);
    return `✓ Goal started.\n\n${formatGoal(goal)}\n\nSay **"complete step 1"** as you finish steps, or **"show my goal progress"** any time.`;
  }

  const stepNumber = entities.stepNumber as number | undefined;
  if (stepNumber !== undefined) {
    const goal = completeStep(sessionId, stepNumber - 1);
    if (!goal) return "You don't have an active goal right now. Start one with **\"Start a goal to learn Spanish, practice daily, take a test\"**.";
    return formatGoal(goal);
  }

  const active = getActiveGoal(sessionId);
  if (active) return formatGoal(active);
  return "You don't have an active goal. Start one with **\"Start a goal to <title>\"** — separate steps with commas or \"and\".";
}

async function handleWebResearch(entities: Record<string, unknown>, tavilyApiKey?: string): Promise<string> {
  const topic = entities.topic as string | undefined;
  if (!topic) return "Tell me what to look up, e.g. **\"Search the web for the Eiffel Tower\"**.";

  // Prefer Tavily when the user has supplied a key — it's a real search
  // engine (multiple live sources + a synthesized answer), whereas the
  // Wikipedia fallback only ever returns a single static summary page.
  if (tavilyApiKey) return await handleTavilySearch(topic, tavilyApiKey);

  const result = await lookupTopic(topic);
  if (!result) return `I couldn't fetch anything for **"${topic}"** right now (no internet reachable or no matching page). Paste a Tavily API key above the chat for broader live-web search.`;
  return `Here's what I found online about **"${topic}"**:\n\n${formatWebResult(result)}`;
}

async function handleDocument(entities: Record<string, unknown>): Promise<string> {
  const docPath = entities.docPath as string | undefined;
  if (docPath) {
    // indexDocumentFile resolves this relative to a sandboxed documents/
    // directory and rejects any ".." or absolute-path escape attempt.
    const result = indexDocumentFile(docPath);
    if ("error" in result) return `Couldn't index that: ${result.error}`;
    return `✓ Indexed **${result.docName}** into ${result.chunks} chunk${result.chunks !== 1 ? "s" : ""}. Ask me **"What does the document say about ..."** to query it.`;
  }

  const query = entities.docQuery as string | undefined;
  const indexed = listIndexedDocuments();
  if (indexed.length === 0) return `No documents indexed yet. Drop a .txt/.md file into ${DOCS_ROOT} and try **"Index document notes.md"**.`;
  if (!query) return `I have ${indexed.length} document(s) indexed: ${indexed.join(", ")}. Ask **"What does the document say about <topic>"**.`;

  const hits = searchDocuments(query, 3);
  if (hits.length === 0) return `Nothing in the indexed documents (${indexed.join(", ")}) matches **"${query}"**.`;
  return `From the indexed documents, most relevant passages for **"${query}"**:\n\n${hits.map((h, i) => `**${i + 1}. ${h.docName}** (chunk ${h.chunkIndex + 1})\n${h.content}`).join("\n\n")}`;
}

function handleCodeLookup(entities: Record<string, unknown>): string {
  const name = entities.symbolName as string | undefined;
  if (!name) return "Tell me which symbol to find, e.g. **\"Find function generateResponse\"**.";
  const root = path.join(process.cwd(), "src");
  const hits = findSymbol(name, root);
  if (hits.length === 0) return `No symbol matching **"${name}"** found under the code index (scanned from ${root}).`;
  return `Found ${hits.length} match${hits.length !== 1 ? "es" : ""} for **"${name}"**:\n\n${hits.slice(0, 8).map((h) => `• **${h.name}** (${h.kind}) — ${path.relative(process.cwd(), h.file)}:${h.line}\n  \`${h.signature}\``).join("\n")}`;
}

// ─── Follow-up, opinion, hypothetical ────────────────────────────────────────

/**
 * Handles "tell me more / elaborate / go on / more details" after any previous
 * response. Resolves the last topic the user asked about, tries Wikipedia for
 * deeper content, and falls back gracefully with a specific suggestion.
 *
 * This was the #1 audit finding: Yang gave no useful response to the most
 * natural conversational follow-up.
 */
async function handleFollowUp(sessionId: string, tavilyApiKey?: string): Promise<string> {
  const lastQuery = getLastUserQuery(sessionId);
  const lastResponse = getLastAssistantResponse(sessionId);
  const topic = getLastTopic(sessionId);

  if (!lastQuery && !topic) {
    return "I'd be happy to tell you more — what topic would you like me to expand on?";
  }

  // If the last query was itself a follow-up, avoid infinite loop by using
  // the topic extraction rather than re-running the same query.
  if (topic) {
    // Check if we have any facts related to this topic
    const allFacts = stmts.listFacts.all() as unknown as LearnedFactRow[];
    const relatedFacts = allFacts.filter(
      (f) => f.key.toLowerCase().includes(topic) || topic.includes(f.key.toLowerCase())
    );

    // Try Wikipedia for deeper information
    try {
      const wiki = await lookupTopic(topic);
      if (wiki) {
        const extra = relatedFacts.length
          ? `\n\nFrom what you've taught me: ${relatedFacts.map((f) => `**${f.key}** → ${f.value}`).join("; ")}`
          : "";
        return `Expanding on **${topic}**:\n\n${formatWebResult(wiki)}${extra}`;
      }
    } catch { /* network may not be available */ }

    // No Wikipedia result — try Tavily
    if (tavilyApiKey) {
      return await handleTavilySearch(`more information about ${topic}`, tavilyApiKey);
    }

    // Only local facts
    if (relatedFacts.length > 0) {
      return `Here's everything I have on **${topic}**:\n\n${relatedFacts.map((f) => `• **${f.key}**: ${f.value}`).join("\n")}\n\nTo get deeper information, paste a Tavily API key above to let me search the web.`;
    }

    // Nothing at all
    noteResearchGap(topic);
    return `I don't have more to add on **${topic}** beyond what I shared. I've noted it as a gap — you can teach me with **"Remember that ${topic} is ..."** or paste a Tavily key to search the web.`;
  }

  return "Could you clarify what you'd like more of? For example: **\"Tell me more about Japan\"** or **\"Elaborate on recursion\"**.";
}

/**
 * Opinion questions ("what do you think / do you prefer / which is better").
 * Yang is transparent about not having personal opinions while still being
 * helpful — it shares facts that may inform the user's own view.
 */
function handleOpinion(lower: string): string {
  const opinions: string[] = [
    "I don't hold personal preferences — but I can share facts that might help you decide! What specifically would you like to know more about?",
    "As an AI, I don't have opinions, but I can give you relevant facts or compare options if you tell me what you're choosing between.",
    "I'm opinion-free, but very fact-full! Tell me what you're weighing up and I'll share what I know.",
  ];
  // Try to extract the subject
  const subjectM = lower.match(/(?:think about|prefer|opinion on|view on|take on)\s+(.+?)(?:\?|$)/i);
  if (subjectM) {
    const subject = subjectM[1].trim();
    return `I don't have personal opinions, but I can share facts about **${subject}**. What would you like to know?`;
  }
  return opinions[Math.floor(Math.random() * opinions.length)];
}

/**
 * Hypothetical / "what if" questions.
 * Yang acknowledges the hypothetical framing and answers using its
 * symbolic reasoning and known facts where possible, rather than refusing.
 */
function handleHypothetical(lower: string): string {
  // Try to extract the scenario
  const scenarioM = lower.match(/(?:what\s+if|suppose|imagine|hypothetically|let'?s\s+say)\s+(.+?)(?:\?|$)/i);
  if (scenarioM) {
    const scenario = scenarioM[1].trim();
    // Check if it's a math/logical hypothetical
    const hasNumber = /\d/.test(scenario);
    if (hasNumber) {
      const r = safeMath(scenario.replace(/[^0-9+\-*/().% ]/g, ""));
      if (r !== null) return `Hypothetically: **${scenario}** would give **${fmt(r)}**.`;
    }
    // Check taught facts for relevant knowledge
    const taught = findFactMatch(scenario);
    if (taught) {
      return `Interesting hypothetical! Based on what I know — **${taught.key}** is **${taught.value}** — here's how I'd reason through it: if ${scenario}, then the implications depend on that baseline. What angle interests you most?`;
    }
    return `That's an interesting "what if"! I don't have enough information about **"${scenario}"** to reason through it fully — but teach me the relevant facts and I'll try. Or ask a more specific question and I'll do my best.`;
  }
  return "Interesting hypothetical! Give me more context — what specifically are you imagining? I'll reason through it with what I know.";
}
