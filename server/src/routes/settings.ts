import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = Router();

// Resolve server/.env — one level above this file's compiled output (dist/routes/).
// During dev (ts-node / tsx) __dirname is src/routes/, so go up two levels to reach server/.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..", "..");
const ENV_PATH = path.join(SERVER_ROOT, ".env");

/** Read server/.env and return a key→value map. Creates the file if missing. */
function readEnvFile(): Record<string, string> {
  if (!fs.existsSync(ENV_PATH)) {
    // Seed from .env.example if present, otherwise start empty.
    const examplePath = path.join(SERVER_ROOT, ".env.example");
    const seed = fs.existsSync(examplePath) ? fs.readFileSync(examplePath, "utf-8") : "";
    fs.writeFileSync(ENV_PATH, seed, "utf-8");
  }
  const lines = fs.readFileSync(ENV_PATH, "utf-8").split("\n");
  const map: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    map[key] = value;
  }
  return map;
}

/** Write a single key into server/.env, preserving comments and other keys. */
function writeEnvKey(key: string, value: string): void {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf-8") : "";
  const lines = content.split("\n");
  let found = false;
  const updated = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed.includes("=")) return line;
    const idx = trimmed.indexOf("=");
    const k = trimmed.slice(0, idx).trim();
    if (k === key) { found = true; return `${key}=${value}`; }
    return line;
  });
  if (!found) updated.push(`${key}=${value}`);
  fs.writeFileSync(ENV_PATH, updated.join("\n"), "utf-8");
}

// GET /api/settings — return current assistant settings
router.get("/", (_req, res) => {
  const env = readEnvFile();
  // Also fall back to the live process env in case the .env file hasn't been
  // created yet (first run without a .env).
  const fsRoot = env["ASSISTANT_FS_ROOT"] ?? process.env.ASSISTANT_FS_ROOT ?? "";
  res.json({ fsRoot });
});

// POST /api/settings — update assistant settings
router.post("/", (req, res) => {
  const { fsRoot } = req.body as { fsRoot?: string };
  if (typeof fsRoot !== "string") {
    res.status(400).json({ error: "fsRoot must be a string" });
    return;
  }
  const trimmed = fsRoot.trim();
  writeEnvKey("ASSISTANT_FS_ROOT", trimmed);
  // Apply immediately to the running process so no restart is needed.
  process.env.ASSISTANT_FS_ROOT = trimmed || undefined as unknown as string;
  if (!trimmed) delete process.env.ASSISTANT_FS_ROOT;
  res.json({ ok: true, fsRoot: trimmed });
});

export default router;
