import { createSqlError } from "./sql-errors.js";
import { inspectSqlGrammarSkeleton, type SqlDialectProfile, type SqlGrammarSkeleton } from "./sql-grammar-skeleton.js";
import type {
  CreateIndexStatementAst,
  CreateSchemaStatementAst,
  CreateFunctionStatementAst,
  CreateTriggerStatementAst,
  CreateViewStatementAst,
  CreateDomainStatementAst,
  DropDomainStatementAst,
  CreateAssertionStatementAst,
  DropAssertionStatementAst,
  DropIndexStatementAst,
  DropTableStatementAst,
  DropViewStatementAst,
  ExprAst,
  InsertStatementAst,
  UpdateStatementAst,
  DeleteStatementAst,
  TruncateTableStatementAst,
  AlterTableStatementAst,
  AlterTableAction,
  CreateTableStatementAst,
  GrantStatementAst,
  PrivilegeKind,
  RevokeStatementAst,
  JoinAst,
  OrderItemAst,
  SelectItemAst,
  SelectStatementAst,
  SqlAstStatement,
  TransactionStatementAst,
  SavepointStatementAst,
  RollbackToSavepointStatementAst,
  ReleaseSavepointStatementAst,
  TableRefAst,
  WindowFunctionAst,
  WindowFrameAst,
  WindowFrameBound,
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

  const hasPostgresRegexOp = /!~\*|!~|~\*/.test(sql);
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

  if (hasBacktickQuoted && dialect !== "mysql" && dialect !== "sqlite") {
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
  if (dialect === "mysql" || dialect === "sqlite") {
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

  peek2(): string | undefined {
    return this.tokens[this.i + 1];
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
    // Check for subquery expressions: (SELECT ...), (EXISTS ...), (NOT EXISTS ...), (IN ...), etc.
    const peeked = ts.peek();
    if (peeked) {
      const peekUpper = peeked.toUpperCase();
      // Scalar subquery: (SELECT ...)
      if (peekUpper === "SELECT") {
        const subqueryTokens: string[] = [];
        let depth = 1;
        while (!ts.eof() && depth > 0) {
          const tok = ts.peek();
          if (!tok) break;
          if (tok === "(") {
            depth++;
            subqueryTokens.push(ts.next()!);
          } else if (tok === ")") {
            depth--;
            if (depth > 0) {
              subqueryTokens.push(ts.next()!);
            } else {
              ts.next(); // consume the closing ')'
            }
          } else {
            subqueryTokens.push(ts.next()!);
          }
        }
        return { kind: "scalar_subquery", subquerySql: subqueryTokens.join(" ").trim() };
      }
    }
    const expr = parseOr(ts);
    ts.expect(")");
    return expr;
  }

  if (/^(null|true|false|\-?\d+(?:\.\d+)?)$/i.test(t) || /^'.*'$/.test(t) || /^".*"$/.test(t)) {
    return literalExpr(castLiteral(t));
  }

  // CASE WHEN ... THEN ... [ELSE ...] END (no parentheses)
  if (t.toUpperCase() === "CASE") {
    return parseCaseWhen(ts);
  }

  // EXISTS (SELECT ...) - subquery predicate
  if (t.toUpperCase() === "EXISTS") {
    ts.expect("(");
    const subqueryTokens: string[] = [];
    let depth = 1;
    while (!ts.eof() && depth > 0) {
      const tok = ts.peek();
      if (!tok) break;
      if (tok === "(") {
        depth++;
        subqueryTokens.push(ts.next()!);
      } else if (tok === ")") {
        depth--;
        if (depth > 0) {
          subqueryTokens.push(ts.next()!);
        } else {
          ts.next(); // consume the closing ')'
        }
      } else {
        subqueryTokens.push(ts.next()!);
      }
    }
    return { kind: "exists", negated: false, subquerySql: subqueryTokens.join(" ").trim() };
  }

  // NOT EXISTS (SELECT ...) - negated subquery predicate
  if (t.toUpperCase() === "NOT") {
    if (ts.peek()?.toUpperCase() === "EXISTS") {
      ts.next(); // consume EXISTS
      ts.expect("(");
      const subqueryTokens: string[] = [];
      let depth = 1;
      while (!ts.eof() && depth > 0) {
        const tok = ts.peek();
        if (!tok) break;
        if (tok === "(") {
          depth++;
          subqueryTokens.push(ts.next()!);
        } else if (tok === ")") {
          depth--;
          if (depth > 0) {
            subqueryTokens.push(ts.next()!);
          } else {
            ts.next(); // consume the closing ')'
          }
        } else {
          subqueryTokens.push(ts.next()!);
        }
      }
      return { kind: "exists", negated: true, subquerySql: subqueryTokens.join(" ").trim() };
    }
    // NOT alone - fall through to identifier/function handling
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

    if (fn === "GROUP_CONCAT") {
      // GROUP_CONCAT(expr [SEPARATOR 's'])
      // SEPARATOR is a keyword, not a regular argument — handle specially
      const args2: ExprAst[] = [];
      let separatorVal: string | undefined;
      while (!ts.eof()) {
        const tok = ts.peek();
        if (!tok) break;
        // Check for SEPARATOR keyword (may appear at top level or after comma)
        if (tok.toUpperCase() === "SEPARATOR") {
          ts.next(); // consume SEPARATOR
          const sepTok = ts.next(); // consume the string literal
          if (sepTok && /^'.*'$/.test(sepTok)) {
            separatorVal = castLiteral(sepTok) as string;
          } else if (sepTok && /^".*"$/.test(sepTok)) {
            separatorVal = castLiteral(sepTok) as string;
          }
          break;
        }
        const argExpr = parseOr(ts);
        // Check if this is a bare SEPARATOR expression (case like: GROUP_CONCAT val SEPARATOR 'x')
        if (argExpr.kind === "identifier" && argExpr.name.toUpperCase() === "SEPARATOR") {
          const sepTok = ts.next();
          if (sepTok && /^'.*'$/.test(sepTok)) {
            separatorVal = castLiteral(sepTok) as string;
          } else if (sepTok && /^".*"$/.test(sepTok)) {
            separatorVal = castLiteral(sepTok) as string;
          }
          break;
        }
        args2.push(argExpr);
        if (ts.peek() === ",") {
          ts.next(); // consume comma
          // Check if next token is SEPARATOR (handle: GROUP_CONCAT(expr, SEPARATOR 's'))
          if (ts.peek()?.toUpperCase() === "SEPARATOR") {
            ts.next(); // consume SEPARATOR
            const sepTok = ts.next();
            if (sepTok && /^'.*'$/.test(sepTok)) {
              separatorVal = castLiteral(sepTok) as string;
            } else if (sepTok && /^".*"$/.test(sepTok)) {
              separatorVal = castLiteral(sepTok) as string;
            }
            break;
          }
          continue;
        }
        break;
      }
      ts.expect(")");
      if (separatorVal !== undefined) {
        // args[0] = expr, args[1] = separator literal
        return { kind: "function", name: fn, args: [...args2, literalExpr(separatorVal)] };
      }
      return { kind: "function", name: fn, args: args2 };
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
    const funcExpr: ExprAst = { kind: "function", name: fn, args };

    // Handle FILTER (WHERE ...) clause for aggregate functions
    if (ts.peek()?.toUpperCase() === "FILTER") {
      ts.next(); // FILTER
      ts.expect("(");
      if (ts.peek()?.toUpperCase() !== "WHERE") {
        throw new Error("expected WHERE after FILTER");
      }
      ts.next(); // WHERE
      const filterExpr = parseOr(ts);
      ts.expect(")");
      funcExpr.filter = filterExpr;
    }

    return funcExpr;
  }

  if (isIdentifierToken(t)) {
    // Check for qualified identifier: table.column or table.*
    if (ts.peek() === ".") {
      ts.next(); // consume '.'
      const afterDot = ts.peek();
      if (afterDot === "*") {
        ts.next(); // consume '*'
        return { kind: "qualified_wildcard", table: t };
      }
      if (afterDot && isIdentifierToken(afterDot)) {
        ts.next(); // consume column identifier
        return { kind: "qualified_identifier", table: t, column: afterDot };
      }
      // '.' followed by non-identifier, treat '.' as raw
      return { kind: "raw", text: `${t}.${afterDot ?? ""}` };
    }
    return { kind: "identifier", name: t };
  }

  // Handle wildcard: *
  if (t === "*") {
    return { kind: "wildcard" };
  }

  return { kind: "raw", text: t };
}

function parsePostfix(ts: TokenStream): ExprAst {
  let expr = parsePrimary(ts);
  while (true) {
    if (ts.match("COLLATE")) {
      const collationTok = ts.next();
      if (collationTok) {
        expr = { kind: "collate", expr, collation: collationTok };
      }
    } else {
      break;
    }
  }
  return expr;
}

function parseUnary(ts: TokenStream): ExprAst {
  if (ts.match("-")) {
    return { kind: "unary", op: "-", expr: parseUnary(ts) };
  }
  if (ts.match("+")) {
    return { kind: "unary", op: "+", expr: parseUnary(ts) };
  }
  if (ts.match("~")) {
    return { kind: "unary", op: "~", expr: parseUnary(ts) };
  }
  return parsePostfix(ts);
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

/** Collect tokens until the matching closing parenthesis, handling nested parens */
function collectUntilClosingParen(ts: TokenStream): string {
  const tokens: string[] = [];
  let depth = 1;
  while (!ts.eof() && depth > 0) {
    const tok = ts.peek();
    if (!tok) break;
    if (tok === "(") {
      depth++;
      tokens.push(ts.next()!);
    } else if (tok === ")") {
      depth--;
      if (depth > 0) {
        tokens.push(ts.next()!);
      } else {
        ts.next(); // consume closing ')'
      }
    } else {
      tokens.push(ts.next()!);
    }
  }
  return tokens.join(" ").trim();
}

function parseBitwiseOr(ts: TokenStream): ExprAst {
  let left = parseBitwiseAnd(ts);
  while (true) {
    const op = ts.peek();
    if (!op || !["|", "^"].includes(op)) break;
    ts.next();
    const right = parseBitwiseAnd(ts);
    left = { kind: "binary", op, left, right };
  }
  return left;
}

function parseBitwiseAnd(ts: TokenStream): ExprAst {
  let left = parseAdd(ts);
  while (true) {
    if (ts.match("&")) {
      const right = parseAdd(ts);
      left = { kind: "binary", op: "&", left, right };
    } else {
      break;
    }
  }
  return left;
}

function parseConcat(ts: TokenStream): ExprAst {
  let left = parseBitwiseOr(ts);
  while (true) {
    if (ts.match("||")) {
      const right = parseBitwiseOr(ts);
      left = { kind: "binary", op: "||", left, right };
    } else {
      break;
    }
  }
  return left;
}

function parseCompare(ts: TokenStream): ExprAst {
  let left = parseConcat(ts);

  if (ts.match("IS")) {
    if (ts.match("NOT")) {
      if (ts.match("NULL")) return { kind: "binary", op: "IS NOT", left, right: literalExpr(null) };
      const right = parseConcat(ts);
      return { kind: "binary", op: "IS NOT", left, right };
    }
    if (ts.match("NULL")) return { kind: "binary", op: "IS", left, right: literalExpr(null) };
    const right = parseConcat(ts);
    return { kind: "binary", op: "IS", left, right };
  }

  if (ts.match("NOT")) {
    if (ts.match("IN")) {
      ts.expect("(");
      // Check for subquery: IN (SELECT ...)
      if (ts.peek()?.toUpperCase() === "SELECT") {
        const subquerySql = collectUntilClosingParen(ts);
        return { kind: "in_subquery", negated: true, expr: left, subquerySql };
      }
      const vals: ExprAst[] = [];
      while (ts.peek() && ts.peek() !== ")") {
        vals.push(parseOr(ts));
        if (ts.peek() === ",") ts.next();
      }
      ts.expect(")");
      return { kind: "binary", op: "NOT IN", left, right: { kind: "function", name: "LIST", args: vals } };
    }
    if (ts.match("BETWEEN")) {
      const a = parseConcat(ts);
      ts.expect("AND");
      const b = parseConcat(ts);
      return { kind: "binary", op: "NOT BETWEEN", left, right: { kind: "function", name: "RANGE", args: [a, b] } };
    }
    if (ts.match("LIKE")) {
      const pat = parseConcat(ts);
      return { kind: "binary", op: "NOT LIKE", left, right: pat };
    }
  }

  if (ts.match("IN")) {
    ts.expect("(");
    // Check for subquery: IN (SELECT ...)
    if (ts.peek()?.toUpperCase() === "SELECT") {
      const subquerySql = collectUntilClosingParen(ts);
      return { kind: "in_subquery", negated: false, expr: left, subquerySql };
    }
    const vals: ExprAst[] = [];
    while (ts.peek() && ts.peek() !== ")") {
      vals.push(parseOr(ts));
      if (ts.peek() === ",") ts.next();
    }
    ts.expect(")");
    return { kind: "binary", op: "IN", left, right: { kind: "function", name: "LIST", args: vals } };
  }

  if (ts.match("BETWEEN")) {
    const a = parseConcat(ts);
    ts.expect("AND");
    const b = parseConcat(ts);
    return { kind: "binary", op: "BETWEEN", left, right: { kind: "function", name: "RANGE", args: [a, b] } };
  }

  if (ts.match("LIKE")) {
    const pat = parseConcat(ts);
    let escape: ExprAst | undefined;
    if (ts.match("ESCAPE")) {
      escape = parseConcat(ts);
    }
    const binary: ExprAst = { kind: "binary", op: "LIKE", left, right: pat };
    if (escape) binary.escape = escape;
    return binary;
  }

  const op = ts.peek();
  if (op && ["=", "!=", "<>", ">", "<", ">=", "<="].includes(op)) {
    ts.next();
    // Check for scalar subquery: = (SELECT ...), > (SELECT ...), etc.
    if (ts.peek() === "(" && ts.peek2()?.toUpperCase() === "SELECT") {
      ts.next(); // consume '('
      const subquerySql = collectUntilClosingParen(ts);
      // Return a binary expression with scalar subquery as the right operand
      return { kind: "binary", op, left, right: { kind: "scalar_subquery", subquerySql } };
    }
    // Check for ANY/SOME/ALL: = ANY (SELECT ...), > ALL (SELECT ...), etc.
    const quantifier = ts.peek();
    if (quantifier && ["ANY", "SOME", "ALL"].includes(quantifier.toUpperCase())) {
      ts.next(); // consume ANY/SOME/ALL
      ts.expect("(");
      if (ts.peek()?.toUpperCase() === "SELECT") {
        const subquerySql = collectUntilClosingParen(ts);
        return { kind: "any_subquery", op, left, quantifier: quantifier.toUpperCase() as "ANY" | "SOME" | "ALL", subquerySql };
      }
      // ANY/SOME/ALL not followed by SELECT - fall back to identifier
      const right = parseConcat(ts);
      return { kind: "binary", op, left, right };
    }
    const right = parseConcat(ts);
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

  // Parse subquery predicates into dedicated AST nodes
  const subqueryResult = tryParseSubqueryExpr(s);
  if (subqueryResult) return subqueryResult;

  // Handle GROUP_CONCAT with SEPARATOR specially (SEPARATOR is a keyword, not an identifier)
  // e.g., GROUP_CONCAT(val SEPARATOR '|') — SEPARATOR is a top-level keyword here
  if (/^\s*GROUP_CONCAT\s*\([^)]+\s+SEPARATOR\s+/i.test(s)) {
    return parseGroupConcatWithSeparator(s);
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

/**
 * Try to parse subquery expressions into proper AST nodes.
 * Returns null if the input is not a subquery expression.
 * Note: IN (SELECT ...) is handled in parseCompare where we have left-expression context.
 *       ANY/SOME/ALL (SELECT ...) is also handled in parseCompare.
 *       Scalar subquery (SELECT ...) is handled in parsePrimary.
 */
function tryParseSubqueryExpr(s: string): ExprAst | null {
  // EXISTS [NOT] (SELECT ...) - handled at expression level since EXISTS is a prefix operator
  const existsMatch = s.match(/^(NOT\s+)?EXISTS\s*\(\s*(SELECT[\s\S]+)\s*\)$/i);
  if (existsMatch) {
    return { kind: "exists", negated: !!existsMatch[1], subquerySql: existsMatch[2]!.trim() };
  }

  // Scalar subquery at top level: (SELECT ...) - this is already handled in parsePrimary
  // but we keep it here as a fallback for cases where it appears at expression top level
  const scalarMatch = s.match(/^\(\s*SELECT[\s\S]+\)\s*$/i);
  if (scalarMatch) {
    return { kind: "scalar_subquery", subquerySql: s.trim() };
  }

  return null;
}

function parseGroupConcatWithSeparator(input: string): ExprAst {
  // Parse: GROUP_CONCAT(expr [SEPARATOR 's'])
  // Strip outer parens if present
  const trimmed = input.trim();
  const match = trimmed.match(/^GROUP_CONCAT\s*\(\s*(.+?)\s*\)\s*$/i);
  if (!match) return { kind: "raw", text: input };

  const inner = match[1]!;

  // Find SEPARATOR at top level (not inside nested parens or quotes)
  let sepIdx = -1;
  let quote = "";
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if ((ch === "'" || ch === '"') && (i === 0 || inner[i - 1] !== "\\")) {
      quote = quote === ch ? "" : ch;
    } else if (!quote && ch === "(") {
      depth++;
    } else if (!quote && ch === ")") {
      depth = Math.max(0, depth - 1);
    } else if (!quote && depth === 0 && inner.substring(i, i + 9).toUpperCase() === "SEPARATOR") {
      sepIdx = i;
      break;
    }
  }

  let separatorVal = ",";
  let exprStr = inner;
  if (sepIdx >= 0) {
    exprStr = inner.substring(0, sepIdx).trim();
    // Strip any trailing comma from exprStr — comma precedes SEPARATOR and is not part of the expression
    exprStr = exprStr.replace(/,\s*$/, "");
    const sepPart = inner.substring(sepIdx + 9).trim(); // skip "SEPARATOR"
    const sepMatch = sepPart.match(/^['"](.*?)['"]/);
    if (sepMatch) {
      separatorVal = sepMatch[1]!;
    }
  }

  const expr = parseExpr(exprStr);
  const args: ExprAst[] = [expr, { kind: "literal", typedValue: fromLiteral(separatorVal) }];
  return { kind: "function", name: "GROUP_CONCAT", args };
}

function findTopLevelKeywordIndex(input: string, keyword: string): number {
  const upperKeyword = keyword.toUpperCase();
  let quote = "";
  let depth = 0;

  for (let i = 0; i <= input.length - upperKeyword.length; i++) {
    const ch = input[i]!;
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

    if (input.slice(i, i + upperKeyword.length).toUpperCase() !== upperKeyword) continue;
    const prev = input[i - 1];
    const next = input[i + upperKeyword.length];
    const prevBoundary = !prev || /[\s,(]/.test(prev);
    const nextBoundary = !next || /[\s),]/.test(next);
    if (prevBoundary && nextBoundary) return i;
  }

  return -1;
}

function parseWindowOverDefinition(rawOver: string): WindowFunctionAst["over"] {
  const overText = rawOver.trim();
  if (!overText) {
    throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
      message: "OVER clause requires PARTITION BY and/or ORDER BY definition",
      token: "OVER",
    });
  }

  let partitionByText: string | undefined;
  let orderByText: string | undefined;
  let frameText: string | undefined;

  if (/^PARTITION\s+BY\s+/i.test(overText)) {
    const rest = overText.replace(/^PARTITION\s+BY\s+/i, "").trim();
    const rowsIndex = findTopLevelKeywordIndex(rest, "ROWS");
    const orderByIndex = findTopLevelKeywordIndex(rest, "ORDER BY");
    if (orderByIndex >= 0 && rowsIndex >= 0) {
      if (orderByIndex < rowsIndex) {
        partitionByText = rest.slice(0, orderByIndex).trim();
        const afterOrderBy = rest.slice(orderByIndex + "ORDER BY".length).trim();
        const rowsFrameIdx = findTopLevelKeywordIndex(afterOrderBy, "ROWS");
        if (rowsFrameIdx >= 0) {
          orderByText = afterOrderBy.slice(0, rowsFrameIdx).trim();
          frameText = afterOrderBy.slice(rowsFrameIdx).trim(); // includes "ROWS ..."
        } else {
          orderByText = afterOrderBy;
        }
      } else {
        partitionByText = rest.slice(0, rowsIndex).trim();
        frameText = rest.slice(rowsIndex).trim(); // includes "ROWS ..."
      }
    } else if (orderByIndex >= 0) {
      partitionByText = rest.slice(0, orderByIndex).trim();
      orderByText = rest.slice(orderByIndex + "ORDER BY".length).trim();
    } else if (rowsIndex >= 0) {
      partitionByText = rest.slice(0, rowsIndex).trim();
      frameText = rest.slice(rowsIndex).trim(); // includes "ROWS ..."
    } else {
      partitionByText = rest;
    }
  } else if (/^ORDER\s+BY\s+/i.test(overText)) {
    const rest = overText.replace(/^ORDER\s+BY\s+/i, "").trim();
    const rowsIndex = findTopLevelKeywordIndex(rest, "ROWS");
    if (rowsIndex >= 0) {
      orderByText = rest.slice(0, rowsIndex).trim();
      frameText = rest.slice(rowsIndex + "ROWS".length).trim();
    } else {
      orderByText = rest;
    }
  } else {
    throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
      message: "OVER clause must start with PARTITION BY or ORDER BY",
      token: "OVER",
      hint: "Use OVER (PARTITION BY ... ORDER BY ...) or OVER (ORDER BY ...)",
    });
  }

  if (partitionByText !== undefined && !partitionByText) {
    throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
      message: "PARTITION BY requires at least one expression",
      token: "PARTITION BY",
    });
  }

  if (orderByText !== undefined && !orderByText) {
    throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
      message: "ORDER BY requires at least one expression in OVER clause",
      token: "ORDER BY",
    });
  }

  const partitionBy = partitionByText
    ? splitCommaAware(partitionByText)
        .map((part) => part.trim())
        .filter(Boolean)
        .map(parseExpr)
    : [];
  const orderBy = orderByText ? (parseOrderItems(orderByText) ?? []) : [];

  if (!partitionBy.length && !orderBy.length) {
    throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
      message: "OVER clause requires PARTITION BY and/or ORDER BY definition",
      token: "OVER",
    });
  }

  const frame = frameText ? parseWindowFrame(frameText) : undefined;

  return { partitionBy, orderBy, ...(frame ? { frame } : {}) };
}

function parseWindowFrame(text: string): WindowFrameAst | undefined {
  const trimmed = text.trim();
  // Match GROUPS, RANGE, or ROWS between start and end bounds
  const m = trimmed.match(/^(GROUPS|RANGE|ROWS)\s+BETWEEN\s+(.+)\s+AND\s+(.+)$/i);
  if (!m) return undefined;
  const unit = m[1]!.toUpperCase() as "ROWS" | "GROUPS" | "RANGE";
  const startBound = parseWindowFrameBound(m[2]!.trim());
  const endBound = parseWindowFrameBound(m[3]!.trim());
  if (!startBound || !endBound) return undefined;
  return { unit, start: startBound, end: endBound };
}

function parseWindowFrameBound(text: string): WindowFrameBound | undefined {
  const upper = text.toUpperCase().trim();
  if (upper === "UNBOUNDED PRECEDING") return { kind: "unbounded_preceding" };
  if (upper === "UNBOUNDED FOLLOWING") return { kind: "unbounded_following" };
  if (upper === "CURRENT ROW") return { kind: "current_row" };
  const precedingMatch = text.match(/^(\d+)\s+PRECEDING$/i);
  if (precedingMatch) return { kind: "offset_preceding", offset: parseInt(precedingMatch[1]!, 10) };
  const followingMatch = text.match(/^(\d+)\s+FOLLOWING$/i);
  if (followingMatch) return { kind: "offset_following", offset: parseInt(followingMatch[1]!, 10) };
  // INTERVAL offset for RANGE: INTERVAL '1' DAY PRECEDING/FOLLOWING
  const intervalPrecedingMatch = text.match(/^INTERVAL\s+'([^']+)'\s+(YEAR|MONTH|DAY|HOUR|MINUTE|SECOND)\s+PRECEDING$/i);
  if (intervalPrecedingMatch) {
    return { kind: "offset_preceding_interval", value: Number(intervalPrecedingMatch[1]), unit: intervalPrecedingMatch[2]!.toUpperCase() };
  }
  const intervalFollowingMatch = text.match(/^INTERVAL\s+'([^']+)'\s+(YEAR|MONTH|DAY|HOUR|MINUTE|SECOND)\s+FOLLOWING$/i);
  if (intervalFollowingMatch) {
    return { kind: "offset_following_interval", value: Number(intervalFollowingMatch[1]), unit: intervalFollowingMatch[2]!.toUpperCase() };
  }
  return undefined;
}

function parseCaseWhen(ts: TokenStream): ExprAst {
  // Parse: CASE [expression] WHEN condition THEN result [WHEN ...] [ELSE result] END
  // If the next token after CASE is not WHEN, parse it as baseExpr
  let baseExpr: ExprAst | undefined;
  if (!ts.peek()?.toUpperCase().startsWith("WHEN")) {
    baseExpr = parseOr(ts);
  }

  const whenClauses: { condition: ExprAst; result: ExprAst }[] = [];
  let elseResult: ExprAst | undefined;

  while (true) {
    if (ts.match("WHEN")) {
      const condition = parseOr(ts);
      ts.expect("THEN");
      const result = parseOr(ts);
      whenClauses.push({ condition, result });
    } else if (ts.match("ELSE")) {
      elseResult = parseOr(ts);
      ts.expect("END");
      break;
    } else if (ts.match("END")) {
      break;
    } else {
      const next = ts.peek();
      throw new Error(`expected WHEN, ELSE, or END in CASE expression, got: ${next}`);
    }
  }
  return { kind: "case", baseExpr, whenClauses, elseResult };
}

function parseWindowFunction(exprText: string): WindowFunctionAst | undefined {
  const trimmed = exprText.trim();
  if (!/\bOVER\s*\(/i.test(trimmed)) return undefined;

  const m = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*)\)\s+OVER\s*\(([\s\S]*)\)$/i);
  if (!m) {
    // OVER detected but not perfectly matched - return undefined, caller will use parseExpr
    return undefined;
  }

  const fnName = m[1]!.toUpperCase();
  const argsText = m[2]!.trim();
  const overText = m[3]!;
  const args = argsText ? splitCommaAware(argsText).map(parseExpr) : [];
  const over = parseWindowOverDefinition(overText);

  return {
    kind: "window_function",
    name: fnName,
    args,
    over,
  };
}

function parseSelectItems(raw: string): SelectItemAst[] {
  return splitCommaAware(raw).map((item) => {
    const m = item.match(/^(.+?)\s+AS\s+([a-zA-Z_][a-zA-Z0-9_]*)$/i);
    if (m) {
      const exprText = m[1]!.trim();
      const window = parseWindowFunction(exprText);
      const expr = window
        ? ({ kind: "function", name: window.name, args: window.args } as ExprAst)
        : parseExpr(exprText);
      return { kind: "select_item", expr, alias: m[2]!, window };
    }
    const exprText = item.trim();
    const window = parseWindowFunction(exprText);
    const expr = window
      ? ({ kind: "function", name: window.name, args: window.args } as ExprAst)
      : parseExpr(exprText);
    return { kind: "select_item", expr, window };
  });
}

function parseOrderItems(raw?: string): OrderItemAst[] | undefined {
  if (!raw) return undefined;
  return splitCommaAware(raw).map((part) => {
    // Extended regex to capture NULLS FIRST/LAST
    const m = part.match(/^(.+?)(?:\s+(ASC|DESC))?(?:\s+NULLS\s+(FIRST|LAST))?$/i);
    const exprText = m?.[1] ?? part;
    // ORDER BY expressions cannot contain window functions - parse normally
    const expr = parseExpr(exprText);
    const direction = ((m?.[2] ?? "ASC").toUpperCase() as "ASC" | "DESC");
    const nullsPosition = m?.[3]?.toUpperCase() as "FIRST" | "LAST" | undefined;
    return { kind: "order_item", expr, direction, ...(nullsPosition ? { nullsPosition } : {}) };
  });
}

/**
 * Find the position of the FROM keyword at depth 0 (not inside parentheses).
 * This is needed to correctly parse SELECT statements with scalar subqueries
 * that contain their own FROM clause.
 */
function findFromAtDepthZero(sql: string): number | null {
  // Skip leading "SELECT " to get to the select list
  const selectMatch = sql.match(/^SELECT\s+/i);
  if (!selectMatch) return null;
  let pos = selectMatch[0]!.length;
  let depth = 0;
  while (pos < sql.length) {
    const ch = sql[pos]!;
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && sql.substring(pos).toUpperCase().startsWith("FROM ") &&
               /[\s]/.test(sql[pos - 1]!)) {
      // Found FROM at depth 0, preceded by whitespace
      return pos;
    }
    pos++;
  }
  return null;
}

function parseJoinChain(tail: string): { joins: JoinAst[]; rest: string } {
  const joins: JoinAst[] = [];
  let rest = tail;

  // SQL clause keywords that cannot be table aliases
  const clauseKeywords = new Set([
    "WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET", "FETCH",
    "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "JOIN", "UNION",
    "INTERSECT", "EXCEPT", "ON", "USING", "NATURAL",
  ]);

  while (true) {
    // Try comma-separated tables (implicit CROSS JOIN): , t2, t3
    // First match just comma and table name
    const commaTableMatch = rest.match(/^\s*,\s*([a-zA-Z_][a-zA-Z0-9_]*)/i);
    if (commaTableMatch) {
      joins.push({
        kind: "join",
        joinType: "CROSS",
        table: commaTableMatch[1]!,
        onLeft: "",
        onRight: "",
      });
      // Get remaining after table name - may include alias, comma, or clause keywords
      rest = rest.slice(commaTableMatch[0].length).trim();

      // Check if next token is an alias (not a clause keyword)
      const aliasMatch = rest.match(/^(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)/i);
      if (aliasMatch) {
        const word = aliasMatch[1].toUpperCase();
        if (!clauseKeywords.has(word)) {
          // Valid alias - consume it and continue
          rest = rest.slice(aliasMatch[0].length).trim();
        }
      }
      continue;
    }

    // Try NATURAL JOIN: NATURAL [LEFT|RIGHT|FULL|[OUTER]] JOIN table [AS alias]
    // Note: alias requires AS keyword to avoid misinterpreting keywords like ORDER as aliases
    const naturalRegex = /^\s*NATURAL\s+(LEFT|RIGHT|FULL|INNER)?\s*(?:OUTER\s+)?JOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+AS\s+([a-zA-Z_][a-zA-Z0-9_]*))?(.*)$/i;
    const naturalMatch = rest.match(naturalRegex);
    if (naturalMatch) {
      console.error("DEBUG NATURAL match found:", { input: rest.substring(0, 60), joinType: naturalMatch[1], table: naturalMatch[2], remainder: JSON.stringify(naturalMatch[4]) });
      rest = naturalMatch[4] ?? "";
      console.error("DEBUG NATURAL rest after:", JSON.stringify(rest));
      const joinType = ((naturalMatch[1] ?? "INNER").toUpperCase()) as "INNER" | "LEFT" | "RIGHT" | "FULL";
      joins.push({
        kind: "join",
        joinType,
        table: naturalMatch[2]!,
        onLeft: "",
        onRight: "",
        natural: true,
      });
      rest = naturalMatch[4] ?? "";
      continue;
    }

    // Try ON clause first: JOIN ... ON t1.col = t2.col
    const jm = rest.match(
      /^\s*(?:(INNER|LEFT|RIGHT|FULL)(?:\s+OUTER)?\s+)?JOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?\s+ON\s+([a-zA-Z_][a-zA-Z0-9_\.]*)\s*=\s*([a-zA-Z_][a-zA-Z0-9_\.]*)\s*(.*)$/i,
    );
    if (jm) {
      const joinType = (jm[1]?.toUpperCase() ?? "INNER") as "INNER" | "LEFT" | "RIGHT" | "FULL";
      joins.push({
        kind: "join",
        joinType,
        table: jm[2]!,
        onLeft: jm[4]!,
        onRight: jm[5]!,
      });
      rest = jm[6] ?? "";
      continue;
    }

    // Try USING clause: JOIN ... USING (col1, col2)
    const usingMatch = rest.match(
      /^\s*(?:(INNER|LEFT|RIGHT|FULL)(?:\s+OUTER)?\s+)?JOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?\s+USING\s*\(([^)]+)\)\s*(.*)$/i,
    );
    if (usingMatch) {
      const joinType = (usingMatch[1]?.toUpperCase() ?? "INNER") as "INNER" | "LEFT" | "RIGHT" | "FULL";
      const columns = usingMatch[4]!.split(",").map((c) => c.trim());
      // For USING with multiple columns, use the first column as onLeft/onRight
      // and store all columns in usingColumns for multi-column matching during execution
      const firstCol = columns[0]!;
      joins.push({
        kind: "join",
        joinType,
        table: usingMatch[2]!,
        onLeft: firstCol,
        onRight: firstCol,
        usingColumns: columns.length > 1 ? columns : undefined,
      });
      rest = usingMatch[5] ?? "";
      continue;
    }

    break;
  }

  return { joins, rest };
}

function parseJoin(tail: string): { join?: JoinAst; rest: string } {
  const { joins, rest } = parseJoinChain(tail);
  return { join: joins[0], rest };
}

function parseFromRef(base: string): { from: TableRefAst; tail: string } | null {
  // LATERAL subquery: SELECT ... FROM t1, LATERAL (SELECT ...) AS alias
  const lateralSub = base.match(/^SELECT\s+(.+?)\s+FROM\s+LATERAL\s+\((SELECT\s+.+)\)\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\b(.*)$/i);
  if (lateralSub) {
    const outerFields = lateralSub[1]!.trim();
    const subquerySql = lateralSub[2]!.trim();
    const alias = lateralSub[3]!.trim();
    const tail = lateralSub[4] ?? "";
    const rewrittenSql = `SELECT ${outerFields} FROM __DERIVED_TABLE__${tail}`;
    return {
      from: {
        kind: "subquery",
        subquerySql,
        alias,
        rewrittenSql,
        lateral: true,
      },
      tail,
    };
  }

  // Non-LATERAL subquery: SELECT ... FROM (SELECT ...) AS alias
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

  // Use depth-aware FROM finder to correctly handle scalar subqueries
  const fromPos = findFromAtDepthZero(base);
  if (fromPos === null) return null;

  // Everything between "SELECT " and FROM is the select list
  // Everything after FROM is the table/tail part
  const selectList = base.substring("SELECT ".length, fromPos).trim();
  const afterFrom = base.substring(fromPos + "FROM".length).trim();

  // Parse table name and alias from the afterFrom part
  const tableMatch = afterFrom.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\b(.*)$/i);
  if (!tableMatch) return null;

  let alias: string | undefined;
  let tail = tableMatch[2] ?? "";
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
      "CROSS",
      "JOIN",
      "UNION",
      "INTERSECT",
      "EXCEPT",
      "NATURAL",
    ]);
    if (!clauseKeywords.has(token)) {
      alias = aliasCandidate[1]!;
      tail = aliasCandidate[2] ?? "";
    }
  }

  return {
    from: { kind: "table", name: tableMatch[1]!.trim(), alias },
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

/**
 * Parses SAVEPOINT, ROLLBACK TO SAVEPOINT, and RELEASE SAVEPOINT statements.
 * Returns one of three AST types or null if the SQL doesn't match.
 */
function parseSavepointStatement(base: string, rawSql: string): SavepointStatementAst | RollbackToSavepointStatementAst | ReleaseSavepointStatementAst | null {
  const normalized = base.replace(/;\s*$/, "").trim();
  if (!normalized) return null;

  // SAVEPOINT name
  const savepointMatch = normalized.match(/^SAVEPOINT\s+([a-zA-Z_][a-zA-Z0-9_]*)$/i);
  if (savepointMatch) {
    return {
      kind: "savepoint",
      name: savepointMatch[1]!,
      rawSql,
    };
  }

  // ROLLBACK TO SAVEPOINT name (also accepts ROLLBACK WORK TO SAVEPOINT name)
  const rollbackToMatch = normalized.match(/^ROLLBACK(?:\s+WORK)?\s+TO\s+SAVEPOINT\s+([a-zA-Z_][a-zA-Z0-9_]*)$/i);
  if (rollbackToMatch) {
    return {
      kind: "rollback_to_savepoint",
      name: rollbackToMatch[1]!,
      rawSql,
    };
  }

  // RELEASE SAVEPOINT name (also accepts RELEASE WORK SAVEPOINT name)
  const releaseMatch = normalized.match(/^RELEASE(?:\s+WORK)?\s+SAVEPOINT\s+([a-zA-Z_][a-zA-Z0-9_]*)$/i);
  if (releaseMatch) {
    return {
      kind: "release_savepoint",
      name: releaseMatch[1]!,
      rawSql,
    };
  }

  return null;
}

function parseCreateSchemaStatement(base: string, rawSql: string): CreateSchemaStatementAst | null {
  const normalized = base.replace(/;\s*$/, "").trim();
  if (!normalized) return null;

  // CREATE SCHEMA schema_name
  const match = normalized.match(/^CREATE\s+SCHEMA\s+([a-zA-Z_][a-zA-Z0-9_]*)$/i);
  if (match) {
    return {
      kind: "create_schema",
      schemaName: match[1]!,
      rawSql,
    };
  }

  return null;
}

/**
 * Parse CREATE FUNCTION statement.
 * Syntax: CREATE FUNCTION name(param1 type1, ...) RETURNS type AS expression
 * Example: CREATE FUNCTION add_one(x INT) RETURNS INT AS 'x + 1'
 */
function parseCreateFunctionStatement(base: string, rawSql: string): CreateFunctionStatementAst | null {
  const normalized = base.replace(/;\s*$/, "").trim();
  if (!normalized) return null;

  // CREATE FUNCTION func_name(params) RETURNS type [LANGUAGE lang] [AS 'body'|AS $$body$$|AS $tag$body$tag$]
  const headerMatch = normalized.match(
    /^CREATE\s+FUNCTION\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s+RETURNS\s+([a-zA-Z_][a-zA-Z0-9_]*)/i,
  );
  if (!headerMatch) return null;

  const functionName = headerMatch[1]!;
  const paramStr = headerMatch[2]!.trim();
  const returnType = headerMatch[3]!;

  const params = paramStr
    ? paramStr.split(",").map((p) => {
        const [name, typeName] = p.trim().split(/\s+/);
        return { name: name!.trim(), typeName: (typeName ?? "INT").trim() };
      })
    : [];

  // After the RETURNS type, there may be LANGUAGE clause and AS clause
  const afterHeader = normalized.slice(headerMatch[0].length).trim();

  let language: string | undefined;
  let body = "";
  let bodyKind: "expression" | "statement" = "expression";

  // Parse optional LANGUAGE clause
  const langMatch = afterHeader.match(/^LANGUAGE\s+(\w+)\s*/i);
  if (langMatch) {
    language = langMatch[1]!;
  }

  // Find AS clause
  const asIdx = afterHeader.search(/\bAS\b/i);
  if (asIdx === -1) {
    // No AS clause - function declaration without body (for forward declarations)
    return {
      kind: "create_function",
      functionName,
      spec: {
        name: functionName,
        params,
        returnType,
        bodyKind: "expression",
        body: "",
      },
      rawSql,
    };
  }

  const afterAs = afterHeader.slice(asIdx + 2).trim();

  // Parse the body - could be single-quoted, dollar-quoted, or BEGIN...END
  // Single-quoted: 'body'
  const singleQuoteMatch = afterAs.match(/^'((?:[^'\\]|\\.)*)'$/s);
  if (singleQuoteMatch) {
    body = singleQuoteMatch[1]!;
  } else if (afterAs.startsWith("$$")) {
    // Dollar-quoted: $$body$$ or $tag$body$tag$
    const dollarMatch = afterAs.match(/^\$([^$]*)\$([\s\S]*?)\$\1\$/);
    if (dollarMatch) {
      body = dollarMatch[2]!;
    } else {
      // Simple $$...$$ without tag
      const simpleDollarMatch = afterAs.match(/^\$\$([\s\S]*?)\$\$$/);
      if (simpleDollarMatch) {
        body = simpleDollarMatch[1]!;
      }
    }
  }

  // Detect if body is a compound statement (BEGIN...END)
  if (/^BEGIN\s/i.test(body.trim())) {
    bodyKind = "statement";
  }

  return {
    kind: "create_function",
    functionName,
    spec: {
      name: functionName,
      params,
      returnType,
      language,
      bodyKind,
      body,
    },
    rawSql,
  };
}

/**
 * Parse CREATE TRIGGER statement.
 * Syntax: CREATE TRIGGER name ON table [BEFORE|AFTER] [INSERT|UPDATE|DELETE] AS body
 * Example: CREATE TRIGGER check_sal ON employees AFTER INSERT AS 'NEW.salary > 0'
 */
function parseCreateTriggerStatement(base: string, rawSql: string): CreateTriggerStatementAst | null {
  const normalized = base.replace(/;\s*$/, "").trim();
  if (!normalized) return null;

  const match = normalized.match(
    /^CREATE\s+TRIGGER\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+ON\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+(BEFORE|AFTER)\s+(INSERT|UPDATE|DELETE)\s+AS\s+'([^']+)'$/i,
  );
  if (match) {
    return {
      kind: "create_trigger",
      spec: {
        name: match[1]!,
        tableName: match[2]!,
        timing: match[3]!.toUpperCase() as "BEFORE" | "AFTER",
        event: match[4]!.toUpperCase() as "INSERT" | "UPDATE" | "DELETE",
        body: match[5]!,
      },
      rawSql,
    };
  }

  return null;
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

  const columnEntries = splitCommaAware(match[4]!).map((c) => c.trim()).filter(Boolean);
  // Extract column name from each entry: strip optional DESC/ASC/COLLATE suffix
  const extractColumnName = (entry: string): string => {
    return entry
      .replace(/\s+COLLATE\s+\w+/i, "") // Remove COLLATE clause
      .replace(/\s+(DESC|ASC)\s*$/i, "") // Remove DESC/ASC at end
      .trim();
  };
  const columns = columnEntries.map(extractColumnName);
  // Validate each column entry
  const columnIdentifierRegex = /^[a-zA-Z_][a-zA-Z0-9_\.]*$/;
  if (columns.length === 0 || columns.some((c) => !columnIdentifierRegex.test(c))) {
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

function parseDropTableStatement(base: string, rawSql: string): DropTableStatementAst | null {
  const normalized = base.replace(/;\s*$/, "").trim();
  if (!/^DROP\s+/i.test(normalized)) return null;

  // SQLite supports: DROP TABLE [IF EXISTS] tablename
  const match = normalized.match(/^DROP\s+TABLE\s+(IF\s+EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)$/i);

  if (!match) {
    if (/^DROP\s+TABLE\b/i.test(normalized)) {
      throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
        message: "DROP TABLE requires syntax: DROP TABLE [IF EXISTS] <name>",
        token: "TABLE",
      });
    }
    return null;
  }

  return {
    kind: "drop_table",
    ifExists: !!match[1],
    tableName: match[2]!,
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

  let querySql = match[2]!.trim();
  let withCheckOption = false;

  // Parse WITH CHECK OPTION
  const withCheckMatch = querySql.match(/^(.+?)\s+WITH\s+CHECK\s+OPTION$/i);
  if (withCheckMatch) {
    querySql = withCheckMatch[1]!.trim();
    withCheckOption = true;
  }

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
    withCheckOption,
  };
}

function parseDropViewStatement(base: string, rawSql: string): DropViewStatementAst | null {
  const normalized = base.replace(/;\s*$/, "").trim();
  if (!/^DROP\s+/i.test(normalized)) return null;

  const match = normalized.match(/^DROP\s+VIEW\s+(IF\s+EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)(\s+(CASCADE|RESTRICT))?$/i);

  if (!match) {
    if (/^DROP\s+VIEW\b/i.test(normalized)) {
      throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
        message: "DROP VIEW requires syntax: DROP VIEW [IF EXISTS] <name> [CASCADE | RESTRICT]",
        token: "VIEW",
      });
    }
    return null;
  }

  return {
    kind: "drop_view",
    ifExists: !!match[1],
    viewName: match[2]!,
    cascade: match[4]?.toUpperCase() === "CASCADE",
    rawSql,
  };
}

function parseCreateDomainStatement(base: string, rawSql: string): CreateDomainStatementAst | null {
  const normalized = base.replace(/;\s*$/, "").trim();
  if (!/^CREATE\s+DOMAIN\b/i.test(normalized)) return null;

  // CREATE DOMAIN name AS type [(length)] [DEFAULT expr] [constraint...]
  const match = normalized.match(
    /^CREATE\s+DOMAIN\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+AS\s+([A-Z_][A-Z0-9_]*(?:\s+VARYING)?)(?:\s*\(\s*(\d+)\s*\))?/i,
  );

  if (!match) {
    throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
      message: "CREATE DOMAIN requires syntax: CREATE DOMAIN <name> AS <type>[(length)]",
      token: "DOMAIN",
    });
  }

  const domainName = match[1]!;
  const baseType = match[2]!.toUpperCase();
  const length = match[3] ? parseInt(match[3], 10) : undefined;

  // Extract optional DEFAULT clause
  let defaultValue: string | undefined;
  let remaining = normalized.slice(normalized.toUpperCase().search(/AS\s+\S+/i) + 3).trim();
  const defaultMatch = remaining.match(/\bDEFAULT\s+(.+?)(?=\s+(?:CONSTRAINT|NOT\s+NULL|UNIQUE|CHECK)\b|$)/i);
  if (defaultMatch) {
    defaultValue = defaultMatch[1]!.trim();
    remaining = remaining.slice(0, defaultMatch.index!) + remaining.slice(defaultMatch.index! + defaultMatch[0].length);
  }

  // Extract constraints
  const constraints: Array<{ type: "NOT NULL" | "UNIQUE" | "CHECK"; expression?: string }> = [];
  const notNullMatch = remaining.match(/\bNOT\s+NULL\b/i);
  if (notNullMatch) {
    constraints.push({ type: "NOT NULL" });
  }
  const uniqueMatch = remaining.match(/\bUNIQUE\b/i);
  if (uniqueMatch) {
    constraints.push({ type: "UNIQUE" });
  }
  const checkMatch = remaining.match(/\bCHECK\s*\((.+?)\)/i);
  if (checkMatch) {
    constraints.push({ type: "CHECK", expression: checkMatch[1] });
  }

  return {
    kind: "create_domain",
    domainName,
    baseType,
    length,
    defaultValue,
    constraints: constraints.length > 0 ? constraints : undefined,
    rawSql,
  };
}

function parseDropDomainStatement(base: string, rawSql: string): DropDomainStatementAst | null {
  const normalized = base.replace(/;\s*$/, "").trim();
  if (!/^DROP\s+DOMAIN\b/i.test(normalized)) return null;

  const match = normalized.match(/^DROP\s+DOMAIN\s+(IF\s+EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(CASCADE|RESTRICT))?$/i);

  if (!match) {
    throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
      message: "DROP DOMAIN requires syntax: DROP DOMAIN [IF EXISTS] <name> [CASCADE|RESTRICT]",
      token: "DOMAIN",
    });
  }

  return {
    kind: "drop_domain",
    ifExists: !!match[1],
    domainName: match[2]!,
    cascade: match[3]?.toUpperCase() === "CASCADE",
    rawSql,
  };
}

function parseCreateAssertionStatement(base: string, rawSql: string): CreateAssertionStatementAst | null {
  const normalized = base.replace(/;\s*$/, "").trim();
  if (!/^CREATE\s+ASSERTION\b/i.test(normalized)) return null;

  // CREATE ASSERTION name CHECK (search_condition) [INITIALLY DEFERRED]
  const match = normalized.match(
    /^CREATE\s+ASSERTION\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+CHECK\s*\((.+)\)(?:\s+INITIALLY\s+DEFERRED)?$/i,
  );

  if (!match) {
    throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
      message: "CREATE ASSERTION requires syntax: CREATE ASSERTION <name> CHECK (<condition>) [INITIALLY DEFERRED]",
      token: "ASSERTION",
    });
  }

  return {
    kind: "create_assertion",
    assertionName: match[1]!,
    predicate: match[2]!.trim(),
    initiallyDeferred: /\bINITIALLY\s+DEFERRED\b/i.test(normalized),
    rawSql,
  };
}

function parseDropAssertionStatement(base: string, rawSql: string): DropAssertionStatementAst | null {
  const normalized = base.replace(/;\s*$/, "").trim();
  if (!/^DROP\s+ASSERTION\b/i.test(normalized)) return null;

  const match = normalized.match(/^DROP\s+ASSERTION\s+(IF\s+EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)$/i);

  if (!match) {
    throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
      message: "DROP ASSERTION requires syntax: DROP ASSERTION [IF EXISTS] <name>",
      token: "ASSERTION",
    });
  }

  return {
    kind: "drop_assertion",
    ifExists: !!match[1],
    assertionName: match[2]!,
    rawSql,
  };
}

function parseInsertStatement(base: string, rawSql: string): InsertStatementAst | null {
  const normalized = base.replace(/;\s*$/, "").trim();
  if (!/^INSERT\s+INTO\b/i.test(normalized)) return null;

  // INSERT INTO table (col1, col2) VALUES (val1, val2), ...
  // or INSERT INTO table VALUES (val1, val2), ...
  const match = normalized.match(
    /^INSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\(([^)]+)\))?\s+VALUES\s*(.+)$/i,
  );
  if (!match) {
    // INSERT INTO table SELECT ...
    const selectMatch = normalized.match(/^INSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\(([^)]+)\))?\s+SELECT\b/i);
    if (selectMatch) {
      return {
        kind: "insert",
        tableName: selectMatch[1]!,
        columns: selectMatch[2] ? selectMatch[2].split(",").map(c => c.trim()) : undefined,
        values: [],
        selectSql: normalized.slice(normalized.toUpperCase().search(/SELECT\b/)),
        rawSql,
      };
    }
    throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
      message: "INSERT requires VALUES or SELECT clause",
      token: "INSERT",
    });
  }

  const tableName = match[1]!;
  const columns = match[2] ? match[2].split(",").map(c => c.trim()) : undefined;

  // Parse multiple value rows: (val1, val2), (val3, val4), ...
  const valuesText = match[3]!;
  const valueRows: ExprAst[][] = [];
  const valueRowMatches = [...valuesText.matchAll(/\(([^)]+)\)/g)];
  for (const rowMatch of valueRowMatches) {
    const rowValues = splitCommaAware(rowMatch[1]!).map(v => parseExpr(v.trim()));
    valueRows.push(rowValues);
  }

  return {
    kind: "insert",
    tableName,
    columns,
    values: valueRows,
    rawSql,
  };
}

function parseUpdateStatement(base: string, rawSql: string): UpdateStatementAst | null {
  const normalized = base.replace(/;\s*$/, "").trim();
  if (!/^UPDATE\b/i.test(normalized)) return null;

  // UPDATE table [AS alias] SET col1=val1, col2=val2 [WHERE ...]
  // UPDATE table [AS alias] [INNER|LEFT|RIGHT|FULL JOIN ... ON ...] SET col=val [WHERE ...]
  const match = normalized.match(
    /^UPDATE\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?(?:\s+(?:(INNER|LEFT|RIGHT|FULL)(?:\s+OUTER)?)\s+JOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?\s+ON\s+([a-zA-Z_][a-zA-Z0-9_\.]*)\s*=\s*([a-zA-Z_][a-zA-Z0-9_\.]*))?\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i,
  );

  if (!match) {
    throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
      message: "UPDATE requires SET clause with column=value assignments",
      token: "UPDATE",
    });
  }

  const tableName = match[1]!;
  const tableAlias = match[2];
  const joinType = match[3]?.toUpperCase() as "INNER" | "LEFT" | "RIGHT" | "FULL" | undefined;
  const joinTable = match[4];
  const joinAlias = match[5];
  const joinLeftField = match[6];
  const joinRightField = match[7];
  const setClauseText = match[8]!;
  const whereText = match[9]?.trim();

  const setItems = splitCommaAware(setClauseText).map(item => {
    const [col, ...valParts] = item.split("=");
    return {
      column: col.trim(),
      value: parseExpr(valParts.join("=").trim()),
    };
  });

  const join: JoinAst | undefined = joinType && joinTable
    ? { kind: "join", joinType: joinType as "INNER" | "LEFT" | "RIGHT" | "FULL", table: joinTable, onLeft: joinLeftField!, onRight: joinRightField! }
    : undefined;

  return {
    kind: "update",
    tableName,
    tableAlias,
    setClause: setItems,
    where: whereText ? parseExpr(whereText) : undefined,
    join,
    rawSql,
  };
}

function parseDeleteStatement(base: string, rawSql: string): DeleteStatementAst | null {
  const normalized = base.replace(/;\s*$/, "").trim();
  if (!/^DELETE\s+FROM\b/i.test(normalized)) return null;

  // DELETE FROM table [AS alias] [USING ...] [WHERE ...]
  // DELETE FROM table [AS alias] [INNER|LEFT|RIGHT|FULL JOIN ... ON ...] [WHERE ...]
  const match = normalized.match(
    /^DELETE\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?(?:\s+USING\s+([a-zA-Z_][a-zA-Z0-9_,\s]+))?(?:\s+(?:(INNER|LEFT|RIGHT|FULL)(?:\s+OUTER)?)\s+JOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?\s+ON\s+([a-zA-Z_][a-zA-Z0-9_\.]*)\s*=\s*([a-zA-Z_][a-zA-Z0-9_\.]*))?\s*(?:WHERE\s+(.+))?$/i,
  );

  if (!match) {
    throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
      message: "DELETE requires FROM clause with table name",
      token: "DELETE",
    });
  }

  const tableName = match[1]!;
  const tableAlias = match[2];
  const using = match[3]?.trim();
  const joinType = match[4]?.toUpperCase() as "INNER" | "LEFT" | "RIGHT" | "FULL" | undefined;
  const joinTable = match[5];
  const joinAlias = match[6];
  const joinLeftField = match[7];
  const joinRightField = match[8];
  const whereText = match[9]?.trim();

  const join: JoinAst | undefined = joinType && joinTable
    ? { kind: "join", joinType: joinType as "INNER" | "LEFT" | "RIGHT" | "FULL", table: joinTable, onLeft: joinLeftField!, onRight: joinRightField! }
    : undefined;

  return {
    kind: "delete",
    tableName,
    tableAlias,
    using,
    where: whereText ? parseExpr(whereText) : undefined,
    join,
    rawSql,
  };
}

function parseTruncateTableStatement(base: string, rawSql: string): TruncateTableStatementAst | null {
  const normalized = base.replace(/;\s*$/, "").trim();
  if (!/^TRUNCATE\s+TABLE\b/i.test(normalized)) return null;

  const match = normalized.match(/^TRUNCATE\s+TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)$/i);
  if (!match) {
    throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
      message: "TRUNCATE TABLE requires a table name",
      token: "TRUNCATE",
    });
  }

  return {
    kind: "truncate_table",
    tableName: match[1]!,
    rawSql,
  };
}

function parseAlterTableStatement(base: string, rawSql: string): AlterTableStatementAst | null {
  const normalized = base.replace(/;\s*$/, "").trim();
  if (!/^ALTER\s+TABLE\b/i.test(normalized)) return null;

  // ALTER TABLE table_name action
  const tableMatch = normalized.match(/^ALTER\s+TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+(.+)$/i);
  if (!tableMatch) {
    throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
      message: "ALTER TABLE requires a table name and action",
      token: "ALTER",
    });
  }

  const tableName = tableMatch[1]!;
  const actionText = tableMatch[2]!.trim();

  // Parse the action
  const action = parseAlterTableAction(actionText);

  return {
    kind: "alter_table",
    tableName,
    action,
    rawSql,
  };
}

function parseAlterTableAction(actionText: string): AlterTableAction {
  const upper = actionText.toUpperCase();

  // ADD CONSTRAINT must be checked before ADD COLUMN since ADD matches first
  // ADD constraint [constraint_name] constraint_definition
  if (upper.startsWith("ADD CONSTRAINT")) {
    const match = actionText.match(/^ADD\s+CONSTRAINT\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+(.+)$/i);
    if (match) {
      return {
        action: "add_constraint",
        constraintName: match[1]!,
        constraintDefinition: match[2]!.trim(),
      };
    }
  }

  // ADD [COLUMN] column_name [datatype] - check for ADD COLUMN explicitly
  const addColMatch = actionText.match(/^ADD\s+COLUMN\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(.*)$/i);
  if (addColMatch) {
    return {
      action: "add_column",
      columnName: addColMatch[1]!,
      dataType: addColMatch[2]?.trim() || undefined,
    };
  }

  // ADD column_name [datatype] - bare ADD (no COLUMN keyword)
  const addBareMatch = actionText.match(/^ADD\s+(?!CONSTRAINT)([a-zA-Z_][a-zA-Z0-9_]*)\s*(.*)$/i);
  if (addBareMatch) {
    return {
      action: "add_column",
      columnName: addBareMatch[1]!,
      dataType: addBareMatch[2]?.trim() || undefined,
    };
  }

  // DROP [COLUMN] column_name [RESTRICT|CASCADE]
  const dropColMatch = actionText.match(/^DROP\s+(?:COLUMN\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*(RESTRICT|CASCADE)?$/i);
  if (dropColMatch) {
    return {
      action: "drop_column",
      columnName: dropColMatch[1]!,
      cascade: dropColMatch[2]?.toUpperCase() === "CASCADE",
    };
  }

  // ALTER [COLUMN] column_name SET DEFAULT literal
  const alterSetDefaultMatch = actionText.match(/^ALTER\s+(?:COLUMN\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s+SET\s+DEFAULT\s+(.+)$/i);
  if (alterSetDefaultMatch) {
    return {
      action: "alter_column_set_default",
      columnName: alterSetDefaultMatch[1]!,
      defaultValue: alterSetDefaultMatch[2]!.trim(),
    };
  }

  // ALTER [COLUMN] column_name DROP DEFAULT
  const alterDropDefaultMatch = actionText.match(/^ALTER\s+(?:COLUMN\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s+DROP\s+DEFAULT$/i);
  if (alterDropDefaultMatch) {
    return {
      action: "alter_column_drop_default",
      columnName: alterDropDefaultMatch[1]!,
    };
  }

  // DROP CONSTRAINT constraint_name [RESTRICT|CASCADE]
  const dropConstraintMatch = actionText.match(/^DROP\s+CONSTRAINT\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(RESTRICT|CASCADE)?$/i);
  if (dropConstraintMatch) {
    return {
      action: "drop_constraint",
      constraintName: dropConstraintMatch[1]!,
      cascade: dropConstraintMatch[2]?.toUpperCase() === "CASCADE",
    };
  }

  // RENAME TO new_table_name
  const renameTableMatch = actionText.match(/^RENAME\s+TO\s+([a-zA-Z_][a-zA-Z0-9_]*)$/i);
  if (renameTableMatch) {
    return {
      action: "rename_table",
      newTableName: renameTableMatch[1]!,
    };
  }

  // RENAME COLUMN old_name TO new_name
  const renameColMatch = actionText.match(/^RENAME\s+COLUMN\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+TO\s+([a-zA-Z_][a-zA-Z0-9_]*)$/i);
  if (renameColMatch) {
    return {
      action: "rename_column",
      columnName: renameColMatch[1]!,
      newColumnName: renameColMatch[2]!,
    };
  }

  // ALTER [COLUMN] column_name TYPE new_type (PostgreSQL)
  const alterTypeMatch = actionText.match(/^ALTER\s+(?:COLUMN\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s+TYPE\s+(.+)$/i);
  if (alterTypeMatch) {
    return {
      action: "alter_column_set_type",
      columnName: alterTypeMatch[1]!,
      dataType: alterTypeMatch[2]!.trim(),
    };
  }

  // ALTER [COLUMN] column_name SET NOT NULL (PostgreSQL)
  const alterSetNotNullMatch = actionText.match(/^ALTER\s+(?:COLUMN\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s+SET\s+NOT\s+NULL$/i);
  if (alterSetNotNullMatch) {
    return {
      action: "alter_column_set_not_null",
      columnName: alterSetNotNullMatch[1]!,
    };
  }

  // ALTER [COLUMN] column_name DROP NOT NULL (PostgreSQL)
  const alterDropNotNullMatch = actionText.match(/^ALTER\s+(?:COLUMN\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s+DROP\s+NOT\s+NULL$/i);
  if (alterDropNotNullMatch) {
    return {
      action: "alter_column_drop_not_null",
      columnName: alterDropNotNullMatch[1]!,
    };
  }

  // DISABLE TRIGGER name|ALL (PostgreSQL)
  const disableTriggerMatch = actionText.match(/^DISABLE\s+TRIGGER\s+([a-zA-Z_][a-zA-Z0-9_]*|ALL)$/i);
  if (disableTriggerMatch) {
    return {
      action: "disable_trigger",
      triggerName: disableTriggerMatch[1]!,
    };
  }

  // ENABLE TRIGGER name|ALL (PostgreSQL)
  const enableTriggerMatch = actionText.match(/^ENABLE\s+TRIGGER\s+([a-zA-Z_][a-zA-Z0-9_]*|ALL)$/i);
  if (enableTriggerMatch) {
    return {
      action: "enable_trigger",
      triggerName: enableTriggerMatch[1]!,
    };
  }

  // VALIDATE CONSTRAINT constraint_name (PostgreSQL)
  const validateConstraintMatch = actionText.match(/^VALIDATE\s+CONSTRAINT\s+([a-zA-Z_][a-zA-Z0-9_]*)$/i);
  if (validateConstraintMatch) {
    return {
      action: "validate_constraint",
      constraintName: validateConstraintMatch[1]!,
    };
  }

  // DISABLE CONSTRAINT constraint_name (PostgreSQL)
  const disableConstraintMatch = actionText.match(/^DISABLE\s+CONSTRAINT\s+([a-zA-Z_][a-zA-Z0-9_]*)$/i);
  if (disableConstraintMatch) {
    return {
      action: "disable_constraint",
      constraintName: disableConstraintMatch[1]!,
    };
  }

  // If nothing matched, throw an error instead of returning raw
  throw createSqlError("SQL_SYNTAX_UNSUPPORTED_ALTER_ACTION", {
    message: `Unsupported ALTER TABLE action: ${actionText}`,
    token: actionText.split(/\s+/)[0] ?? "",
  });
}

function parseGrantStatement(base: string, rawSql: string): GrantStatementAst | null {
  const normalized = base.replace(/;\s*$/, "").trim();
  if (!/^GRANT\b/i.test(normalized)) return null;

  // GRANT {privilege[,privilege...]|ALL} ON [TABLE] table_name TO {grantee|PUBLIC} [WITH GRANT OPTION]
  const match = normalized.match(
    /^GRANT\s+((?:[A-Z_]+,?\s*)+|ALL(?:\s+PRIVILEGES)?)\s+ON\s+(?:TABLE\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s+TO\s+([a-zA-Z_][a-zA-Z0-9_]*|PUBLIC)\s*(WITH\s+GRANT\s+OPTION)?$/i,
  );
  if (!match) {
    // Try function-level GRANT: GRANT EXECUTE ON FUNCTION name TO {grantee|PUBLIC}
    const funcMatch = normalized.match(
      /^GRANT\s+(EXECUTE)\s+ON\s+FUNCTION\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+TO\s+([a-zA-Z_][a-zA-Z0-9_]*|PUBLIC)\s*(WITH\s+GRANT\s+OPTION)?$/i,
    );
    if (funcMatch) {
      const privileges = [funcMatch[1]!.toUpperCase() as PrivilegeKind];
      const granteeName = funcMatch[3]!.toUpperCase();
      return {
        kind: "grant",
        privileges,
        onObject: { type: "function", name: funcMatch[2]! },
        grantee: granteeName === "PUBLIC" ? { kind: "public" } : { kind: "user", name: funcMatch[3]! },
        withGrantOption: !!funcMatch[4],
        rawSql,
      };
    }
    throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
      message: "GRANT requires privilege list, table name, and grantee",
      token: "GRANT",
    });
  }

  const privStr = match[1]!.trim().toUpperCase();
  const privileges: PrivilegeKind[] = privStr === "ALL" || privStr === "ALL PRIVILEGES"
    ? ["ALL"]
    : privStr.split(",").map((p) => p.trim() as PrivilegeKind).filter((p) => p);

  const granteeName = match[3]!.toUpperCase();

  return {
    kind: "grant",
    privileges,
    onObject: { type: "table", name: match[2]! },
    grantee: granteeName === "PUBLIC" ? { kind: "public" } : { kind: "user", name: match[3]! },
    withGrantOption: !!match[4],
    rawSql,
  };
}

function parseRevokeStatement(base: string, rawSql: string): RevokeStatementAst | null {
  const normalized = base.replace(/;\s*$/, "").trim();
  if (!/^REVOKE\b/i.test(normalized)) return null;

  // REVOKE [GRANT OPTION FOR] {privilege[,privilege...]|ALL} ON [TABLE] table_name FROM {grantee|PUBLIC} [CASCADE|RESTRICT]
  const match = normalized.match(
    /^REVOKE\s+(GRANT\s+OPTION\s+FOR\s+)?((?:[A-Z_]+,?\s*)+|ALL(?:\s+PRIVILEGES)?)\s+ON\s+(?:TABLE\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*|PUBLIC)\s*(CASCADE|RESTRICT)?$/i,
  );
  if (!match) {
    // Try function-level REVOKE: REVOKE EXECUTE ON FUNCTION name FROM {grantee|PUBLIC}
    const funcMatch = normalized.match(
      /^REVOKE\s+(GRANT\s+OPTION\s+FOR\s+)?(EXECUTE)\s+ON\s+FUNCTION\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*|PUBLIC)\s*(CASCADE|RESTRICT)?$/i,
    );
    if (funcMatch) {
      const privileges = [funcMatch[2]!.toUpperCase() as PrivilegeKind];
      const granteeName = funcMatch[4]!.toUpperCase();
      return {
        kind: "revoke",
        privileges,
        onObject: { type: "function", name: funcMatch[3]! },
        grantee: granteeName === "PUBLIC" ? { kind: "public" } : { kind: "user", name: funcMatch[4]! },
        grantOptionFor: !!funcMatch[1],
        cascade: funcMatch[5]?.toUpperCase() === "CASCADE",
        rawSql,
      };
    }
    throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
      message: "REVOKE requires privilege list, table name, and grantee",
      token: "REVOKE",
    });
  }

  const privStr = match[2]!.trim().toUpperCase();
  const privileges: PrivilegeKind[] = privStr === "ALL" || privStr === "ALL PRIVILEGES"
    ? ["ALL"]
    : privStr.split(",").map((p) => p.trim() as PrivilegeKind).filter((p) => p);

  const granteeName = match[4]!.toUpperCase();

  return {
    kind: "revoke",
    privileges,
    onObject: { type: "table", name: match[3]! },
    grantee: granteeName === "PUBLIC" ? { kind: "public" } : { kind: "user", name: match[4]! },
    grantOptionFor: !!match[1],
    cascade: match[5]?.toUpperCase() === "CASCADE",
    rawSql,
  };
}

function parseCreateTableStatement(base: string, rawSql: string): CreateTableStatementAst | null {
  const normalized = base.replace(/;\s*$/, "").trim();
  if (!/^CREATE\s+TABLE\b/i.test(normalized)) return null;
  const match = normalized.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)/i);
  if (!match) {
    throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
      message: "CREATE TABLE requires a table name",
      token: "TABLE",
    });
  }
  return {
    kind: "create_table",
    tableName: match[1]!,
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

  const savepoint = parseSavepointStatement(base, sql);
  if (savepoint) return savepoint;

  const createSchema = parseCreateSchemaStatement(base, sql);
  if (createSchema) return createSchema;

  const createFunction = parseCreateFunctionStatement(base, sql);
  if (createFunction) return createFunction;

  const createTrigger = parseCreateTriggerStatement(base, sql);
  if (createTrigger) return createTrigger;

  const createIndex = parseCreateIndexStatement(base, sql);
  if (createIndex) return createIndex;

  const dropIndex = parseDropIndexStatement(base, sql);
  if (dropIndex) return dropIndex;

  const dropTable = parseDropTableStatement(base, sql);
  if (dropTable) return dropTable;

  const createView = parseCreateViewStatement(base, sql, dialect);
  if (createView) return createView;

  const dropView = parseDropViewStatement(base, sql);
  if (dropView) return dropView;

  const createDomain = parseCreateDomainStatement(base, sql);
  if (createDomain) return createDomain;

  const dropDomain = parseDropDomainStatement(base, sql);
  if (dropDomain) return dropDomain;

  const createAssertion = parseCreateAssertionStatement(base, sql);
  if (createAssertion) return createAssertion;

  const dropAssertion = parseDropAssertionStatement(base, sql);
  if (dropAssertion) return dropAssertion;

  const insert = parseInsertStatement(base, sql);
  if (insert) return insert;

  const update = parseUpdateStatement(base, sql);
  if (update) return update;

  const del = parseDeleteStatement(base, sql);
  if (del) return del;

  const truncate = parseTruncateTableStatement(base, sql);
  if (truncate) return truncate;

  const alter = parseAlterTableStatement(base, sql);
  if (alter) return alter;

  const createTable = parseCreateTableStatement(base, sql);
  if (createTable) return createTable;

  const grant = parseGrantStatement(base, sql);
  if (grant) return grant;

  const revoke = parseRevokeStatement(base, sql);
  if (revoke) return revoke;

  const selectLike = /^SELECT\b/i.test(base);
  if (!selectLike) {
    throw createSqlError("SQL_DIALECT_UNSUPPORTED_SYNTAX", {
      message:
        "Only SELECT/UNION/INTERSECT/EXCEPT/BEGIN/COMMIT/ROLLBACK/SAVEPOINT/ROLLBACK TO SAVEPOINT/RELEASE SAVEPOINT/CREATE SCHEMA/CREATE FUNCTION/CREATE TRIGGER/CREATE INDEX/DROP INDEX/CREATE VIEW/DROP VIEW/GRANT/REVOKE statements are currently accepted by parser baseline",
      token: base.split(/\s+/)[0],
    });
  }

  // Check if this is a SELECT without FROM (scalar expression query like SQLite's SELECT <expr>)
  const hasFrom = /\bFROM\b/i.test(base);
  let fromParsed: { from: TableRefAst; tail: string } | null = null;
  let selectFields: string;
  let topLimit: number | undefined;

  if (!hasFrom) {
    // SELECT <expr> without FROM — treat as SELECT <expr> FROM (SELECT NULL)
    // Extract select list: everything between SELECT and end (or first clause keyword)
    const scalarMatch = base.match(/^SELECT\s+(.+)$/i);
    if (!scalarMatch) {
      throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
        message: "SELECT list is missing or malformed",
        token: "SELECT",
      });
    }
    selectFields = scalarMatch[1]!.trim();
    // Use a special subquery table ref for scalar select without FROM
    // subquerySql is "SELECT __scalar__ FROM __scalar__" which parses as from.kind='table',
    // NOT from.kind='subquery', avoiding infinite recursion in query() materialization.
    // The scalar expression is stored in scalarExpr for direct evaluation by query().
    fromParsed = {
      from: {
        kind: "subquery",
        subquerySql: "SELECT __scalar__ FROM __scalar__",
        alias: "__scalar__",
        rewrittenSql: "SELECT __scalar__ FROM __scalar__",
        outerSelectItems: parseSelectItems(selectFields),
      },
      tail: "",
    };
  } else {
    fromParsed = parseFromRef(base);
    if (!fromParsed) {
      throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
        message: "SELECT statement is missing or has invalid FROM clause",
        token: "FROM",
      });
    }

    const fromPos = findFromAtDepthZero(base);
    if (fromPos === null) {
      throw createSqlError("SQL_SYNTAX_INCOMPLETE_STATEMENT", {
        message: "SELECT statement is missing or has invalid FROM clause",
        token: "FROM",
      });
    }
    // Everything between "SELECT " and FROM is the select list
    selectFields = base.substring("SELECT ".length, fromPos).trim();
  }

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
