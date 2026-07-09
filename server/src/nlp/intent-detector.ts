/**
 * Intent detection engine — no external AI APIs.
 * Uses weighted keyword scoring + regex pattern matching.
 */

export interface DetectedIntent {
  intent: string;
  confidence: number;
  entities: Record<string, unknown>;
}

interface IntentPattern {
  intent: string;
  patterns: RegExp[];
  keywords: string[];
  weight: number;
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    intent: "math",
    patterns: [
      /\d[\s]*[+\-*/^%÷×]\s*[\d]/,
      /(?:what\s+is|calculate|compute|solve|eval(?:uate)?)\s+[\d\s+\-*/^%().]+/i,
      /square\s+root\s+of\s+\d/i,
      /\d+\s*(?:squared|cubed|factorial)/i,
      /(?:sin|cos|tan|log|ln)\s*\(?[\d.]+/i,
      /percent(?:age)?\s+of/i,
      /\d+\s*%\s+of\s+\d+/i,
      /is\s+\d+\s+(?:prime|even|odd)/i,
      /(?:fibonacci|prime|factor)\s*(?:of\s*)?\d+/i,
      /\d+\s*(?:plus|minus|times|divided by|multiplied by)\s*\d+/i,
    ],
    keywords: ["calculate","math","arithmetic","sum","total","equals","equation","formula","prime","fibonacci","factorial","square root","average","mean","gcd","lcm"],
    weight: 1.2,
  },
  {
    intent: "datetime",
    patterns: [
      /what(?:'s|\s+is)\s+(?:the\s+)?(?:date|time|day|year|month)/i,
      /what\s+(?:day|date|time)\s+is\s+it/i,
      /how\s+many\s+days?\s+(?:until|till|before|after|between)/i,
      /days?\s+(?:from\s+now|ago|left)/i,
      /current\s+(?:date|time|day|year|month)/i,
      /(?:today|tomorrow|yesterday)/i,
    ],
    keywords: ["date","time","today","tomorrow","yesterday","clock","year","month","week","hour","minute"],
    weight: 1.1,
  },
  {
    intent: "conversion",
    patterns: [
      /convert\s+[\d.]+\s*\w+\s+to\s+\w+/i,
      /[\d.]+\s*(?:kg|lb|lbs|pounds?|kilograms?|grams?|oz)\s+(?:in|to|into)\s+(?:kg|lb|lbs|pounds?|kilograms?|grams?|oz)/i,
      /[\d.]+\s*(?:km|miles?|meters?|feet|foot|yards?|inches?|cm|mm)\s+(?:in|to|into)\s+(?:km|miles?|meters?|feet|foot|yards?|inches?|cm|mm)/i,
      /[\d.]+\s*(?:°?[FCK]|fahrenheit|celsius|kelvin)\s+(?:in|to|into)\s+(?:°?[FCK]|fahrenheit|celsius|kelvin)/i,
    ],
    keywords: ["convert","conversion","in meters","in miles","in celsius","in fahrenheit","in pounds","in kilograms"],
    weight: 1.2,
  },
  {
    intent: "text_analysis",
    patterns: [
      /(?:how\s+many|count(?:ing)?\s+(?:the)?)\s+(?:words?|characters?|letters?|vowels?)/i,
      /(?:reverse|palindrome|anagram)\s+(?:the\s+)?\w+/i,
      /(?:word|character|letter)\s+count/i,
      /is\s+["']?.+["']?\s+a\s+palindrome/i,
      /uppercase|lowercase|capitalize|title\s+case/i,
    ],
    keywords: ["words","characters","letters","reverse","palindrome","uppercase","lowercase","capitalize","word count"],
    weight: 1.1,
  },
  {
    intent: "joke",
    patterns: [
      /(?:tell|say|give)\s+(?:me\s+)?(?:a\s+)?joke/i,
      /(?:funny|humor|laugh|riddle)/i,
      /make\s+me\s+(?:laugh|smile)/i,
    ],
    keywords: ["joke","funny","humor","laugh","riddle","pun","comedy"],
    weight: 1.0,
  },
  {
    intent: "greeting",
    patterns: [
      /^(?:hi|hello|hey|howdy|greetings|good\s+(?:morning|afternoon|evening|day|night))[\s!,.]*/i,
      /^(?:sup|what'?s\s+up|how\s+are\s+you)/i,
    ],
    keywords: ["hello","hi","hey","greetings","howdy","good morning","good evening","good afternoon"],
    weight: 1.3,
  },
  {
    intent: "farewell",
    patterns: [
      /^(?:bye|goodbye|see\s+you|farewell|ciao|later|take\s+care)[\s!.]*/i,
      /(?:good\s+night|gotta\s+go|logging\s+off)/i,
    ],
    keywords: ["bye","goodbye","farewell","see you","later","goodnight"],
    weight: 1.3,
  },
  {
    intent: "help",
    patterns: [
      /what\s+can\s+you\s+do/i,
      /(?:help|assist|guide|instructions?)/i,
      /show\s+(?:me\s+)?(?:your\s+)?(?:features?|capabilities?|commands?)/i,
    ],
    keywords: ["help","assist","guide","features","capabilities","commands","what can you"],
    weight: 1.1,
  },
  {
    intent: "weather",
    patterns: [
      /weather\s+(?:in|at|for|today|now)/i,
      /(?:is\s+it|will\s+it)\s+(?:rain|snow|sunny|cloudy)/i,
      /what'?s\s+the\s+weather/i,
    ],
    keywords: ["weather","rain","snow","sunny","cloudy","temperature","forecast","wind","storm"],
    weight: 1.0,
  },
  {
    intent: "definition",
    patterns: [
      /what\s+(?:is|does|are|means?)\s+(?:a\s+|an\s+|the\s+)?\w+/i,
      /define\s+\w+/i,
      /explain\s+(?:what|how|why|the)/i,
      /meaning\s+of\s+\w+/i,
    ],
    keywords: ["what is","define","definition","explain","meaning","what does","what are"],
    weight: 0.8,
  },
  {
    intent: "word_game",
    patterns: [
      /(?:spell|spelling)\s+\w+/i,
      /how\s+do\s+you\s+spell\s+\w+/i,
      /scramble\s+\w+/i,
    ],
    keywords: ["spell","scramble","word game","starts with"],
    weight: 1.0,
  },
  {
    intent: "number_fact",
    patterns: [
      /(?:interesting|fun|tell\s+me\s+a)\s+fact\s+about\s+(?:the\s+number\s+)?\d+/i,
      /what(?:'s|\s+is)\s+special\s+about\s+\d+/i,
      /random\s+(?:number|fact)/i,
    ],
    keywords: ["fact","trivia","number fact","interesting","random number","special about"],
    weight: 1.0,
  },
  {
    intent: "small_talk",
    patterns: [
      /(?:how|what)\s+are\s+you/i,
      /(?:your\s+name|who\s+are\s+you|what\s+are\s+you)/i,
      /are\s+you\s+(?:an?\s+)?(?:ai|robot|bot|human|real)/i,
    ],
    keywords: ["who are you","your name","are you","do you feel","are you human","are you an ai"],
    weight: 1.0,
  },
  {
    intent: "reminder",
    patterns: [
      /remind\s+me\s+(?:to|about|that)/i,
      /set\s+(?:a\s+)?reminder/i,
      /don'?t\s+(?:let\s+me\s+)?forget\s+to/i,
    ],
    keywords: ["remind","reminder","remember","note","don't forget"],
    weight: 1.1,
  },
  {
    intent: "list",
    patterns: [
      /(?:create|make|start|add\s+to|show|view|clear)\s+(?:a\s+|my\s+)?(?:list|todo|shopping)/i,
      /add\s+.+\s+to\s+(?:my\s+)?list/i,
    ],
    keywords: ["list","todo","shopping list","add to list","show list","my list"],
    weight: 1.1,
  },
  {
    intent: "general_knowledge",
    patterns: [
      /(?:capital\s+of|largest|smallest|tallest|highest|deepest)\s+\w+/i,
      /who\s+(?:invented|discovered|created|founded|wrote|built)\s+/i,
      /when\s+(?:was|did|were)\s+/i,
      /population\s+of\s+\w+/i,
    ],
    keywords: ["capital","largest","smallest","who invented","when was","how tall","population","where is","discovered","founded"],
    weight: 0.9,
  },
];

export function detectIntent(text: string): DetectedIntent {
  const lower = text.toLowerCase().trim();
  const scores: Record<string, number> = {};

  for (const ip of INTENT_PATTERNS) {
    let score = 0;
    for (const pattern of ip.patterns) {
      if (pattern.test(lower)) { score += 2.0 * ip.weight; break; }
    }
    for (const kw of ip.keywords) {
      if (lower.includes(kw.toLowerCase())) score += 0.5 * ip.weight;
    }
    if (score > 0) scores[ip.intent] = (scores[ip.intent] ?? 0) + score;
  }

  let bestIntent = "unknown";
  let bestScore = 0;
  for (const [intent, score] of Object.entries(scores)) {
    if (score > bestScore) { bestScore = score; bestIntent = intent; }
  }

  return {
    intent: bestIntent,
    confidence: bestScore > 0 ? Math.min(1, bestScore / 4.0) : 0,
    entities: extractEntities(text, bestIntent),
  };
}

function extractEntities(text: string, intent: string): Record<string, unknown> {
  const entities: Record<string, unknown> = {};
  const lower = text.toLowerCase();
  const numbers = text.match(/[-+]?\d*\.?\d+/g);
  if (numbers?.length) entities.numbers = numbers.map(Number);

  const quoted = text.match(/["']([^"']+)["']/g);
  if (quoted) entities.quoted = quoted.map(q => q.slice(1, -1));

  if (intent === "math") {
    if (/prime/i.test(lower)) entities.checkPrime = true;
    if (/fibonacci/i.test(lower)) entities.fibonacci = true;
    if (/factorial/i.test(lower)) entities.factorial = true;
    if (/square\s+root/i.test(lower)) entities.squareRoot = true;
    if (/even/i.test(lower)) entities.checkEven = true;
    if (/odd/i.test(lower)) entities.checkOdd = true;
    if (/percent/i.test(lower)) entities.percentage = true;
  }

  if (intent === "text_analysis") {
    const afterOf = text.match(/(?:of|:)\s+["']?(.+?)["']?\s*$/i);
    if (afterOf) entities.targetText = afterOf[1].trim();
    const quotedMatch = text.match(/["']([^"']+)["']/);
    if (quotedMatch) entities.targetText = quotedMatch[1];
  }

  if (intent === "reminder") {
    const m = text.match(/remind\s+me\s+(?:to|about|that)\s+(.+)/i);
    if (m) entities.reminderText = m[1].trim();
  }

  return entities;
}
