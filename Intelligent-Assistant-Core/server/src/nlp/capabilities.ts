export interface Capability {
  id: string;
  name: string;
  description: string;
  examples: string[];
  category: string;
}

export const CAPABILITIES: Capability[] = [
  // Math
  { id: "math-arithmetic", name: "Arithmetic", description: "Add, subtract, multiply, divide, exponentiate.", examples: ["What is 248 * 73?", "Calculate 2^10", "15 plus 37 minus 8"], category: "Math" },
  { id: "math-percentage", name: "Percentages", description: "Calculate percentages instantly.", examples: ["What is 15% of 340?", "25% of 1200"], category: "Math" },
  { id: "math-prime", name: "Prime Numbers", description: "Check if a number is prime.", examples: ["Is 97 prime?", "Is 1000 prime?", "Is 17 prime?"], category: "Math" },
  { id: "math-fibonacci", name: "Fibonacci Sequence", description: "Generate Fibonacci numbers.", examples: ["Show 10 Fibonacci numbers", "Fibonacci 15"], category: "Math" },
  { id: "math-factorial", name: "Factorial", description: "Compute n! (factorial).", examples: ["What is 7 factorial?", "Calculate 5 factorial"], category: "Math" },
  { id: "math-sqrt", name: "Square Root", description: "Find the square root of any number.", examples: ["Square root of 144", "What is √256?"], category: "Math" },
  { id: "math-trig", name: "Trigonometry", description: "Calculate sin, cos, tan (degrees).", examples: ["sin(45)", "cos(60)", "tan(30)"], category: "Math" },
  { id: "math-log", name: "Logarithms", description: "Calculate log₁₀ and natural log (ln).", examples: ["log(1000)", "ln(2.718)"], category: "Math" },
  { id: "math-gcd-lcm", name: "GCD & LCM", description: "Greatest common divisor or least common multiple.", examples: ["GCD of 48 and 36", "LCM of 12 and 18"], category: "Math" },
  { id: "math-average", name: "Average / Mean", description: "Calculate the average of a list of numbers.", examples: ["Average of 10, 20, 30, 40", "Mean of 5 8 13 21"], category: "Math" },
  // Date & Time
  { id: "datetime-current", name: "Current Date & Time", description: "Get the current date, time, day, month, or year.", examples: ["What time is it?", "What is today's date?", "What year is it?"], category: "Date & Time" },
  { id: "datetime-days", name: "Days Until a Date", description: "Find how many days until a future date.", examples: ["How many days until December 25?", "Days until 2026-01-01"], category: "Date & Time" },
  // Unit Conversion
  { id: "convert-temperature", name: "Temperature", description: "Convert between °F, °C, and K.", examples: ["Convert 100°F to Celsius", "0°C to Fahrenheit", "300K to Celsius"], category: "Unit Conversion" },
  { id: "convert-distance", name: "Distance", description: "Convert between km, miles, m, cm, feet, inches.", examples: ["5 km in miles", "100 feet to meters"], category: "Unit Conversion" },
  { id: "convert-weight", name: "Weight", description: "Convert between kg, g, lb, oz, tons.", examples: ["5 kg to pounds", "10 lbs in kg"], category: "Unit Conversion" },
  // Text Analysis
  { id: "text-wordcount", name: "Word Count", description: "Count words in any text.", examples: ["How many words in 'the quick brown fox'?"], category: "Text Analysis" },
  { id: "text-charcount", name: "Character Count", description: "Count characters in text.", examples: ["How many characters in 'hello world'?"], category: "Text Analysis" },
  { id: "text-reverse", name: "Reverse Text", description: "Reverse any word or phrase.", examples: ["Reverse 'hello'", "Reverse 'intelligent assistant'"], category: "Text Analysis" },
  { id: "text-palindrome", name: "Palindrome Check", description: "Check if a word/phrase is a palindrome.", examples: ["Is 'racecar' a palindrome?", "Is 'level' a palindrome?"], category: "Text Analysis" },
  { id: "text-case", name: "Case Conversion", description: "Convert text to uppercase, lowercase, or title case.", examples: ["Uppercase 'hello world'", "Title case 'the quick brown fox'"], category: "Text Analysis" },
  // Knowledge
  { id: "knowledge-capitals", name: "Country Capitals", description: "Look up the capital city of any country.", examples: ["Capital of Japan", "What is the capital of Brazil?"], category: "Knowledge" },
  { id: "knowledge-countries", name: "Country Facts", description: "Basic facts about countries.", examples: ["Tell me about France", "Facts about Canada"], category: "Knowledge" },
  { id: "knowledge-inventions", name: "Inventions & Discoveries", description: "Who invented or discovered famous things.", examples: ["Who invented the telephone?", "Who created the World Wide Web?"], category: "Knowledge" },
  { id: "knowledge-definitions", name: "Tech Definitions", description: "Plain-language definitions of technical terms.", examples: ["What is an algorithm?", "Define API", "What is machine learning?"], category: "Knowledge" },
  // Numbers
  { id: "number-facts", name: "Number Facts", description: "Interesting facts about any number.", examples: ["Tell me a fact about 42", "What is special about 100?"], category: "Numbers" },
  { id: "number-random-fact", name: "Random Math Fact", description: "Get a random mathematical fact.", examples: ["Give me a random number fact", "Random math fact"], category: "Numbers" },
  // Word Games
  { id: "word-spell", name: "Spell a Word", description: "Get the letter-by-letter spelling of any word.", examples: ["How do you spell 'necessary'?", "Spell 'rhythm'"], category: "Word Games" },
  { id: "word-scramble", name: "Scramble a Word", description: "Randomly scramble the letters of a word.", examples: ["Scramble 'intelligent'", "Scramble 'algorithm'"], category: "Word Games" },
  // Lists & Reminders
  { id: "list-manage", name: "Lists", description: "Create and manage a simple in-session list.", examples: ["Add milk to my list", "Show my list", "Clear my list"], category: "Lists & Reminders" },
  { id: "reminder-set", name: "Reminders", description: "Set text reminders for this session.", examples: ["Remind me to call Alice", "Set a reminder to submit the report"], category: "Lists & Reminders" },
  // Conversation
  { id: "convo-greeting", name: "Greetings", description: "Say hello and start a conversation.", examples: ["Hello!", "Good morning", "Hi, how are you?"], category: "Conversation" },
  { id: "convo-joke", name: "Jokes", description: "Ask for a joke.", examples: ["Tell me a joke", "Say something funny", "Give me a riddle"], category: "Conversation" },
  { id: "convo-smalltalk", name: "About the Assistant", description: "Ask who or what the assistant is.", examples: ["Who are you?", "Are you an AI?", "What is your name?"], category: "Conversation" },
  { id: "convo-help", name: "Help", description: "Ask what the assistant can do.", examples: ["What can you do?", "Help", "Show me your features"], category: "Conversation" },
  // Learning & Growth
  { id: "learn-teach", name: "Teach a Fact", description: "Teach the assistant a new fact it will remember and recall later.", examples: ["Remember that my favorite color is blue", "Learn that the office WiFi password is guest123"], category: "Learning & Growth" },
  { id: "learn-correct", name: "Self-Correction", description: "Correct a wrong answer — it's remembered so the same mistake isn't repeated.", examples: ["That's wrong, actually it's 42", "No, the correct answer is Paris"], category: "Learning & Growth" },
  { id: "learn-reasoning", name: "Step-by-Step Reasoning", description: "Ask 'why' or 'how come' to get a step-by-step explanation from known facts.", examples: ["Why is recursion useful?", "Explain how encryption works"], category: "Learning & Growth" },
  { id: "learn-challenge", name: "Challenge Me", description: "Get a random problem to solve, with the answer checked and revealed.", examples: ["Challenge me", "Quiz me", "Give me a problem"], category: "Learning & Growth" },
  { id: "learn-research", name: "Research a Topic", description: "Gather everything known about a topic across built-in and taught knowledge; unknown topics are logged to learn later.", examples: ["Research recursion", "What do you know about Japan?"], category: "Learning & Growth" },
  // Reasoning & Common Sense
  { id: "reason-causal", name: "Cause & Effect", description: "Reason from a cause to its likely effect using a small built-in world model, with fuzzy matching for novel phrasing.", examples: ["What happens if I put ice in the sun?", "Why does a dropped glass break?"], category: "Reasoning & Common Sense" },
  { id: "reason-containment", name: "Size & Fit Common Sense", description: "Judge whether one everyday object could fit inside another, based on rough size categories.", examples: ["Can an elephant fit inside a backpack?", "Can a phone fit in a backpack?"], category: "Reasoning & Common Sense" },
  { id: "reason-concept-formation", name: "Shared Category Discovery", description: "Find a category several entities have in common by tracing their known is-a relationships, instead of requiring the category to be taught directly.", examples: ["What do a dog, a cat and a wolf have in common?"], category: "Reasoning & Common Sense" },
  { id: "reason-contradiction", name: "Contradiction Detection", description: "Flags when a newly taught comparison relation (e.g. 'older than') conflicts with one already learned, instead of silently storing both.", examples: ["Sarah is older than John", "John is older than Sarah"], category: "Reasoning & Common Sense" },
  { id: "reason-goal-resume", name: "Goal Follow-Through", description: "Proactively reminds you of an unfinished multi-step goal the next time you talk to it, instead of only reacting when asked.", examples: ["Help me plan a trip to Japan", "..."], category: "Reasoning & Common Sense" },
];

export const CATEGORIES = [...new Set(CAPABILITIES.map(c => c.category))];
