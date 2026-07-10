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
    intent: "teach",
    patterns: [
      /(?:remember|learn|note)\s+that\s+.+\s+(?:is|are|means?)\s+.+/i,
      /(?:remember|learn)\s+(?:this|the\s+following)\s*:/i,
      /i(?:'m| am)\s+teaching\s+you/i,
    ],
    keywords: ["remember that","learn that","note that","i'm teaching you","teach you that"],
    weight: 1.3,
  },
  {
    intent: "correct",
    patterns: [
      /^(?:no,?\s+)?(?:that'?s|thats|this\s+is)\s+(?:wrong|incorrect|not\s+right|not\s+correct)/i,
      /^actually,?\s+/i,
      /^no[,.]?\s+it'?s\s+actually/i,
      /you'?re\s+wrong/i,
      /the\s+(?:correct|right)\s+answer\s+is/i,
    ],
    keywords: ["that's wrong","that is wrong","not correct","you're wrong","actually it's","incorrect"],
    weight: 1.4,
  },
  {
    intent: "reasoning",
    patterns: [
      /^why\s+/i,
      /^how\s+come\s+/i,
      /explain\s+(?:why|how)\s+/i,
      /what(?:'s|\s+is)\s+the\s+reasoning/i,
      /walk\s+me\s+through/i,
    ],
    keywords: ["why is","why does","how come","reasoning","walk me through","explain why","explain how"],
    weight: 1.0,
  },
  {
    intent: "challenge",
    patterns: [
      /(?:give|quiz|test|challenge)\s+me\s+(?:a\s+)?(?:problem|puzzle|riddle|question)/i,
      /^quiz\s+me/i,
      /^challenge\s+me/i,
    ],
    keywords: ["quiz me","challenge me","give me a problem","test me","give me a puzzle"],
    weight: 1.2,
  },
  {
    intent: "research",
    patterns: [
      /^research\s+/i,
      /(?:look\s+into|dig\s+into|investigate)\s+/i,
      /what\s+do\s+you\s+know\s+about\s+/i,
      /tell\s+me\s+everything\s+(?:you\s+know\s+)?about\s+/i,
    ],
    keywords: ["research","look into","investigate","what do you know about","tell me everything about"],
    weight: 1.0,
  },
  {
    intent: "comparative_teach",
    patterns: [
      /^[\w\s]+?\s+(?:is|are)\s+(?:older|younger|taller|shorter|faster|slower|bigger|smaller|stronger|weaker|richer|poorer|heavier|lighter)\s+than\s+[\w\s]+/i,
    ],
    keywords: ["older than", "younger than", "taller than", "faster than", "bigger than", "stronger than", "weaker than", "richer than", "poorer than"],
    weight: 1.3,
  },
  {
    intent: "comparative_query",
    patterns: [
      /who\s+is\s+(?:the\s+)?(?:oldest|youngest|tallest|shortest|fastest|slowest|biggest|smallest|strongest|weakest|richest|poorest|heaviest|lightest)/i,
      /is\s+[\w\s]+?\s+(?:older|younger|taller|shorter|faster|slower|bigger|smaller|stronger|weaker|richer|poorer|heavier|lighter)\s+than\s+[\w\s]+/i,
    ],
    keywords: ["who is oldest", "who is tallest", "who is fastest", "is older than", "is taller than", "is stronger than", "is weaker than"],
    weight: 1.2,
  },
  {
    intent: "goal",
    patterns: [
      /(?:start|create|set)\s+a\s+goal/i,
      /^goal\s*:/i,
      /(?:my\s+goal\s+is|help\s+me\s+plan)/i,
      /(?:show|check|track)\s+(?:my\s+)?goal\s+progress/i,
      /(?:mark|complete|finish)\s+step\s+\d+/i,
    ],
    keywords: ["start a goal", "my goal is", "goal progress", "complete step", "track my goal"],
    weight: 1.2,
  },
  {
    intent: "tools",
    patterns: [
      /(?:list|show)\s+(?:your\s+|available\s+)?tools/i,
      /what\s+tools\s+do\s+you\s+have/i,
    ],
    keywords: ["list tools", "available tools", "what tools"],
    weight: 1.2,
  },
  {
    intent: "web_research",
    patterns: [
      /(?:search|look\s+up)\s+(?:the\s+)?(?:web|online|internet)\s+for\s+/i,
      /(?:google|wikipedia)\s+/i,
      /what\s+does\s+wikipedia\s+say\s+about\s+/i,
    ],
    keywords: ["search the web for", "look up online", "wikipedia says", "search online"],
    weight: 1.3,
  },
  {
    intent: "document",
    patterns: [
      /(?:index|read|learn)\s+(?:the\s+)?document\s+/i,
      /what\s+does\s+the\s+document\s+say\s+about\s+/i,
      /search\s+(?:my\s+)?documents?\s+for\s+/i,
    ],
    keywords: ["index document", "what does the document say", "search documents"],
    weight: 1.3,
  },
  {
    intent: "code_lookup",
    patterns: [
      /(?:find|look\s+up|where\s+is)\s+(?:the\s+)?(?:function|symbol|class)\s+/i,
      /what\s+does\s+(?:the\s+)?function\s+\w+\s+do/i,
    ],
    keywords: ["find function", "where is function", "find symbol", "what does function"],
    weight: 1.3,
  },
  {
    intent: "trace",
    patterns: [
      /how\s+did\s+you\s+(?:get|arrive\s+at|come\s+up\s+with)\s+that/i,
      /show\s+(?:me\s+)?your\s+reasoning/i,
      /explain\s+your\s+(?:answer|trace)/i,
    ],
    keywords: ["how did you get that", "show your reasoning", "explain your trace"],
    weight: 1.2,
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

  if (intent === "teach") {
    const m = text.match(/(?:remember|learn|note)\s+that\s+(.+?)\s+(?:is|are|means?)\s+(.+)/i);
    if (m) {
      entities.factKey = m[1].trim();
      entities.factValue = m[2].trim();
    } else {
      // "remember this: X is Y" / "learn the following: X is Y"
      const colonM = text.match(/(?:remember|learn)\s+(?:this|the\s+following)\s*:\s*(.+)/i);
      if (colonM) {
        const payload = colonM[1].trim();
        const kv = payload.match(/^(.+?)\s+(?:is|are|means?)\s+(.+)$/i);
        if (kv) { entities.factKey = kv[1].trim(); entities.factValue = kv[2].trim(); }
        else entities.factValue = payload;
      }
    }
  }

  if (intent === "correct") {
    const m = text.match(/(?:actually,?\s*)?(?:it'?s|it\s+is|the\s+(?:correct|right)\s+answer\s+is)\s+(.+)/i);
    if (m) entities.correctAnswer = m[1].replace(/[.!]+$/,"").trim();
  }

  if (intent === "research") {
    const m = text.match(/(?:research|look\s+into|dig\s+into|investigate|what\s+do\s+you\s+know\s+about|tell\s+me\s+everything(?:\s+you\s+know)?\s+about)\s+(.+)/i);
    if (m) entities.topic = m[1].replace(/[?!.]+$/,"").trim();
  }

  if (intent === "web_research") {
    const m = text.match(/(?:search|look\s+up)\s+(?:the\s+)?(?:web|online|internet)\s+for\s+(.+)/i)
      ?? text.match(/(?:google|wikipedia)\s+(.+)/i)
      ?? text.match(/what\s+does\s+wikipedia\s+say\s+about\s+(.+)/i);
    if (m) entities.topic = m[1].replace(/[?!.]+$/,"").trim();
  }

  if (intent === "document") {
    const idxM = text.match(/(?:index|read|learn)\s+(?:the\s+)?document\s+(.+)/i);
    if (idxM) entities.docPath = idxM[1].replace(/[?!.]+$/,"").trim();
    const qM = text.match(/what\s+does\s+the\s+document\s+say\s+about\s+(.+)/i)
      ?? text.match(/search\s+(?:my\s+)?documents?\s+for\s+(.+)/i);
    if (qM) entities.docQuery = qM[1].replace(/[?!.]+$/,"").trim();
  }

  if (intent === "code_lookup") {
    const m = text.match(/(?:find|look\s+up|where\s+is)\s+(?:the\s+)?(?:function|symbol|class)\s+(\w+)/i)
      ?? text.match(/what\s+does\s+(?:the\s+)?function\s+(\w+)\s+do/i);
    if (m) entities.symbolName = m[1].trim();
  }

  if (intent === "goal") {
    const startM = text.match(/(?:start|create|set)\s+a\s+goal\s*(?:to\s+|:\s*)?(.+)/i)
      ?? text.match(/(?:my\s+goal\s+is\s+to|help\s+me\s+plan)\s+(.+)/i)
      ?? text.match(/^goal\s*:\s*(.+)/i);
    if (startM) entities.goalTitle = startM[1].replace(/[?!.]+$/,"").trim();
    const stepM = text.match(/(?:mark|complete|finish)\s+step\s+(\d+)/i);
    if (stepM) entities.stepNumber = parseInt(stepM[1], 10);
  }

  if (intent === "comparative_query") {
    const supM = lower.match(/who\s+is\s+(?:the\s+)?(\w+)/i);
    if (supM) entities.superlative = supM[1];
    const cmpM = text.match(/is\s+([\w\s]+?)\s+(older|younger|taller|shorter|faster|slower|bigger|smaller|stronger|weaker|richer|poorer|heavier|lighter)\s+than\s+([\w\s]+?)[?.!]*$/i);
    if (cmpM) { entities.subjectA = cmpM[1].trim(); entities.comparative = cmpM[2]; entities.subjectB = cmpM[3].trim(); }
  }

  return entities;
}
