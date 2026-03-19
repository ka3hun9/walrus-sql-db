import { createSqlError } from "./sql-errors.js";
import { inspectSqlGrammarSkeleton, type SqlDialectProfile, type SqlGrammarSkeleton } from "./sql-grammar-skeleton.js";
import type {
  CreateIndexStatementAst,
  CreateViewStatementAst,
  DropIndexStatementAst,
  DropViewStatementAst,
  ExprAst,
  JoinAst,
  OrderItemAst,
  SelectItemAst,
  SelectStatementAst,
  SqlAstStatement,
  TransactionStatementAst,
  TableRefAst,
} from "./sql-ast.js";
import { fromLiteral, type SqlPrimitive } from "./types.js";

function detectUnsupportedDialectCastType(sql: string, dialect: SqlDialectProfile = "ansi"): string | null {
  const text = sql.toUpperCase();
  const castTargets = Array.from(text.matchAll(/\bCAST\s*\(.*?\bAS\s+([A-Z_][A-Z0-9_]*)\b.*?\)/g)).map(
    (m) => m[1]!,
  );
  if (castTargets.length === 0) return null;

  const mysqlOnly = new Set(["UNSIGNED", "SIGNED"]);
  const sqlserverOnly = new Set(["NVARCHAR", "DATETIME2"]);
  const postgresOnly = new Set(["BYTEA"]);
  const sqliteOnly = new Set(["NONE"]);

  for (const t of castTargets) {
    if (mysqlOnly.has(t) && dialect !== "mysql") return t;
    if (sqlserverOnly.has(t) && dialect !== "sqlserver") return t;
    if (postgresOnly.has(t) && dialect !== "postgres") return t;
    if (sqliteOnly.has(t) && dialect !== "sqlite") return t;
  }

  return null;
}

function detectUnsupportedDialectOperator(sql: string, dialect: SqlDialectProfile = "ansi"): string | null {
  const textUpper = sql.toUpperCase();

  const hasIlike = /\bILIKE\b/.test(textUpper);
  if (hasIlike && dialect !== "postgres") return "ILIKE";

  const hasRegexp = /\bREGEXP\b/.test(textUpper);
  if (hasRegexp && !(dialect === "mysql" || dialect === "sqlite")) return "REGEXP";

  const hasPostgresRegexOp = /!~\*|!~|~\*/.test(sql) || /(^|[^!])~([^*]|$)/.test(sql);
  if (hasPostgresRegexOp && dialect !== "postgres") return "~";

  return null;
}

function detectUnsupportedDialectFunction(sql: string, dialect: SqlDialectProfile = "ansi"): string | null {
  const text = sql.toUpperCase();
  const fnMatches = Array.from(text.matchAll(/\b([A-Z_][A-Z0-9_]*)\s*\(/g)).map((m) => m[1]!);
  if (fnMatches.length === 0) return null;

  const mysqlOnly = new Set(["IFNULL"]);
  const sqlserverOnly = new Set(["ISNULL", "IIF"]);
  const postgresOnly = new Set(["DATE_TRUNC"]);
  const sqliteOnly = new Set(["PRINTF"]);

  for (const fn of fnMatches) {
    if (mysqlOnly.has(fn) && dialect !== "mysql") return fn;
    if (sqlserverOnly.has(fn) && dialect !== "sqlserver") return fn;
    if (postgresOnly.has(fn) && dialect !== "postgres") return fn;
    if (sqliteOnly.has(fn) && dialect !== "sqlite") return fn;
  }

  return null;
}

function normalizeDialectQuotedIdentifiers(sql: string, dialect: SqlDialectProfile = "ansi"): string {
  const hasBacktickQuoted = /`[^`]+`/.test(sql);
  const hasBracketQuoted = /\[[^\]]+\]/.test(sql);

  if (hasBacktickQuoted && dialect !== "mysql") {
    throw createSqlError("SQL_DIALECT_UNSUPPORTED_SYNTAX", {
      message: "Backtick-quoted identifiers are only enabled for mysql dialect profile",
      token: "`",
      dialect,
    });
  }

  if (hasBracketQuoted && dialect !== "sqlserver") {
    throw createSqlError("SQL_DIALECT_UNSUPPORTED_SYNTAX", {
      message: "Bracket-quoted identifiers are only enabled for sqlserver dialect profile",
      token: "[",
      dialect,
    });
  }

  let out = sql;
  if (dialect === "mysql") {
    out = out.replace(/`([a-zA-Z_][a-zA-Z0-9_]*)`/g, "$1");
  }
  if (dialect === "sqlserver") {
    out = out.replace(/\[([a-zA-Z_][a-zA-Z0-9_]*)\]/g, "$1");
  }
  return out;
}

function trimQuoted(v: string): string {
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) return v.slice(1, -1);
  return v;
}

function castLiteral(raw: string): SqlPrimitive {
  const v = trimQuoted(raw.trim());
  if (/^null$/i.test(v)) return null;
  if (/^true$/i.test(v)) return true;
  if (/^false$/i.test(v)) return false;
  if (v !== "" && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

function literalExpr(value: SqlPrimitive): ExprAst {
  return { kind: "literal", typedValue: fromLiteral(value) };
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
    return literalExpr(castLiteral(t));
  }

  if (isIdentifierToken(t) && ts.peek() === "(") {
    const fn = t.toUpperCase();
    ts.next(); // (

    if (fn === "CAST") {
      const valueExpr = parseOr(ts);
      ts.expect("AS");
      const targetType = ts.next();
      if (!targetType) throw new Error("expected CAST target type");
      ts.expect(")");
      return {
        kind: "function",
        name: "CAST",
        args: [valueExpr, literalExpr(targetType.toUpperCase())],
      };
    }

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
    return { kind: "function", name: fn, args };
  }

  if (isIdentifierToken(t)) return { kind: "identifier", name: t };

  return { kind: "raw", text: t };
}

function parseUnary(ts: TokenStream): ExprAst {
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
      if (ts.match("NULL")) return { kind: "binary", op: "IS NOT", left, right: literalExpr(null) };
      const right = parseAdd(ts);
      return { kind: "binary", op: "IS NOT", left, right };
    }
    if (ts.match("NULL")) return { kind: "binary", op: "IS", left, right: literalExpr(null) };
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

function parseNot(ts: TokenStream): ExprAst {
  if (ts.match("NOT")) {
    return { kind: "unary", op: "NOT", expr: parseNot(ts) };
  }
  return parseCompare(ts);
}

function parseAnd(ts: TokenStream): ExprAst {
  let left = parseNot(ts);
  while (ts.match("AND")) {
    const right = parseNot(ts);
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

function parseJoinChain(tail: string): { joins: JoinAst[]; rest: string } {
  const joins: JoinAst[] = [];
  let rest = tail;

  while (true) {
    const jm = rest.match(
      /^\s*(?:(INNER|LEFT|RIGHT|FULL)(?:\s+OUTER)?\s+)?JOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?\s+ON\s+([a-zA-Z_][a-zA-Z0-9_\.]*)\s*=\s*([a-zA-Z_][a-zA-Z0-9_\.]*)\s*(.*)$/i,
    );
    if (!jm) break;

    const joinType = (jm[1]?.toUpperCase() ?? "INNER") as "INNER" | "LEFT" | "RIGHT" | "FULL";
    joins.push({
      kind: "join",
      joinType,
      table: jm[2]!,
      onLeft: jm[4]!,
      onRight: jm[5]!,
    });

    rest = jm[6] ?? "";
  }

  return { joins, rest };
}

function parseJoin(tail: string): { join?: JoinAst; rest: string } {
  const { joins, rest } = parseJoinChain(tail);
  return { join: joins[0], rest };
}

function parseFromRef(base: string): { from: TableRefAst; tail: string } | null {
  const sub = base.match(/^SELECT\s+(.+?)\s+FROM\s*\((SELECT\s+.+)\)\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\b(.*)$/i);
  if (sub) {
    const outerFields = sub[1]!.trim();
    const subquerySql = sub[2]!.trim();
    const alias = sub[3]!.trim();
    const tail = sub[4] ?? "";
    const rewrittenSql = `SELECT ${outerFields} FROM __DERIVED_TABLE__${tail}`;
    return {
      from: {
        kind: "subquery",
        subquerySql,
        alias,
        rewrittenSql,
      },
      tail,
    };
  }

  const table = base.match(/^SELECT\s+(.+?)\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)\b(.*)$/i);
  if (!table) return null;

  let alias: string | undefined;
  let tail = table[3] ?? "";
  const aliasCandidate = tail.match(/^\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\b(.*)$/i);
  if (aliasCandidate) {
    const token = aliasCandidate[1]!.toUpperCase();
    const clauseKeywords = new Set([
      "WHERE",
      "GROUP",
      "HAVING",
      "ORDER",
      "LIMIT",
      "OFFSET",
      "FETCH",
      "INNER",
      "LEFT",
      "RIGHT",
      "FULL",
      "JOIN",
      "UNION",
      "INTERSECT",
      "EXCEPT",
    ]);
    if (!clauseKeywords.has(token)) {
      alias = aliasCandidate[1]!;
      tail = aliasCandidate[2] ?? "";
    }
  }

  return {
    from: { kind: "table", name: table[2]!.trim(), alias },
    tail,
  };
}

type TopLevelSetOperator = "UNION" | "INTERSECT" | "EXCEPT";

function splitSetOpTopLevel(
  sql: string,
): { operator: TopLevelSetOperator; leftSql: string; rightSql: string; all: boolean } | null {
  let depth = 0;
  let quote = "";
  let lastSetOpIndex: number | null = null;
  let lastSetOpLength = 0;
  let lastSetOpAll = false;
  let lastOperator: TopLevelSetOperator = "UNION";

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;

    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (ch === "(") {
      depth++;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth !== 0) continue;

    const prev = i === 0 ? " " : sql[i - 1]!;
    if (/[a-zA-Z0-9_]/.test(prev)) continue;

    const rest = sql.slice(i).toUpperCase();
    if (rest.startsWith("UNION ALL") && (rest.length === "UNION ALL".length || /\s/.test(rest["UNION ALL".length]!))) {
      lastSetOpIndex = i;
      lastSetOpLength = "UNION ALL".length;
      lastSetOpAll = true;
      lastOperator = "UNION";
      continue;
    }
    if (
      rest.startsWith("INTERSECT ALL")
      && (rest.length === "INTERSECT ALL".length || /\s/.test(rest["INTERSECT ALL".length]!))
    ) {
      lastSetOpIndex = i;
      lastSetOpLength = "INTERSECT ALL".length;
      lastSetOpAll = true;
      lastOperator = "INTERSECT";
      continue;
    }
    if (rest.startsWith("EXCEPT ALL") && (rest.length === "EXCEPT ALL".length || /\s/.test(rest["EXCEPT ALL".length]!))) {
      lastSetOpIndex = i;
      lastSetOpLength = "EXCEPT ALL".length;
      lastSetOpAll = true;
      lastOperator = "EXCEPT";
      continue;
    }
    if (rest.startsWith("UNION") && (rest.length === "UNION".length || /\s/.test(rest["UNION".length]!))) {
      lastSetOpIndex = i;
      lastSetOpLength = "UNION".length;
      lastSetOpAll = false;
      lastOperator = "UNION";
      continue;
    }
    if (rest.startsWith("INTERSECT") && (rest.length === "INTERSECT".length || /\s/.test(rest["INTERSECT".length]!))) {
      lastSetOpIndex = i;
      lastSetOpLength = "INTERSECT".length;
      lastSetOpAll = false;
      lastOperator = "INTERSECT";
      continue;
    }
    if (rest.startsWith("EXCEPT") && (rest.length === "EXCEPT".length || /\s/.test(rest["EXCEPT".length]!))) {
      lastSetOpIndex = i;
      lastSetOpLength = "EXCEPT".length;
      lastSetOpAll = false;
      lastOperator = "EXCEPT";
    }
  }

  if (lastSetOpIndex === null) return null;
  return {
    operator: lastOperator,
    leftSql: sql.slice(0, lastSetOpIndex).trim(),
    rightSql: sql.slice(lastSetOpIndex + lastSetOpLength).trim(),
    all: lastSetOpAll,
  };
}

const NESTED_TRANSACTION_POLICY = "error_on_nested_begin" as const;

function parseTransactionStatement(base: string, rawSql: string): TransactionStatementAst | null {
  const normalized = base.replace(/;\s*$/, "").trim();
  if (!normalized) return null;

  if (/^BEGIN(?:\s+(WORK|TRANSACTION))?$/i.test(normalized)) {
    return {
      kind: "transaction",
      action: "BEGIN",
      nestedTransactionPolicy: NESTED_TRANSACTION_POLICY,
      rawSql,
    };
  }

  if (/^COMMIT(?:\s+WORK)?$/i.test(normalized)) {
    return {
      kind: "transaction",
      action: "COMMIT",
      nestedTransactionPolicy: NESTED_TRANSACTION_POLICY,
      rawSql,
    };
  }

  if (/^ROLLBACK(?:\s+WORK)?$/i.test(normalized)) {
    return {
      kind: "transaction",
      action: "ROLLBACK",
      nestedTransactionPolicy: NESTED_TRANSACTION_POLICY,
      rawSql,
    };
  }

  const firstToken = normalized.split(/\s+/)[0]?.toUpperCase();
  if (firstToken !== "BEGIN" && firstToken !== "COMMIT" && firstToken !== "ROLLBACK") {
    return null;
  }

  if (firstToken === "BEGIN") {
    throw createSqlError("SQL_DIALECT_UNSUPPORTED_SYNTAX", {
      message:
        "BEGIN only supports optional WORK or TRANSACTION in parser baseline; nested transactions must error (policy=error_on_nested_begin)",
      token: "BEGIN",
      hint: "nestedPolicy=error_on_nested_begin",
    });
  }

  throw createSqlError("SQL_DIALECT_UNSUPPORTED_SYNTAX", {
    message: `${firstToken} only supports optional WORK in parser baseline`,
    token: firstToken,
  });
}

function parseCreateIndexStatement(base: string, rawSql: string): CreateIndexStatementAst | null {
  const normalized = base.replace(/;\s*$/, "").trim();
  if (!/^CREATE\s+/i.test(normalized)) return null;

  const match = normalized.match(
    /^CREATE\s+(UNIQUE\s+)?INDEX\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+ON\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]+)\)$/i,
  );

  if (!match) {
    if (/^CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(normalized)) {
      throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
        message: "CREATE INDEX requires syntax: CREATE [UNIQUE] INDEX <name> ON <table>(<col,...>)",
        token: "INDEX",
      });
    }
    return null;
  }

  const columns = splitCommaAware(match[4]!).map((c) => c.trim()).filter(Boolean);
  if (columns.length === 0 || columns.some((c) => !/^[a-zA-Z_][a-zA-Z0-9_\.]*$/.test(c))) {
    throw createSqlError("SQL_SYNTAX_UNEXPECTED_TOKEN", {
      message: "CREATE INDEX column list must contain valid identifiers",
      token: match[4]!.trim(),
    });
  }

  return {
    kind: "create_index",
    unique: !!match[1],
    indexName: match[2]!,
    tableName: match[3]!,
    columns,
    rawSql,
  };
}

function parseDropIndexStatement(base: string, rawSql: string): DropIndexStatementAst | null {
  const normalized = base.replace(/;\s*$/, "").trim();
  if (!/^DROP\s+/i.test(normalized)) return null;

  const match = normalized.match(
    /^DROP\s+INDEX\s+(IF\s+EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+ON\s+([a-zA-Z_][a-zA-Z0-9_]*))?$/i,
  );

  if (!match) {
    if (/^DROP\s+INDEX\b/i.test(normalized)) {
      throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
        message: "DROP INDEX requires syntax: DROP INDEX [IF EXISTS] <name> [ON <table>]",
        token: "INDEX",
      });
    }
    return null;
  }

  return {
    kind: "drop_index",
    ifExists: !!match[1],
    indexName: match[2]!,
    tableName: match[3]?.trim() || undefined,
    rawSql,
  };
}

function parseCreateViewStatement(
  base: string,
  rawSql: string,
  dialect: SqlDialectProfile,
): CreateViewStatementAst | null {
  const normalized = base.replace(/;\s*$/, "").trim();
  if (!/^CREATE\s+/i.test(normalized)) return null;

  const match = normalized.match(/^CREATE\s+VIEW\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+AS\s+(.+)$/i);

  if (!match) {
    if (/^CREATE\s+VIEW\b/i.test(normalized)) {
      throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
        message: "CREATE VIEW requires syntax: CREATE VIEW <name> AS <select-query>",
        token: "VIEW",
      });
    }
    return null;
  }

  const querySql = match[2]!.trim();
  if (!/^SELECT\b/i.test(querySql)) {
    throw createSqlError("SQL_SYNTAX_UNEXPECTED_TOKEN", {
      message: "CREATE VIEW currently requires a SELECT-based query after AS",
      token: querySql.split(/\s+/)[0] ?? querySql,
    });
  }

  const queryAst = parseSqlToAst(querySql, { dialect });
  if (queryAst.kind !== "select" && queryAst.kind !== "union" && queryAst.kind !== "intersect" && queryAst.kind !== "except") {
    throw createSqlError("SQL_SYNTAX_UNEXPECTED_TOKEN", {
      message: "CREATE VIEW query must be a SELECT/UNION/INTERSECT/EXCEPT statement",
      token: querySql.split(/\s+/)[0] ?? querySql,
    });
  }

  return {
    kind: "create_view",
    viewName: match[1]!,
    querySql,
    rawSql,
  };
}

function parseDropViewStatement(base: string, rawSql: string): DropViewStatementAst | null {
  const normalized = base.replace(/;\s*$/, "").trim();
  if (!/^DROP\s+/i.test(normalized)) return null;

  const match = normalized.match(/^DROP\s+VIEW\s+(IF\s+EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)$/i);

  if (!match) {
    if (/^DROP\s+VIEW\b/i.test(normalized)) {
      throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
        message: "DROP VIEW requires syntax: DROP VIEW [IF EXISTS] <name>",
        token: "VIEW",
      });
    }
    return null;
  }

  return {
    kind: "drop_view",
    ifExists: !!match[1],
    viewName: match[2]!,
    rawSql,
  };
}

export type ParseSqlToAstOptions = {
  dialect?: SqlDialectProfile;
};

export type ParseSqlToAstResult = {
  ast: SqlAstStatement;
  grammar: SqlGrammarSkeleton;
};

export function parseSqlToAstWithMeta(sql: string, options?: ParseSqlToAstOptions): ParseSqlToAstResult {
  const dialect = options?.dialect ?? "ansi";
  const normalizedForDialect = normalizeDialectQuotedIdentifiers(sql, dialect);
  const grammar = inspectSqlGrammarSkeleton(normalizedForDialect, { dialect });
  const ast = parseSqlToAst(sql, { grammar, dialect });
  return { ast, grammar };
}

export function parseSqlToAst(
  sql: string,
  precomputedOrOptions?: SqlGrammarSkeleton | ParseSqlToAstOptions | { grammar?: SqlGrammarSkeleton; dialect?: SqlDialectProfile },
): SqlAstStatement {
  const dialect =
    (precomputedOrOptions && "dialect" in precomputedOrOptions ? precomputedOrOptions.dialect : undefined) ?? "ansi";
  const precomputedSkeleton =
    precomputedOrOptions && "clauses" in precomputedOrOptions
      ? precomputedOrOptions
      : precomputedOrOptions && "grammar" in precomputedOrOptions
        ? precomputedOrOptions.grammar
        : undefined;

  const skeleton = precomputedSkeleton ?? inspectSqlGrammarSkeleton(sql, { dialect });
  if (skeleton.unsupported.length > 0) {
    const first = skeleton.unsupported[0]!;
    throw createSqlError(first.code, {
      message: first.message,
      hint: `feature=${first.feature}`,
      token: first.feature,
    });
  }

  const normalized = normalizeDialectQuotedIdentifiers(sql, dialect).trim().replace(/\s+/g, " ");
  const unsupportedCastType = detectUnsupportedDialectCastType(normalized, dialect);
  if (unsupportedCastType) {
    throw createSqlError("SQL_DIALECT_UNSUPPORTED_SYNTAX", {
      message: `CAST target type ${unsupportedCastType} is not enabled for current dialect profile`,
      token: unsupportedCastType,
      dialect,
    });
  }

  const unsupportedOp = detectUnsupportedDialectOperator(normalized, dialect);
  if (unsupportedOp) {
    throw createSqlError("SQL_DIALECT_UNSUPPORTED_OPERATOR", {
      message: `Operator ${unsupportedOp} is not enabled for current dialect profile`,
      token: unsupportedOp,
      dialect,
    });
  }

  const unsupportedFn = detectUnsupportedDialectFunction(normalized, dialect);
  if (unsupportedFn) {
    throw createSqlError("SQL_DIALECT_UNSUPPORTED_FUNCTION", {
      message: `Function ${unsupportedFn} is not enabled for current dialect profile`,
      token: unsupportedFn,
      dialect,
    });
  }

  const explain = /^EXPLAIN\s+/i.test(normalized);
  const base = explain ? normalized.replace(/^EXPLAIN\s+/i, "") : normalized;

  const setOp = splitSetOpTopLevel(base);
  if (setOp) {
    if (!setOp.leftSql || !setOp.rightSql) {
      throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
        message: `${setOp.operator} requires both left and right SELECT statements`,
        token: setOp.operator,
      });
    }

    if (/^(ORDER|LIMIT|OFFSET|GROUP\s+BY|HAVING|WHERE|UNION|INTERSECT|EXCEPT)\b/i.test(setOp.rightSql)) {
      throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
        message: `${setOp.operator} right branch is missing SELECT statement`,
        token: setOp.operator,
      });
    }

    return {
      kind: setOp.operator === "UNION" ? "union" : setOp.operator === "INTERSECT" ? "intersect" : "except",
      all: setOp.all,
      leftSql: setOp.leftSql,
      rightSql: setOp.rightSql,
      rawSql: sql,
    };
  }

  const transaction = parseTransactionStatement(base, sql);
  if (transaction) return transaction;

  const createIndex = parseCreateIndexStatement(base, sql);
  if (createIndex) return createIndex;

  const dropIndex = parseDropIndexStatement(base, sql);
  if (dropIndex) return dropIndex;

  const createView = parseCreateViewStatement(base, sql, dialect);
  if (createView) return createView;

  const dropView = parseDropViewStatement(base, sql);
  if (dropView) return dropView;

  const selectLike = /^SELECT\b/i.test(base);
  if (!selectLike) {
    throw createSqlError("SQL_DIALECT_UNSUPPORTED_SYNTAX", {
      message:
        "Only SELECT/UNION/INTERSECT/EXCEPT/BEGIN/COMMIT/ROLLBACK/CREATE INDEX/DROP INDEX/CREATE VIEW/DROP VIEW statements are currently accepted by parser baseline",
      token: base.split(/\s+/)[0],
    });
  }

  const fromParsed = parseFromRef(base);
  if (!fromParsed) {
    throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
      message: "SELECT statement is missing or has invalid FROM clause",
      token: "FROM",
    });
  }

  const m = base.match(/^SELECT\s+(.+?)\s+FROM\s+/i);
  if (!m) {
    throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
      message: "SELECT list is missing or malformed before FROM",
      token: "SELECT",
    });
  }

  let selectFields = m[1]!.trim();
  let topLimit: number | undefined;

  const topMatch = selectFields.match(/^TOP\s+(\d+)\s+(.+)$/i);
  if (/^TOP\b/i.test(selectFields)) {
    if (dialect !== "sqlserver") {
      throw createSqlError("SQL_DIALECT_UNSUPPORTED_SYNTAX", {
        message: "TOP is only enabled for sqlserver dialect profile",
        token: "TOP",
        dialect,
      });
    }
    if (!topMatch) {
      throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
        message: "TOP requires numeric count before select list",
        token: "TOP",
      });
    }
    topLimit = Number(topMatch[1]);
    selectFields = topMatch[2]!.trim();
  }
  const { from, tail } = fromParsed;

  const { joins, rest } = parseJoinChain(tail);
  const hasFetchToken = /\bFETCH\b/i.test(rest);
  if (hasFetchToken && !(dialect === "postgres" || dialect === "mysql" || dialect === "sqlserver")) {
    throw createSqlError("SQL_DIALECT_UNSUPPORTED_SYNTAX", {
      message: "FETCH FIRST/NEXT is not enabled for current dialect profile",
      token: "FETCH",
      dialect,
    });
  }

  const tm = rest.match(
    /^(?:\s*WHERE\s+(.+?))?(?:\s*GROUP BY\s+(.+?))?(?:\s*HAVING\s+(.+?))?(?:\s*ORDER BY\s+(.+?))?(?:\s*LIMIT\s+(\d+))?(?:\s*OFFSET\s+(\d+))?(?:\s*FETCH\s+(FIRST|NEXT)\s+(\d+)\s+ROWS?\s+ONLY)?\s*$/i,
  );
  if (!tm) {
    if (hasFetchToken) {
      throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
        message: "FETCH clause must be: FETCH FIRST|NEXT <n> ROW(S) ONLY",
        token: "FETCH",
      });
    }
    throw createSqlError("SQL_SYNTAX_INVALID_CLAUSE_ORDER", {
      message: "Invalid clause order or unsupported trailing syntax after FROM/JOIN segment",
      hint: "Expected order: WHERE -> GROUP BY -> HAVING -> ORDER BY -> LIMIT -> OFFSET",
    });
  }

  const where = tm[1]?.trim();
  const groupBy = tm[2]?.trim();
  const having = tm[3]?.trim();
  const orderBy = tm[4]?.trim();
  const limitFromLimit = tm[5] ? Number(tm[5]) : undefined;
  const offset = tm[6] ? Number(tm[6]) : undefined;
  const limitFromFetch = tm[8] ? Number(tm[8]) : undefined;

  if (orderBy && /\bWHERE\b/i.test(orderBy)) {
    throw createSqlError("SQL_SYNTAX_INVALID_CLAUSE_ORDER", {
      message: "WHERE cannot appear after ORDER BY",
      hint: "Expected order: WHERE -> GROUP BY -> HAVING -> ORDER BY -> LIMIT -> OFFSET",
    });
  }

  if (hasFetchToken && !tm[8]) {
    throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
      message: "FETCH clause must be: FETCH FIRST|NEXT <n> ROW(S) ONLY",
      token: "FETCH",
    });
  }

  const rowLimiterCount = [topLimit, limitFromLimit, limitFromFetch].filter((v) => v !== undefined).length;
  if (rowLimiterCount > 1) {
    throw createSqlError("SQL_SYNTAX_INVALID_CLAUSE_ORDER", {
      message: "Multiple row-limiting clauses are not allowed together (TOP/LIMIT/FETCH)",
      hint: "Use only one of TOP, LIMIT, or FETCH",
    });
  }

  if (dialect === "sqlserver") {
    if (limitFromLimit !== undefined) {
      throw createSqlError("SQL_DIALECT_UNSUPPORTED_SYNTAX", {
        message: "LIMIT is not enabled for sqlserver dialect profile; use TOP or OFFSET/FETCH",
        token: "LIMIT",
        dialect,
      });
    }

    if (offset !== undefined && !orderBy) {
      throw createSqlError("SQL_SYNTAX_INVALID_CLAUSE_ORDER", {
        message: "SQL Server OFFSET requires ORDER BY",
        token: "OFFSET",
        hint: "Use ORDER BY ... OFFSET n ROWS [FETCH NEXT m ROWS ONLY]",
      });
    }

    if (limitFromFetch !== undefined && !orderBy) {
      throw createSqlError("SQL_SYNTAX_INVALID_CLAUSE_ORDER", {
        message: "SQL Server FETCH requires ORDER BY",
        token: "FETCH",
        hint: "Use ORDER BY ... OFFSET n ROWS FETCH NEXT m ROWS ONLY",
      });
    }

    if (limitFromFetch !== undefined && offset === undefined) {
      throw createSqlError("SQL_SYNTAX_INVALID_CLAUSE_ORDER", {
        message: "SQL Server FETCH requires OFFSET",
        token: "FETCH",
        hint: "Use OFFSET n ROWS FETCH NEXT m ROWS ONLY",
      });
    }
  }

  const limit = topLimit ?? limitFromLimit ?? limitFromFetch;

  const ast: SelectStatementAst = {
    kind: "select",
    explain,
    from,
    selectItems: parseSelectItems(selectFields),
    where: where ? parseExpr(where) : undefined,
    whereText: where,
    groupBy: groupBy ? splitCommaAware(groupBy).map(parseExpr) : undefined,
    having: having ? parseExpr(having) : undefined,
    havingText: having,
    orderBy: parseOrderItems(orderBy),
    limit,
    offset,
    join: joins[0],
    joins: joins.length ? joins : undefined,
    rawSql: sql,
  };

  return ast;
}
