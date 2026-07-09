# Intelligent Assistant Core

A fully self-contained intelligent assistant that understands natural language — **no external AI APIs, no Ollama, no cloud dependencies**. Everything runs locally using a hand-built NLP engine.

---

## How It Works

The assistant reads your message, detects your intent through weighted pattern matching and keyword scoring, extracts relevant entities (numbers, units, quoted text), and generates a precise response — all in milliseconds, entirely on your machine.

**No API keys. No subscriptions. No internet required after setup.**

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/gamer-09/Intelligent-Assistant-Core.git
cd Intelligent-Assistant-Core

# 2. Install all dependencies
npm run install:all

# 3. Start (runs both server + client)
npm run dev
```

Open **http://localhost:5173** in your browser.

The server runs on **port 3001**, the client dev server on **port 5173** (auto-proxies API calls).

---

## Production Build

```bash
# Build both server and client
npm run build

# Start the production server (serves the built frontend too)
npm start
```

Open **http://localhost:3001** — the server serves the built React app directly.

---

## Project Structure

```
Intelligent-Assistant-Core/
├── server/                        # Express API + NLP engine
│   ├── src/
│   │   ├── nlp/
│   │   │   ├── intent-detector.ts   # Pattern + keyword intent detection
│   │   │   ├── response-generator.ts # Response logic for each intent
│   │   │   └── capabilities.ts      # Help guide data
│   │   ├── routes/
│   │   │   ├── chat.ts              # /api/chat/*
│   │   │   └── assistant.ts         # /api/assistant/*
│   │   ├── db/
│   │   │   └── index.ts             # SQLite setup (auto-created)
│   │   └── index.ts                 # Entry point
│   ├── data/                        # SQLite database (auto-created, gitignored)
│   └── package.json
├── client/                        # React + Vite frontend
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Chat.tsx             # Main chat interface
│   │   │   └── Help.tsx             # Capability guide page
│   │   ├── App.tsx
│   │   └── index.css
│   └── package.json
├── package.json                   # Root scripts (runs both)
└── .env.example
```

---

## What the Assistant Understands

Open the **Guide** page in the app for the full interactive list. Quick overview:

### Math
| What to say | Example |
|---|---|
| Arithmetic | `What is 248 * 73?` |
| Percentages | `What is 15% of 340?` |
| Prime check | `Is 97 prime?` |
| Fibonacci | `Show 10 Fibonacci numbers` |
| Factorial | `What is 7 factorial?` |
| Square root | `Square root of 144` |
| Powers | `12 squared`, `5 cubed` |
| Trig | `sin(45)`, `cos(60)`, `tan(30)` |
| Logarithms | `log(1000)`, `ln(2.718)` |
| GCD / LCM | `GCD of 48 and 36` |
| Average | `Average of 10, 20, 30, 40` |

### Date & Time
| What to say | Example |
|---|---|
| Current date/time | `What time is it?`, `What's today's date?` |
| Days until a date | `How many days until December 25?` |

### Unit Conversion
| What to say | Example |
|---|---|
| Temperature | `Convert 100°F to Celsius`, `0°C to Fahrenheit` |
| Distance | `5 km in miles`, `100 feet to meters` |
| Weight | `5 kg to pounds`, `10 lbs in kg` |

### Text Analysis
| What to say | Example |
|---|---|
| Word count | `How many words in 'the quick brown fox'?` |
| Character count | `How many characters in 'hello world'?` |
| Reverse | `Reverse 'hello'` |
| Palindrome | `Is 'racecar' a palindrome?` |
| Case change | `Uppercase 'hello world'` |
| Vowel count | `Count vowels in 'algorithm'` |

### Knowledge
| What to say | Example |
|---|---|
| Country capitals | `Capital of Japan` |
| Country facts | `Tell me about France` |
| Inventions | `Who invented the telephone?` |
| Tech definitions | `What is an algorithm?`, `Define API` |

### Numbers
| What to say | Example |
|---|---|
| Number facts | `Tell me a fact about 42` |
| Random fact | `Give me a random number fact` |

### Word Games
| What to say | Example |
|---|---|
| Spell a word | `How do you spell 'necessary'?` |
| Scramble | `Scramble 'intelligent'` |

### Lists & Reminders *(session-based)*
| What to say | Example |
|---|---|
| Add to list | `Add milk to my list` |
| Show list | `Show my list` |
| Clear list | `Clear my list` |
| Set reminder | `Remind me to call Alice` |

### Conversation
| What to say | Example |
|---|---|
| Greet | `Hello!`, `Good morning` |
| Jokes | `Tell me a joke` |
| About the AI | `Who are you?`, `Are you an AI?` |
| Help | `What can you do?` |

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/chat/message` | Send a message, get a response |
| `GET` | `/api/chat/history` | Get session conversation history |
| `DELETE` | `/api/chat/history` | Clear session history |
| `GET` | `/api/assistant/capabilities` | List all capabilities (for the guide) |
| `GET` | `/api/assistant/stats` | Session usage stats |
| `GET` | `/api/healthz` | Health check |

### POST `/api/chat/message`
```json
{
  "text": "What is 12 * 15?",
  "sessionId": "optional-session-id"
}
```

**Response:**
```json
{
  "userMessage":      { "id": 1, "role": "user",      "text": "...", "timestamp": "...", "intent": "math", "confidence": 0.9 },
  "assistantMessage": { "id": 2, "role": "assistant",  "text": "...", "timestamp": "...", "intent": "math", "confidence": 0.9 },
  "intent":    "math",
  "confidence": 0.9,
  "entities":  { "numbers": [12, 15] }
}
```

---

## How the NLP Engine Works

1. **Tokenisation** — the input is lowercased and trimmed
2. **Intent detection** — scored against 17 intent patterns, each with:
   - Regex patterns (high weight)
   - Keyword lists (lower weight)
   - A per-intent weight multiplier
3. **Entity extraction** — numbers, quoted strings, temperature units, math operators, etc.
4. **Response generation** — the top-scoring intent routes to a dedicated handler with full logic
5. **Persistence** — the exchange is stored in a local SQLite database

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Server port |

Copy `.env.example` to `.env` and edit as needed.

---

## Requirements

- **Node.js** v20+ (`node --version`)
- **npm** v9+ (comes with Node)

No database server required — SQLite is embedded and the database file is created automatically at `server/data/assistant.db`.

---

## Licence

MIT
