# Intelligent Assistant Core (aka "Yang")

A fully self-contained intelligent assistant that understands natural language — **no external AI APIs, no Ollama, no cloud dependencies**. Everything runs locally using a hand-built NLP engine. It also answers to the name **Yang**.

## Growth & self-correction

Beyond the fixed skills below, the assistant has a small learning layer (`server/src/nlp/memory.ts`, tables in `server/src/db/index.ts`) so it improves from use — still with zero external calls:

- **Teach it a fact** — `"Remember that <thing> is <fact>"`. Taught facts are checked before the built-in dictionaries, so they always take priority.
- **Correct a mistake** — after a wrong answer, say `"Actually, it's <correct answer>"` or `"That's wrong, the correct answer is ..."`. The correction is stored and that exact question will never get the wrong answer again.
- **Ask it to reason** — `"Why is X ...?"` / `"Explain how X works"` walks through what it knows about X step by step, using taught facts and built-in definitions.
- **Challenge it** — `"Challenge me"` / `"Quiz me"` generates a random problem, checks your answer, and reveals the solution.
- **Ask it to research** — `"Research X"` / `"What do you know about X?"` aggregates everything it has (taught facts + built-in knowledge) on a topic. If it comes up empty, the topic is logged as a "research gap" it can be taught later instead of silently failing.

---

## Requirements

- **Node.js v22.5 or later** — the server uses the built-in `node:sqlite` module (no native compilation, no extra packages)
- **npm** v9+ (comes with Node)

> ⚠️ If you're on Node.js v20 or earlier, upgrade to v22.5+ first.  
> Check your version: `node --version`

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/gamer-09/Intelligent-Assistant-Core.git
cd Intelligent-Assistant-Core

# 2. Install dependencies (no native compilation required)
npm run install:all

# 3. Start — server on :3001, client on :5173
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## Production Build

```bash
npm run build    # builds client + compiles server TypeScript
npm start        # serves everything from port 3001
```

Open **http://localhost:3001** — the server serves the built React app directly, single process.

---

## Project Structure

```
Intelligent-Assistant-Core/
├── server/                          # Express API + NLP engine
│   ├── src/
│   │   ├── nlp/
│   │   │   ├── intent-detector.ts   # Pattern + keyword intent detection
│   │   │   ├── response-generator.ts # Response logic for all 17 intents
│   │   │   └── capabilities.ts      # Help guide data (44 capabilities)
│   │   ├── routes/
│   │   │   ├── chat.ts              # POST/GET/DELETE /api/chat/*
│   │   │   └── assistant.ts         # GET /api/assistant/*
│   │   ├── db/
│   │   │   └── index.ts             # node:sqlite setup (auto-created)
│   │   └── index.ts                 # Express entry point
│   └── data/                        # SQLite DB file (auto-created, gitignored)
├── client/                          # React + Vite frontend
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Chat.tsx             # Chat interface with intent badges
│   │   │   └── Help.tsx             # Searchable capability guide
│   │   ├── App.tsx
│   │   └── index.css
│   └── vite.config.ts               # Proxies /api → localhost:3001
├── package.json                     # Root: dev / build / start / install:all
└── .env.example
```

---

## What the Assistant Understands

Open the **Guide** tab in the app for the full interactive list. Quick overview:

| Category | Examples |
|---|---|
| **Math** | `What is 248 * 73?` · `Is 97 prime?` · `7 factorial` · `sin(45)` · `GCD of 48 and 36` |
| **Date & Time** | `What time is it?` · `How many days until December 25?` |
| **Unit Conversion** | `Convert 100°F to Celsius` · `5 km in miles` · `5 kg to pounds` |
| **Text Analysis** | `Reverse 'hello'` · `Is 'racecar' a palindrome?` · `Count words in '...'` |
| **Knowledge** | `Capital of Japan` · `Who invented the telephone?` · `What is an algorithm?` |
| **Lists & Reminders** | `Add milk to my list` · `Remind me to call Alice` |
| **Word Games** | `Spell 'necessary'` · `Scramble 'intelligent'` |
| **Conversation** | `Tell me a joke` · `Who are you?` · `What can you do?` |
| **Reasoning & Common Sense** | `What happens if I put ice in the sun?` · `Can an elephant fit inside a backpack?` · `What do a dog, a cat and a wolf have in common?` |

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/chat/message` | Send a message, get a response |
| `GET` | `/api/chat/history?sessionId=` | Get conversation history |
| `DELETE` | `/api/chat/history?sessionId=` | Clear conversation history |
| `GET` | `/api/assistant/capabilities` | List all 44 capabilities |
| `GET` | `/api/assistant/stats?sessionId=` | Session usage stats |
| `GET` | `/api/healthz` | Health check |

### Example

```bash
curl -X POST http://localhost:3001/api/chat/message \
  -H "Content-Type: application/json" \
  -d '{"text": "What is 12 * 15?", "sessionId": "test"}'
```

```json
{
  "userMessage":      { "id": 1, "role": "user",      "text": "What is 12 * 15?", "intent": "math", "confidence": 0.9 },
  "assistantMessage": { "id": 2, "role": "assistant",  "text": "12 * 15 = **180**",  "intent": "math", "confidence": 0.9 },
  "intent": "math",
  "confidence": 0.9,
  "entities": { "numbers": [12, 15] }
}
```

---

## How the NLP Engine Works

1. **Tokenisation** — input is lowercased and trimmed
2. **Intent scoring** — compared against 17 intent profiles, each with regex patterns (high weight) and keyword lists (lower weight)
3. **Entity extraction** — numbers, quoted strings, unit tokens, math operators
4. **Response dispatch** — top-scoring intent routes to a dedicated handler
5. **Persistence** — exchange stored in a local SQLite database (via `node:sqlite`)

No machine learning, no embeddings, no external calls — pure deterministic logic.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Server port |
| `GEMINI_API_KEY` | *(none)* | Optional server-wide default. Everything else works fully offline without it. |

You don't have to set `GEMINI_API_KEY` on the server at all — the **Gemini tab** in the app has a box to paste your own key directly in the browser. It's stored in `localStorage` and sent only with your own requests; it's never written to the server's `.env`.

Copy `.env.example` to `.env` to override.

---

## Licence

MIT
