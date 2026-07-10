/**
 * Registers the assistant's built-in capabilities into the formal tool
 * registry (core/tools.ts). Pure metadata + thin wrappers — the actual
 * logic still lives in the existing handlers; this just makes each
 * capability introspectable (name/description/permissions/inputs/outputs)
 * instead of being an anonymous branch in a switch statement.
 */
import { registerTool } from "./tools.js";
import { lookupTopic, formatWebResult } from "./webIntel.js";
import { searchDocuments, listIndexedDocuments } from "./docIntel.js";
import { findSymbol } from "./codeIntel.js";
import { isSystemAccessEnabled, getConfiguredRoot } from "./systemAccess.js";
import path from "path";

export function registerBuiltinTools(): void {
  registerTool({
    name: "math_evaluator",
    description: "Evaluates arithmetic expressions via a recursive-descent parser (no dynamic code execution).",
    capabilities: ["math"],
    permission: "read",
    inputs: "A math expression string, e.g. '2 + 3 * 4'",
    outputs: "A number, or an error message if unparseable",
    execute: (input) => input,
  });

  registerTool({
    name: "knowledge_graph",
    description: "Traverses entity relations (capitals, inventions, taught facts) seeded into a local graph.",
    capabilities: ["general_knowledge", "definition", "research"],
    permission: "read",
    inputs: "An entity name",
    outputs: "Related entities/facts via typed edges",
    execute: (input) => input,
  });

  registerTool({
    name: "reasoning_chains",
    description: "Answers comparative questions ('who is oldest?') via transitive closure over taught relation facts.",
    capabilities: ["comparative_teach", "comparative_query"],
    permission: "read",
    inputs: "A comparative statement or question",
    outputs: "A ranked list or yes/no with the reasoning chain",
    execute: (input) => input,
  });

  registerTool({
    name: "web_lookup",
    description: "Fetches a factual summary from Wikipedia's public REST API and caches it locally with a citation.",
    capabilities: ["web_research"],
    permission: "external",
    inputs: "A topic name",
    outputs: "A cited summary paragraph",
    execute: async (input) => {
      const result = await lookupTopic(input);
      return result ? formatWebResult(result) : `No web result for "${input}".`;
    },
  });

  registerTool({
    name: "document_search",
    description: "Indexes local .txt/.md files and retrieves the most relevant chunks via BM25.",
    capabilities: ["document"],
    permission: "read",
    inputs: "A search query, or a file path to index",
    outputs: "Ranked document chunks with source and score",
    execute: (input) => {
      const hits = searchDocuments(input, 3);
      if (hits.length) return hits.map((h) => `${h.docName}#${h.chunkIndex}: ${h.content}`).join("\n\n");
      return `No indexed documents matched. Indexed docs: ${listIndexedDocuments().join(", ") || "none"}.`;
    },
  });

  registerTool({
    name: "code_symbol_search",
    description: "Parses the TypeScript AST (via the compiler API) to locate functions/classes/interfaces by name.",
    capabilities: ["code_lookup"],
    permission: "read",
    inputs: "A symbol name",
    outputs: "Matching symbols with file/line and signature",
    execute: (input) => {
      const hits = findSymbol(input, path.join(process.cwd(), "src"));
      return hits.length ? hits.map((h) => `${h.name} (${h.kind}) ${h.file}:${h.line}`).join("\n") : `No symbol "${input}" found.`;
    },
  });

  registerTool({
    name: "system_access",
    description: "Read-only look at machine stats and one user-approved local folder (ASSISTANT_FS_ROOT). No writes, no deletes, no execution — ever.",
    capabilities: ["system_info", "file_browse", "file_read"],
    permission: "read",
    inputs: "For file_browse/file_read: a relative path inside the approved folder. For system_info: no input.",
    outputs: "System stats, a directory listing, or plain-text file contents.",
    execute: (input, _context) => {
      if (!isSystemAccessEnabled()) {
        return "Local file access isn't enabled. Set ASSISTANT_FS_ROOT in server/.env to the one folder you want me to be able to look at, then restart the server.";
      }
      return `Configured root: ${getConfiguredRoot()}. Use the system_info/file_browse/file_read handlers for actual output.`;
    },
  });
}
