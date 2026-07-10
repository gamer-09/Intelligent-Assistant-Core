/**
 * Recursive-descent arithmetic parser + evaluator.
 *
 * Replaces `new Function(...)`-based evaluation (dynamic code execution on
 * sanitized input) with a real grammar: tokenize -> parse -> evaluate. This
 * gives precise error messages, a hard recursion/length ceiling instead of
 * regex sanitization, and a clean extension point for new functions.
 *
 * Grammar:
 *   expr    := term (("+" | "-") term)*
 *   term    := unary (("*" | "/" | "%") unary)*
 *   unary   := "-" unary | power
 *   power   := atom ("^" unary)?      // right-associative
 *   atom    := NUMBER | CONST | FUNC "(" expr ")" | "(" expr ")"
 */

export class MathParseError extends Error {}

type TokenType = "num" | "op" | "lparen" | "rparen" | "ident" | "comma";
interface Token { type: TokenType; value: string; }

const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  sin: (x) => Math.sin((x * Math.PI) / 180),
  cos: (x) => Math.cos((x * Math.PI) / 180),
  tan: (x) => Math.tan((x * Math.PI) / 180),
  log: Math.log10,
  ln: Math.log,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  if (expr.length > 300) throw new MathParseError("Expression too long.");
  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < expr.length && /[0-9.]/.test(expr[j])) j++;
      tokens.push({ type: "num", value: expr.slice(i, j) });
      i = j;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < expr.length && /[a-zA-Z]/.test(expr[j])) j++;
      tokens.push({ type: "ident", value: expr.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if ("+-*/%^".includes(c)) { tokens.push({ type: "op", value: c }); i++; continue; }
    if (c === "(") { tokens.push({ type: "lparen", value: c }); i++; continue; }
    if (c === ")") { tokens.push({ type: "rparen", value: c }); i++; continue; }
    if (c === ",") { tokens.push({ type: "comma", value: c }); i++; continue; }
    throw new MathParseError(`Unexpected character "${c}" at position ${i}.`);
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token | undefined { return this.tokens[this.pos]; }
  private next(): Token { const t = this.tokens[this.pos++]; if (!t) throw new MathParseError("Unexpected end of expression."); return t; }

  parse(): number {
    const v = this.expr();
    if (this.pos !== this.tokens.length) throw new MathParseError(`Unexpected token "${this.peek()?.value}".`);
    return v;
  }

  private expr(): number {
    let v = this.term();
    while (this.peek()?.type === "op" && (this.peek()!.value === "+" || this.peek()!.value === "-")) {
      const op = this.next().value;
      const rhs = this.term();
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  }

  private term(): number {
    let v = this.unary();
    while (this.peek()?.type === "op" && ["*", "/", "%"].includes(this.peek()!.value)) {
      const op = this.next().value;
      const rhs = this.unary();
      if ((op === "/" || op === "%") && rhs === 0) throw new MathParseError("Division by zero.");
      v = op === "*" ? v * rhs : op === "/" ? v / rhs : v % rhs;
    }
    return v;
  }

  private unary(): number {
    if (this.peek()?.type === "op" && this.peek()!.value === "-") { this.next(); return -this.unary(); }
    if (this.peek()?.type === "op" && this.peek()!.value === "+") { this.next(); return this.unary(); }
    return this.power();
  }

  private power(): number {
    const base = this.atom();
    if (this.peek()?.type === "op" && this.peek()!.value === "^") {
      this.next();
      const exp = this.unary();
      if (Math.abs(exp) > 1000) throw new MathParseError("Exponent too large.");
      return Math.pow(base, exp);
    }
    return base;
  }

  private atom(): number {
    const t = this.next();
    if (t.type === "num") return parseFloat(t.value);
    if (t.type === "lparen") {
      const v = this.expr();
      if (this.peek()?.type !== "rparen") throw new MathParseError("Missing closing parenthesis.");
      this.next();
      return v;
    }
    if (t.type === "ident") {
      if (t.value in CONSTANTS) return CONSTANTS[t.value];
      if (t.value in FUNCTIONS) {
        if (this.peek()?.type !== "lparen") throw new MathParseError(`Expected "(" after ${t.value}.`);
        this.next();
        const arg = this.expr();
        if (this.peek()?.type !== "rparen") throw new MathParseError("Missing closing parenthesis.");
        this.next();
        return FUNCTIONS[t.value](arg);
      }
      throw new MathParseError(`Unknown identifier "${t.value}".`);
    }
    throw new MathParseError(`Unexpected token "${t.value}".`);
  }
}

/** Parse and evaluate a math expression. Returns null (never throws) on failure. */
export function evaluateExpression(expr: string): { value: number; error: null } | { value: null; error: string } {
  try {
    const tokens = tokenize(expr);
    if (tokens.length === 0) return { value: null, error: "Empty expression." };
    const value = new Parser(tokens).parse();
    if (!isFinite(value)) return { value: null, error: "Result is not a finite number." };
    return { value, error: null };
  } catch (e) {
    return { value: null, error: e instanceof Error ? e.message : "Could not parse expression." };
  }
}
