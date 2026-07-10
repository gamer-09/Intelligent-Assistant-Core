/**
 * Code intelligence via the TypeScript compiler API (already a dependency —
 * no new package needed): real AST parsing to build a symbol index
 * (functions, classes, interfaces) with file/line locations, instead of
 * regex/grep-based "code search".
 */
import fs from "fs";
import path from "path";
import ts from "typescript";

export interface CodeSymbol {
  name: string;
  kind: "function" | "class" | "interface" | "method" | "const";
  file: string;
  line: number;
  signature: string;
}

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.includes(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function extractSymbols(filePath: string): CodeSymbol[] {
  const source = fs.readFileSync(filePath, "utf-8");
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const symbols: CodeSymbol[] = [];

  function lineOf(node: ts.Node): number {
    return sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  }

  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      symbols.push({ name: node.name.text, kind: "function", file: filePath, line: lineOf(node), signature: node.getText().split("{")[0].trim() });
    } else if (ts.isClassDeclaration(node) && node.name) {
      symbols.push({ name: node.name.text, kind: "class", file: filePath, line: lineOf(node), signature: `class ${node.name.text}` });
    } else if (ts.isInterfaceDeclaration(node)) {
      symbols.push({ name: node.name.text, kind: "interface", file: filePath, line: lineOf(node), signature: `interface ${node.name.text}` });
    } else if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      symbols.push({ name: node.name.text, kind: "method", file: filePath, line: lineOf(node), signature: node.getText().split("{")[0].trim().slice(0, 120) });
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
          symbols.push({ name: decl.name.text, kind: "const", file: filePath, line: lineOf(node), signature: `const ${decl.name.text} = (...)` });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return symbols;
}

let cachedIndex: CodeSymbol[] | null = null;
let cachedRoot: string | null = null;

export function buildCodeIndex(rootDir: string): CodeSymbol[] {
  const files = walk(rootDir, [".ts", ".tsx"]);
  const symbols = files.flatMap((f) => {
    try { return extractSymbols(f); } catch { return []; }
  });
  cachedIndex = symbols;
  cachedRoot = rootDir;
  return symbols;
}

export function findSymbol(name: string, rootDir: string): CodeSymbol[] {
  if (!cachedIndex || cachedRoot !== rootDir) buildCodeIndex(rootDir);
  const lower = name.toLowerCase();
  return (cachedIndex ?? []).filter((s) => s.name.toLowerCase() === lower || s.name.toLowerCase().includes(lower));
}
