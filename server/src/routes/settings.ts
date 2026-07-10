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

/** Write a single key into server/.env, preserving comments and other keys.
 *
 *  Handles quoted values by stripping surrounding quotes when matching a key,
 *  and always writes the new value unquoted. Only updates the first occurrence
 *  of the key so that duplicate entries don't accumulate.
 */
function writeEnvKey(key: string, value: string): void {
  const content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf-8") : "";
  const lines = content.split("\n");
  let found = false;
  const updated = lines.map((line) => {
    // Preserve blank lines and comments exactly as-is.
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) return line;
    const k = trimmed.slice(0, eqIdx).trim();
    if (k === key && !found) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) updated.push(`${key}=${value}`);
  fs.writeFileSync(ENV_PATH, updated.join("\n"), "utf-8");
}

// GET /api/settings — return current assistant settings
router.get("/", (_req, res) => {
  const env = readEnvFile();
  // Use || (not ??) so an empty string in .env still falls back to process.env.
  const fsRoot = env["ASSISTANT_FS_ROOT"] || process.env.ASSISTANT_FS_ROOT || "";
  res.json({ fsRoot });
});

// POST /api/settings — update assistant settings
router.post("/", (req, res) => {
  const { fsRoot } = req.body as { fsRoot?: string };
  if (typeof fsRoot !== "string") {
    res.status(400).json({ error: "fsRoot must be a string" });
    return;
  }

  // Reject control characters (including newlines and carriage returns) to
  // prevent injecting extra keys into the .env file.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(fsRoot)) {
    res.status(400).json({ error: "fsRoot must not contain control characters or newlines." });
    return;
  }

  const trimmed = fsRoot.trim();

  // Apply to the running process immediately — this works even if the .env
  // write fails (e.g. read-only filesystem, wrong path).
  if (trimmed) {
    process.env.ASSISTANT_FS_ROOT = trimmed;
  } else {
    delete process.env.ASSISTANT_FS_ROOT;
  }

  // Persist to server/.env so the setting survives a server restart.
  let persisted = false;
  let persistError: string | undefined;
  try {
    writeEnvKey("ASSISTANT_FS_ROOT", trimmed);
    persisted = true;
  } catch (err) {
    persistError = err instanceof Error ? err.message : String(err);
    console.error("[settings] Failed to write .env:", persistError, "| ENV_PATH:", ENV_PATH);
  }

  res.json({ ok: true, fsRoot: trimmed, persisted, persistError });
});

export default router;
