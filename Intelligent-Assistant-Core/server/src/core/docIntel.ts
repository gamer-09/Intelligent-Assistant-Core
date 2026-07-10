/**
 * Document intelligence: index plain text/markdown documents and answer
 * queries against them via BM25 retrieval over chunks. Scope is
 * deliberately limited to .txt/.md (no PDF/DOCX parsing) to avoid adding
 * heavy new dependencies — matches the review's own suggestion that
 * classical retrieval, not new binary parsers, is the priority here.
 */
import fs from "fs";
import path from "path";
import { stmts, type DocumentRow } from "../db/index.js";
import { Corpus } from "./retrieval.js";

const CHUNK_SIZE = 800; // chars per chunk, roughly a paragraph or two

// All document indexing is sandboxed under this directory — user-supplied
// paths are resolved relative to it and any escape (absolute paths, `..`
// traversal, symlink escape) is rejected. Prevents arbitrary local file
// reads via the document-intelligence intent.
export const DOCS_ROOT = path.resolve(process.cwd(), "documents");

function resolveWithinDocsRoot(userPath: string): { ok: true; resolved: string } | { ok: false; error: string } {
  if (!fs.existsSync(DOCS_ROOT)) fs.mkdirSync(DOCS_ROOT, { recursive: true });
  const resolved = path.resolve(DOCS_ROOT, userPath);
  const rootWithSep = DOCS_ROOT.endsWith(path.sep) ? DOCS_ROOT : DOCS_ROOT + path.sep;
  if (resolved !== DOCS_ROOT && !resolved.startsWith(rootWithSep)) {
    return { ok: false, error: `For safety, documents must live under ${DOCS_ROOT}. Put the file there and reference it by its name (no "..", no absolute paths).` };
  }
  return { ok: true, resolved };
}

function chunkText(text: string): string[] {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buf = "";
  for (const p of paras) {
    if ((buf + "\n\n" + p).length > CHUNK_SIZE && buf) {
      chunks.push(buf.trim());
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

/** Index a document from a filesystem path (.txt/.md only). */
export function indexDocumentFile(filePath: string): { docName: string; chunks: number } | { error: string } {
  const ext = path.extname(filePath).toLowerCase();
  if (![".txt", ".md"].includes(ext)) {
    return { error: `Only .txt and .md files are supported for document indexing (got "${ext}").` };
  }
  const sandboxed = resolveWithinDocsRoot(filePath);
  if (!sandboxed.ok) return { error: sandboxed.error };
  const resolved = sandboxed.resolved;
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return { error: `File not found: ${filePath}` };
  const text = fs.readFileSync(resolved, "utf-8");
  const docName = path.basename(resolved);
  return indexDocumentText(docName, text);
}

export function indexDocumentText(docName: string, text: string): { docName: string; chunks: number } {
  stmts.deleteDoc.run(docName);
  const chunks = chunkText(text);
  chunks.forEach((chunk, i) => stmts.insertDocChunk.run(docName, i, chunk));
  return { docName, chunks: chunks.length };
}

export function listIndexedDocuments(): string[] {
  return (stmts.listDocNames.all() as { doc_name: string }[]).map((r) => r.doc_name);
}

export interface DocSearchHit { docName: string; chunkIndex: number; content: string; score: number; }

export function searchDocuments(query: string, limit = 3): DocSearchHit[] {
  const rows = stmts.allDocChunks.all() as unknown as DocumentRow[];
  if (rows.length === 0) return [];
  const corpus = new Corpus<DocumentRow>();
  corpus.build(rows.map((r) => ({ id: String(r.id), text: r.content, payload: r })));
  return corpus.bm25(query, limit).map(({ doc, score }) => ({
    docName: doc.payload.doc_name,
    chunkIndex: doc.payload.chunk_index,
    content: doc.payload.content,
    score,
  }));
}
