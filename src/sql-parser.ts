import type {
  ExprAst,
  JoinAst,
  OrderItemAst,
  SelectItemAst,
  SelectStatementAst,
  SqlAstStatement,
} from "./sql-ast.js";

function trimQuoted(v: string): string {
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) return v.slice(1, -1);
  return v;
}

function castLiteral(raw: string): string | number | boolean | null {
  const v = trimQuoted(raw.trim());
  if (/^null$/i.test(v)) return null;
  if (/^true$/i.test(v)) return true;
  if (/^false$/i.test(v)) return false;
  if (v !== "" && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

function splitCommaAware(input: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quote = "";
  let depth = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quote) {
      buf += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);

    if (ch === "," && depth === 0) {
      out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function tokenizeExpr(input: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === "'" || ch === '"') {
      const q = ch;
      let j = i + 1;
      let v = ch;
      while (j < input.length) {
        const cj = input[j]!;
        v += cj;
        if (cj === q) {
          j++;
          break;
        }
        j++;
      }
      out.push(v);
      i = j;
      continue;
    }

    const two = input.slice(i, i + 2);
    if ([">=", "<=", "!=", "<>", "||"].includes(two)) {
      out.push(two);
      i += 2;
      continue;
    }

    if ("(),+-*/%=<>".includes(ch)) {
      out.push(ch);
      i++;
      continue;
    }

    let j = i;
    while (j < input.length && /[a-zA-Z0-9_\.]/.test(input[j]!)) j++;
    if (j > i) {
      out.push(input.slice(i, j));
      i = j;
      continue;
    }

    out.push(ch);
    i++;
  }
  return out;
}

class TokenStream {
  private i = 0;
  constructor(private readonly tokens: string[]) {}

  peek(): string | undefined {
    return this.tokens[this.i];
  }

  next(): string | undefined {
    const t = this.tokens[this.i];
    if (t !== undefined) this.i++;
    return t;
  }

  match(token: string): boolean {
    const t = this.peek();
    if (!t) return false;
    if (t.toUpperCase() === token.toUpperCase()) {
      this.next();
      return true;
    }
    return false;
  }

  expect(token: string): void {
    if (!this.match(token)) throw new Error(`expected ${token}`);
  }

  eof(): boolean {
    return this.i >= this.tokens.length;
  }
}

function isIdentifierToken(s?: string): boolean {
  return !!s && /^[a-zA-Z_][a-zA-Z0-9_\.]*$/.test(s);
}

function parsePrimary(ts: TokenStream): ExprAst {
  const t = ts.next();
  if (!t) throw new Error("unexpected eof");

  if (t === "(") {
    const expr = parseOr(ts);
    ts.expect(")");
    return expr;
  }

  if (/^(null|true|false|\-?\d+(?:\.\d+)?)$/i.test(t) || /^'.*'$/.test(t) || /^".*"$/.test(t)) {
    return { kind: "literal", value: castLiteral(t) };
  }

  if (isIdentifierToken(t) && ts.peek() === "(") {
    ts.next(); // (
    const args: ExprAst[] = [];
    if (ts.peek() !== ")") {
      while (!ts.eof()) {
        args.push(parseOr(ts));
        if (ts.peek() === ",") {
          ts.next();
          continue;
        }
        break;
      }
    }
    ts.expect(")");
    return { kind: "function", name: t.toUpperCase(), args };
  }

  if (isIdentifierToken(t)) return { kind: "identifier", name: t };

  return { kind: "raw", text: t };
}

function parseUnary(ts: TokenStream): ExprAst {
  if (ts.match("NOT")) {
    return { kind: "unary", op: "NOT", expr: parseUnary(ts) };
  }
  if (ts.match("-")) {
    return { kind: "unary", op: "-", expr: parseUnary(ts) };
  }
  if (ts.match("+")) {
    return { kind: "unary", op: "+", expr: parseUnary(ts) };
  }
  return parsePrimary(ts);
}

function parseMul(ts: TokenStream): ExprAst {
  let left = parseUnary(ts);
  while (true) {
    const op = ts.peek();
    if (!op || !["*", "/", "%"].includes(op)) break;
    ts.next();
    const right = parseUnary(ts);
    left = { kind: "binary", op, left, right };
  }
  return left;
}

function parseAdd(ts: TokenStream): ExprAst {
  let left = parseMul(ts);
  while (true) {
    const op = ts.peek();
    if (!op || !["+", "-"].includes(op)) break;
    ts.next();
    const right = parseMul(ts);
    left = { kind: "binary", op, left, right };
  }
  return left;
}

function parseCompare(ts: TokenStream): ExprAst {
  let left = parseAdd(ts);

  if (ts.match("IS")) {
    if (ts.match("NOT")) {
      if (ts.match("NULL")) return { kind: "binary", op: "IS NOT", left, right: { kind: "literal", value: null } };
      const right = parseAdd(ts);
      return { kind: "binary", op: "IS NOT", left, right };
    }
    if (ts.match("NULL")) return { kind: "binary", op: "IS", left, right: { kind: "literal", value: null } };
    const right = parseAdd(ts);
    return { kind: "binary", op: "IS", left, right };
  }

  if (ts.match("NOT")) {
    if (ts.match("IN")) {
      ts.expect("(");
      const vals: ExprAst[] = [];
      while (ts.peek() && ts.peek() !== ")") {
        vals.push(parseOr(ts));
        if (ts.peek() === ",") ts.next();
      }
      ts.expect(")");
      return { kind: "binary", op: "NOT IN", left, right: { kind: "function", name: "LIST", args: vals } };
    }
    if (ts.match("BETWEEN")) {
      const a = parseAdd(ts);
      ts.expect("AND");
      const b = parseAdd(ts);
      return { kind: "binary", op: "NOT BETWEEN", left, right: { kind: "function", name: "RANGE", args: [a, b] } };
    }
    if (ts.match("LIKE")) {
      const pat = parseAdd(ts);
      return { kind: "binary", op: "NOT LIKE", left, right: pat };
    }
  }

  if (ts.match("IN")) {
    ts.expect("(");
    const vals: ExprAst[] = [];
    while (ts.peek() && ts.peek() !== ")") {
      vals.push(parseOr(ts));
      if (ts.peek() === ",") ts.next();
    }
    ts.expect(")");
    return { kind: "binary", op: "IN", left, right: { kind: "function", name: "LIST", args: vals } };
  }

  if (ts.match("BETWEEN")) {
    const a = parseAdd(ts);
    ts.expect("AND");
    const b = parseAdd(ts);
    return { kind: "binary", op: "BETWEEN", left, right: { kind: "function", name: "RANGE", args: [a, b] } };
  }

  if (ts.match("LIKE")) {
    const pat = parseAdd(ts);
    return { kind: "binary", op: "LIKE", left, right: pat };
  }

  const op = ts.peek();
  if (op && ["=", "!=", "<>", ">", "<", ">=", "<="].includes(op)) {
    ts.next();
    const right = parseAdd(ts);
    return { kind: "binary", op, left, right };
  }

  return left;
}

function parseAnd(ts: TokenStream): ExprAst {
  let left = parseCompare(ts);
  while (ts.match("AND")) {
    const right = parseCompare(ts);
    left = { kind: "binary", op: "AND", left, right };
  }
  return left;
}

function parseOr(ts: TokenStream): ExprAst {
  let left = parseAnd(ts);
  while (ts.match("OR")) {
    const right = parseAnd(ts);
    left = { kind: "binary", op: "OR", left, right };
  }
  return left;
}

function parseExpr(input: string): ExprAst {
  const s = input.trim();

  // Keep complex subquery predicates as raw SQL until dedicated AST nodes land.
  if (
    /\b(?:NOT\s+)?EXISTS\s*\(\s*SELECT\b/i.test(s)
    || /\b(?:ANY|SOME|ALL)\s*\(\s*SELECT\b/i.test(s)
    || /\b(?:NOT\s+)?IN\s*\(\s*SELECT\b/i.test(s)
    || /[=<>!]\s*\(\s*SELECT\b/i.test(s)
  ) {
    return { kind: "raw", text: s };
  }

  const ts = new TokenStream(tokenizeExpr(s));
  try {
    const expr = parseOr(ts);
    if (!ts.eof()) return { kind: "raw", text: s };
    return expr;
  } catch {
    return { kind: "raw", text: s };
  }
}

function parseSelectItems(raw: string): SelectItemAst[] {
  return splitCommaAware(raw).map((item) => {
    const m = item.match(/^(.+?)\s+AS\s+([a-zA-Z_][a-zA-Z0-9_]*)$/i);
    if (m) {
      const exprText = m[1]!;
      const expr = /\bOVER\s*\(/i.test(exprText) ? ({ kind: "raw", text: exprText } as ExprAst) : parseExpr(exprText);
      return { kind: "select_item", expr, alias: m[2]! };
    }
    const expr = /\bOVER\s*\(/i.test(item) ? ({ kind: "raw", text: item } as ExprAst) : parseExpr(item);
    return { kind: "select_item", expr };
  });
}

function parseOrderItems(raw?: string): OrderItemAst[] | undefined {
  if (!raw) return undefined;
  return splitCommaAware(raw).map((part) => {
    const m = part.match(/^(.+?)(?:\s+(ASC|DESC))?$/i);
    const exprText = m?.[1] ?? part;
    const expr = /\bOVER\s*\(/i.test(exprText) ? ({ kind: "raw", text: exprText } as ExprAst) : parseExpr(exprText);
    const direction = ((m?.[2] ?? "ASC").toUpperCase() as "ASC" | "DESC");
    return { kind: "order_item", expr, direction };
  });
}

function parseJoin(tail: string): { join?: JoinAst; rest: string } {
  const jm = tail.match(
    /^\s+(INNER|LEFT|RIGHT)\s+JOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+ON\s+([a-zA-Z_][a-zA-Z0-9_\.]*)\s*=\s*([a-zA-Z_][a-zA-Z0-9_\.]*)\s*(.*)$/i,
  );
  if (!jm) return { rest: tail };
  return {
    join: {
      kind: "join",
      joinType: jm[1]!.toUpperCase() as "INNER" | "LEFT" | "RIGHT",
      table: jm[2]!,
      onLeft: jm[3]!,
      onRight: jm[4]!,
    },
    rest: jm[5] ?? "",
  };
}

export function parseSqlToAst(sql: string): SqlAstStatement {
  const normalized = sql.trim().replace(/\s+/g, " ");
  const explain = /^EXPLAIN\s+/i.test(normalized);
  const base = explain ? normalized.replace(/^EXPLAIN\s+/i, "") : normalized;

  const m = base.match(/^SELECT\s+(.+?)\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)\b(.*)$/i);
  if (!m) return { kind: "unknown", rawSql: sql };

  const selectFields = m[1]!.trim();
  const from = m[2]!.trim();

  const { join, rest } = parseJoin(m[3] ?? "");
  const tm = rest.match(
    /^(?:\s*WHERE\s+(.+?))?(?:\s*GROUP BY\s+(.+?))?(?:\s*HAVING\s+(.+?))?(?:\s*ORDER BY\s+(.+?))?(?:\s*LIMIT\s+(\d+))?(?:\s*OFFSET\s+(\d+))?\s*$/i,
  );
  if (!tm) return { kind: "unknown", rawSql: sql };

  const where = tm[1]?.trim();
  const groupBy = tm[2]?.trim();
  const having = tm[3]?.trim();
  const orderBy = tm[4]?.trim();
  const limit = tm[5] ? Number(tm[5]) : undefined;
  const offset = tm[6] ? Number(tm[6]) : undefined;

  const ast: SelectStatementAst = {
    kind: "select",
    explain,
    from: { kind: "table", name: from },
    selectItems: parseSelectItems(selectFields),
    where: where ? parseExpr(where) : undefined,
    whereText: where,
    groupBy: groupBy ? splitCommaAware(groupBy).map(parseExpr) : undefined,
    having: having ? parseExpr(having) : undefined,
    havingText: having,
    orderBy: parseOrderItems(orderBy),
    limit,
    offset,
    join,
    rawSql: sql,
  };

  return ast;
}
