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

function parseExpr(input: string): ExprAst {
  const s = input.trim();
  if (/^[a-zA-Z_][a-zA-Z0-9_\.]*$/.test(s)) return { kind: "identifier", name: s };
  if (/^(null|true|false|\-?\d+(?:\.\d+)?)$/i.test(s) || /^'.*'$/.test(s) || /^".*"$/.test(s)) {
    return { kind: "literal", value: castLiteral(s) };
  }
  const fm = s.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\((.*)\)$/);
  if (fm) {
    const argsRaw = fm[2].trim();
    const args = argsRaw ? splitCommaAware(argsRaw).map(parseExpr) : [];
    return { kind: "function", name: fm[1]!.toUpperCase(), args };
  }
  return { kind: "raw", text: s };
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
    groupBy: groupBy ? splitCommaAware(groupBy).map(parseExpr) : undefined,
    having: having ? parseExpr(having) : undefined,
    orderBy: parseOrderItems(orderBy),
    limit,
    offset,
    join,
    rawSql: sql,
  };

  return ast;
}
