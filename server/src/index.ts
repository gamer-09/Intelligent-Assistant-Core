import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import chatRouter from "./routes/chat.js";
import assistantRouter from "./routes/assistant.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = parseInt(process.env.PORT ?? "3001", 10);

app.use(cors());
app.use(express.json());

// API routes
app.use("/api/chat", chatRouter);
app.use("/api/assistant", assistantRouter);

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
  console.log(`   Mode:   self-contained NLP (no external APIs)\n`);
});
