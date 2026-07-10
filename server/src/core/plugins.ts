/**
 * Plugin architecture: any .ts/.js file dropped into server/src/plugins/
 * that default-exports a ToolSpec (see core/tools.ts) is auto-loaded at
 * boot and registered into the same tool registry the built-ins use. This
 * is the extension point requested by the review — new capabilities don't
 * require touching the core pipeline or intent detector's source.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { registerTool, type ToolSpec } from "./tools.js";

export async function loadPlugins(): Promise<string[]> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const pluginsDir = path.join(__dirname, "..", "plugins");
  if (!fs.existsSync(pluginsDir)) return [];

  const loaded: string[] = [];
  const entries = await fs.promises.readdir(pluginsDir);
  for (const entry of entries) {
    if (!/\.(ts|js)$/.test(entry) || entry.endsWith(".d.ts")) continue;
    try {
      const mod = (await import(pathToFileURL(path.join(pluginsDir, entry)).href)) as { default?: ToolSpec };
      if (mod.default && typeof mod.default.execute === "function" && typeof mod.default.name === "string") {
        registerTool(mod.default);
        loaded.push(mod.default.name);
      }
    } catch (err) {
      console.error(`[plugins] failed to load ${entry}:`, err instanceof Error ? err.message : err);
    }
  }
  return loaded;
}
