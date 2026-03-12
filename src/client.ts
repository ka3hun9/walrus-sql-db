import { randomUUID, createHash } from "node:crypto";
import type {
  ExecuteResult,
  QueryProofResult,
  QueryResult,
  SqlPrimitive,
  SqlRow,
  WalrusSqlClientOptions,
} from "./types.js";
import { buildMoveCall } from "./onchain.js";

type CompareOp =
  | "="
  | "!="
  | "<>"
  | ">"
  | "<"
  | ">="
  | "<="
  | "IN"
  | "NOT_IN"
  | "IN_SUBQUERY"
  | "NOT_IN_SUBQUERY"
  | "BETWEEN"
  | "NOT_BETWEEN"
  | "LIKE"
  | "NOT_LIKE"
  | "IS_NULL"
  | "IS_NOT_NULL"
  | "IS_TRUE"
  | "IS_FALSE"
  | "IS_UNKNOWN"
  | "IS_NOT_TRUE"
  | "IS_NOT_FALSE"
  | "IS_NOT_UNKNOWN"
  | "IS_DISTINCT_FROM"
  | "IS_NOT_DISTINCT_FROM"
  | "EXISTS"
  | "NOT_EXISTS"
  | "ANY"
  | "ALL";
type LogicOp = "AND" | "OR";

type TruthValue = "TRUE" | "FALSE" | "UNKNOWN";

type ComparePredicate = "=" | "!=" | "<>" | ">" | "<" | ">=" | "<=";

type WhereClause = {
  logic?: LogicOp;
  field: string;
  op: CompareOp;
  value?: SqlPrimitive;
  values?: SqlPrimitive[];
  compareOp?: ComparePredicate;
  likeEscape?: string;
  subquerySql?: string;
};

type WhereExprNode =
  | { type: "clause"; clause: WhereClause }
  | { type: "not"; node: WhereExprNode }
  | { type: "and" | "or"; left: WhereExprNode; right: WhereExprNode };

type ParsedSelect = {
  explain: boolean;
  table: string;
  fields: string[] | ["*"];
  where?: string;
  whereClauses: WhereClause[];
  whereTree?: WhereExprNode;
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: "ASC" | "DESC";
  orderByList?: Array<{ field: string; direction: "ASC" | "DESC" }>;
  aggregate?: "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";
  aggregateField?: string;
  groupBy?: string[];
  having?: string;
  join?: {
    type: "INNER" | "LEFT" | "RIGHT";
    table: string;
    leftField: string;
    rightField: string;
  };
  rowNumberAlias?: string;
};

export class WalrusSqlClient {
  private readonly opts: WalrusSqlClientOptions;
  private readonly tables = new Map<string, SqlRow[]>();

  constructor(opts: WalrusSqlClientOptions) {
    this.opts = opts;
  }

  async execute(sql: string): Promise<ExecuteResult> {
    if ((this.opts.mode ?? "simulator") === "onchain") {
      return this.executeOnchain(sql);
    }
    return this.executeSimulator(sql);
  }

  private async executeOnchain(sql: string): Promise<ExecuteResult> {
    const moveCall = buildMoveCall({
      packageId: this.opts.packageId,
      moduleName: this.opts.moduleName,
      sql,
    });

    if (!this.opts.onchainExecutor) {
      return {
        txDigest: this.fakeDigest(`planned:${sql}`),
        statementType: moveCall.statementType,
        moveCall: {
          target: moveCall.target,
          arguments: moveCall.arguments,
          typeArguments: moveCall.typeArguments,
          tableName: moveCall.tableName,
        },
      };
    }

    const res = await this.opts.onchainExecutor(moveCall);
    return {
      txDigest: res.digest,
      raw: res.raw,
      tableObjectId: res.createdTableId,
      statementType: moveCall.statementType,
      moveCall: {
        target: moveCall.target,
        arguments: moveCall.arguments,
        typeArguments: moveCall.typeArguments,
        tableName: moveCall.tableName,
      },
    };
  }

  private async executeSimulator(sql: string): Promise<ExecuteResult> {
    const normalized = sql.trim().replace(/\s+/g, " ");
    const upper = normalized.toUpperCase();

    if (upper.startsWith("CREATE TABLE")) {
      const table = this.extractTableName(normalized, /CREATE TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
      if (!this.tables.has(table)) this.tables.set(table, []);
      return {
        txDigest: this.fakeDigest(normalized),
        statementType: "CREATE",
        tableObjectId: `0x${randomUUID().replace(/-/g, "")}`,
        affectedRows: 0,
      };
    }

    if (upper.startsWith("INSERT INTO")) {
      const table = this.extractTableName(normalized, /INSERT INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
      const row = this.parseInsert(normalized);
      const bucket = this.requireTable(table);
      bucket.push(row);
      return {
        txDigest: this.fakeDigest(normalized),
        statementType: "INSERT",
        affectedRows: 1,
      };
    }

    if (upper.startsWith("UPDATE")) {
      const table = this.extractTableName(normalized, /UPDATE\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
      const { setField, setValue, whereExpr } = this.parseUpdate(normalized);
      const whereTree = this.parseWhereTree(whereExpr);
      const bucket = this.requireTable(table);
      let touched = 0;
      for (const row of bucket) {
        if (this.evaluateWhereTree(row, whereTree) === "TRUE") {
          row[setField] = this.castValue(setValue);
          touched++;
        }
      }
      return {
        txDigest: this.fakeDigest(normalized),
        statementType: "UPDATE",
        affectedRows: touched,
      };
    }

    if (upper.startsWith("DELETE FROM")) {
      const table = this.extractTableName(normalized, /DELETE FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
      const { whereExpr } = this.parseDelete(normalized);
      const whereTree = this.parseWhereTree(whereExpr);
      const bucket = this.requireTable(table);
      const next = bucket.filter((row) => this.evaluateWhereTree(row, whereTree) !== "TRUE");
      const touched = bucket.length - next.length;
      this.tables.set(table, next);
      return {
        txDigest: this.fakeDigest(normalized),
        statementType: "DELETE",
        affectedRows: touched,
      };
    }

    return {
      txDigest: this.fakeDigest(normalized),
      statementType: "UNKNOWN",
      affectedRows: 0,
    };
  }

  async query(sql: string): Promise<QueryResult> {
    const unionSplit = this.splitUnion(sql);
    if (unionSplit) {
      const left = await this.query(unionSplit.left);
      const right = await this.query(unionSplit.right);
      if (unionSplit.all) {
        return { rows: [...left.rows, ...right.rows] };
      }
      const dedup = new Map<string, SqlRow>();
      for (const row of [...left.rows, ...right.rows]) {
        dedup.set(JSON.stringify(row), row);
      }
      return { rows: [...dedup.values()] };
    }

    const normalized = sql.trim().replace(/\s+/g, " ");
    const parsed = this.parseSelect(normalized, sql);

    if (parsed.explain) {
      return {
        rows: [
          {
            type: "EXPLAIN",
            table: parsed.table,
            where: parsed.where ?? null,
            groupBy: parsed.groupBy?.join(",") ?? null,
            aggregate: parsed.aggregate ?? null,
            orderBy: parsed.orderByList?.map((x) => `${x.field} ${x.direction}`).join(",") ?? null,
            limit: parsed.limit ?? null,
            offset: parsed.offset ?? null,
            mode: this.opts.mode ?? "simulator",
            join: parsed.join ? `${parsed.join.type} ${parsed.join.table} ON ${parsed.join.leftField}=${parsed.join.rightField}` : null,
          },
        ],
      };
    }

    if ((this.opts.mode ?? "simulator") === "onchain" && this.opts.onchainQueryExecutor) {
      return this.opts.onchainQueryExecutor({
        sql,
        table: parsed.table,
        fields: parsed.fields,
        where: parsed.where,
        limit: parsed.limit,
        offset: parsed.offset,
        orderBy: parsed.orderBy,
        orderDirection: parsed.orderDirection,
        orderByList: parsed.orderByList,
        aggregate: parsed.aggregate,
        aggregateField: parsed.aggregateField,
        groupBy: parsed.groupBy,
        having: parsed.having,
        explain: parsed.explain,
        join: parsed.join,
      });
    }

    const bucket = this.requireTable(parsed.table);
    const baseRows = parsed.join ? this.applyJoin(parsed.table, bucket, parsed.join) : bucket;
    const filtered = parsed.whereTree
      ? baseRows.filter((row) => this.evaluateWhereTree(row, parsed.whereTree!) === "TRUE")
      : parsed.whereClauses.length
        ? this.applyWhereClauses(baseRows, parsed.whereClauses)
        : baseRows;

    if (parsed.groupBy?.length) {
      const grouped = this.groupRows(filtered, parsed.groupBy, parsed.aggregate, parsed.aggregateField);
      const havingRows = parsed.having ? this.applyWhereClauses(grouped, this.parseWhere(parsed.having)) : grouped;
      const orderedGrouped = this.applyOrder(havingRows, parsed.orderByList);
      const pagedGrouped = this.applyPage(orderedGrouped, parsed.offset, parsed.limit);
      return {
        rows: pagedGrouped.map((row) => this.pickFields(row, parsed.fields)),
      };
    }

    if (parsed.aggregate) {
      return {
        rows: [this.computeAggregateRow(filtered, parsed.aggregate, parsed.aggregateField)],
      };
    }

    const ordered = this.applyOrder(filtered, parsed.orderByList);
    const withWindow = parsed.rowNumberAlias
      ? ordered.map((row, idx) => ({ ...row, [parsed.rowNumberAlias!]: idx + 1 }))
      : ordered;
    const paged = this.applyPage(withWindow, parsed.offset, parsed.limit);

    return {
      rows: paged.map((row) => this.pickFields(row, parsed.fields)),
    };
  }

  async queryOne(sql: string): Promise<SqlRow | null> {
    const result = await this.query(sql);
    return result.rows[0] ?? null;
  }

  async queryWithProof(sql: string): Promise<QueryProofResult> {
    const result = await this.query(sql);
    return {
      ...result,
      proof: {
        manifestHash: this.fakeDigest(`manifest:${sql}`),
        indexRoot: this.fakeDigest(`index:${sql}`),
        blockHeight: Math.floor(Date.now() / 1000),
        txDigest: this.fakeDigest(sql),
      },
    };
  }

  async verify(result: QueryProofResult): Promise<boolean> {
    return Boolean(result.proof.manifestHash && result.proof.indexRoot && result.proof.txDigest);
  }

  private splitUnion(sql: string): { left: string; right: string; all: boolean } | null {
    const mAll = sql.match(/^(.*)\s+UNION\s+ALL\s+(.*)$/i);
    if (mAll) return { left: mAll[1].trim(), right: mAll[2].trim(), all: true };

    const m = sql.match(/^(.*)\s+UNION\s+(.*)$/i);
    if (m) return { left: m[1].trim(), right: m[2].trim(), all: false };

    return null;
  }

  private fakeDigest(input: string): string {
    return createHash("sha256")
      .update(`${this.opts.network}:${this.opts.packageId}:${input}`)
      .digest("hex")
      .slice(0, 40);
  }

  private requireTable(name: string): SqlRow[] {
    const table = this.tables.get(name);
    if (!table) throw new Error(`Table not found: ${name}`);
    return table;
  }

  private extractTableName(sql: string, pattern: RegExp): string {
    const m = sql.match(pattern);
    if (!m) throw new Error(`Unable to parse table name from SQL: ${sql}`);
    return m[1];
  }

  private parseInsert(sql: string): SqlRow {
    const m = sql.match(/INSERT INTO\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\((.+)\)\s*VALUES\s*\((.+)\)/i);
    if (!m) throw new Error(`Unsupported INSERT syntax: ${sql}`);
    const cols = m[1].split(",").map((c) => c.trim());
    const vals = this.smartSplit(m[2]).map((v) => this.castValue(v));
    if (cols.length !== vals.length) throw new Error(`INSERT column/value mismatch`);
    const row: SqlRow = {};
    cols.forEach((c, i) => (row[c] = vals[i]));
    return row;
  }

  private parseUpdate(sql: string): { setField: string; setValue: string; whereExpr: string } {
    const m = sql.match(
      /UPDATE\s+[a-zA-Z_][a-zA-Z0-9_]*\s+SET\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+?)\s+WHERE\s+(.+)/i,
    );
    if (!m) throw new Error(`Unsupported UPDATE syntax: ${sql}`);
    return {
      setField: m[1].trim(),
      setValue: this.trimQuoted(m[2].trim()),
      whereExpr: m[3].trim(),
    };
  }

  private parseDelete(sql: string): { whereExpr: string } {
    const m = sql.match(
      /DELETE FROM\s+[a-zA-Z_][a-zA-Z0-9_]*\s+WHERE\s+(.+)/i,
    );
    if (!m) throw new Error(`Unsupported DELETE syntax: ${sql}`);
    return {
      whereExpr: m[1].trim(),
    };
  }

  private parseSelect(normalizedSql: string, rawSql: string): ParsedSelect {
    const explain = /^EXPLAIN\s+/i.test(normalizedSql);
    const base = explain ? normalizedSql.replace(/^EXPLAIN\s+/i, "") : normalizedSql;

    const m = base.match(/^SELECT\s+(.+?)\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)\b(.*)$/i);
    if (!m) throw new Error(`Unsupported SELECT: ${rawSql}`);

    const selectFields = m[1].trim();
    const table = m[2];
    let tail = m[3] ?? "";
    let join: ParsedSelect["join"];

    const joinMatch = tail.match(
      /^\s+(INNER|LEFT|RIGHT)\s+JOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+ON\s+([a-zA-Z_][a-zA-Z0-9_\.]*)\s*=\s*([a-zA-Z_][a-zA-Z0-9_\.]*)\s*(.*)$/i,
    );
    if (joinMatch) {
      join = {
        type: joinMatch[1].toUpperCase() as "INNER" | "LEFT" | "RIGHT",
        table: joinMatch[2],
        leftField: joinMatch[3],
        rightField: joinMatch[4],
      };
      tail = joinMatch[5] ?? "";
    }

    const tm = tail.match(
      /^(?:\s*WHERE\s+(.+?))?(?:\s*GROUP BY\s+(.+?))?(?:\s*HAVING\s+(.+?))?(?:\s*ORDER BY\s+(.+?))?(?:\s*LIMIT\s+(\d+))?(?:\s*OFFSET\s+(\d+))?\s*$/i,
    );
    if (!tm) throw new Error(`Unsupported SELECT clauses: ${rawSql}`);

    const where = tm[1]?.trim();
    const groupBy = tm[2]?.split(",").map((x) => x.trim()).filter(Boolean);
    const having = tm[3]?.trim();
    const orderByText = tm[4]?.trim();
    const limit = tm[5] ? Number(tm[5]) : undefined;
    const offset = tm[6] ? Number(tm[6]) : undefined;

    const orderByList = orderByText
      ? orderByText
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
          .map((part) => {
            const om = part.match(/^([a-zA-Z_][a-zA-Z0-9_\.]*)((?:\s+(?:ASC|DESC))?)$/i);
            if (!om) throw new Error(`Unsupported ORDER BY segment: ${part}`);
            const dir = om[2]?.trim().toUpperCase() as "ASC" | "DESC" | "";
            return { field: om[1], direction: (dir || "ASC") as "ASC" | "DESC" };
          })
      : undefined;

    const rawFieldList = selectFields.split(",").map((x) => x.trim());
    const rowNumberExpr = rawFieldList.find((f) => /^ROW_NUMBER\(\)\s+OVER\s*\(.+\)(?:\s+AS\s+[a-zA-Z_][a-zA-Z0-9_]*)?$/i.test(f));
    const rowNumberAlias = rowNumberExpr?.match(/\s+AS\s+([a-zA-Z_][a-zA-Z0-9_]*)$/i)?.[1] ?? "row_number";

    const aggregateFieldExpr = rawFieldList.find((f) => /^(COUNT|SUM|AVG|MIN|MAX)\((\*|[a-zA-Z_][a-zA-Z0-9_]*)\)$/i.test(f));

    const aggregateMatch = aggregateFieldExpr?.match(/^(COUNT|SUM|AVG|MIN|MAX)\((\*|[a-zA-Z_][a-zA-Z0-9_]*)\)$/i);
    const aggregate = aggregateMatch?.[1]?.toUpperCase() as ParsedSelect["aggregate"] | undefined;
    const aggregateField = aggregateMatch?.[2];

    const whereClauses = where ? this.tryParseWhere(where) : [];
    const whereTree = where ? this.parseWhereTree(where) : undefined;

    const normalizedFieldList = rawFieldList.map((f) => {
      const aliasMatch = f.match(/^(.+?)\s+AS\s+([a-zA-Z_][a-zA-Z0-9_]*)$/i);
      if (/^ROW_NUMBER\(\)\s+OVER\s*\(.+\)(?:\s+AS\s+[a-zA-Z_][a-zA-Z0-9_]*)?$/i.test(f)) {
        return rowNumberAlias;
      }
      if (aliasMatch) return aliasMatch[2];
      const agg = f.match(/^(COUNT|SUM|AVG|MIN|MAX)\((\*|[a-zA-Z_][a-zA-Z0-9_]*)\)$/i);
      if (agg) return agg[1].toLowerCase();
      return f;
    });

    if (aggregate) {
      return {
        explain,
        table,
        fields: normalizedFieldList as string[],
        where,
        whereClauses,
        whereTree,
        limit,
        offset,
        orderBy: orderByList?.[0]?.field,
        orderDirection: orderByList?.[0]?.direction,
        orderByList,
        aggregate,
        aggregateField,
        groupBy,
        having,
        join,
        rowNumberAlias: rowNumberExpr ? rowNumberAlias : undefined,
      };
    }

    if (selectFields === "*") {
      return {
        explain,
        table,
        fields: ["*"],
        where,
        whereClauses,
        whereTree,
        limit,
        offset,
        orderBy: orderByList?.[0]?.field,
        orderDirection: orderByList?.[0]?.direction,
        orderByList,
        groupBy,
        having,
        join,
        rowNumberAlias: rowNumberExpr ? rowNumberAlias : undefined,
      };
    }

    return {
      explain,
      table,
      fields: normalizedFieldList as string[],
      where,
      whereClauses,
      whereTree,
      limit,
      offset,
      orderBy: orderByList?.[0]?.field,
      orderDirection: orderByList?.[0]?.direction,
      orderByList,
      groupBy,
      having,
      join,
      rowNumberAlias: rowNumberExpr ? rowNumberAlias : undefined,
    };
  }

  private applyJoin(
    leftTable: string,
    leftRows: SqlRow[],
    join: NonNullable<ParsedSelect["join"]>,
  ): SqlRow[] {
    if (join.type === "RIGHT") {
      const syntheticLeftRows = this.requireTable(join.table);
      const syntheticJoin: NonNullable<ParsedSelect["join"]> = {
        type: "LEFT",
        table: leftTable,
        leftField: join.rightField,
        rightField: join.leftField,
      };
      return this.applyJoin(join.table, syntheticLeftRows, syntheticJoin);
    }

    const rightRows = this.requireTable(join.table);
    const leftField = join.leftField.includes(".") ? join.leftField.split(".")[1] : join.leftField;
    const rightField = join.rightField.includes(".") ? join.rightField.split(".")[1] : join.rightField;

    const out: SqlRow[] = [];
    for (const l of leftRows) {
      let matched = false;
      for (const r of rightRows) {
        if (String(l[leftField]) !== String(r[rightField])) continue;
        matched = true;
        const merged: SqlRow = {};

        for (const [k, v] of Object.entries(l)) {
          merged[k] = v;
          merged[`${leftTable}.${k}`] = v;
        }
        for (const [k, v] of Object.entries(r)) {
          merged[`${join.table}.${k}`] = v;
          if (!(k in merged)) merged[k] = v;
        }

        out.push(merged);
      }

      if (!matched && join.type === "LEFT") {
        const merged: SqlRow = {};
        for (const [k, v] of Object.entries(l)) {
          merged[k] = v;
          merged[`${leftTable}.${k}`] = v;
        }
        out.push(merged);
      }
    }
    return out;
  }

  private parseWhereTree(whereExpr: string): WhereExprNode {
    const expr = this.trimOuterParentheses(whereExpr.trim());

    const orSplit = this.findTopLevelLogic(expr, "OR");
    if (orSplit) {
      return {
        type: "or",
        left: this.parseWhereTree(orSplit.left),
        right: this.parseWhereTree(orSplit.right),
      };
    }

    const andSplit = this.findTopLevelLogic(expr, "AND");
    if (andSplit) {
      return {
        type: "and",
        left: this.parseWhereTree(andSplit.left),
        right: this.parseWhereTree(andSplit.right),
      };
    }

    const notMatch = expr.match(/^NOT\s+(.+)$/i);
    if (notMatch) {
      return {
        type: "not",
        node: this.parseWhereTree(notMatch[1].trim()),
      };
    }

    return { type: "clause", clause: this.parseAtomicWhereClause(expr) };
  }

  private trimOuterParentheses(expr: string): string {
    let out = expr;
    while (out.startsWith("(") && out.endsWith(")")) {
      let depth = 0;
      let valid = true;
      for (let i = 0; i < out.length; i++) {
        const ch = out[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        if (depth === 0 && i < out.length - 1) {
          valid = false;
          break;
        }
      }
      if (!valid) break;
      out = out.slice(1, -1).trim();
    }
    return out;
  }

  private findTopLevelLogic(expr: string, op: "AND" | "OR"): { left: string; right: string } | null {
    let depth = 0;
    let quote = "";
    let pendingBetween = false;
    let word = "";

    const flushWord = () => {
      if (!word) return;
      if (word.toUpperCase() === "BETWEEN") pendingBetween = true;
      word = "";
    };

    const needle = ` ${op} `;
    for (let i = 0; i <= expr.length - needle.length; i++) {
      const ch = expr[i];

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
        flushWord();
        continue;
      }
      if (ch === ")") {
        depth = Math.max(0, depth - 1);
        flushWord();
        continue;
      }

      if (/\s/.test(ch)) {
        flushWord();
      } else {
        word += ch;
      }

      if (depth === 0 && expr.slice(i, i + needle.length).toUpperCase() === needle) {
        if (op === "AND" && pendingBetween) {
          pendingBetween = false;
          continue;
        }
        return {
          left: expr.slice(0, i).trim(),
          right: expr.slice(i + needle.length).trim(),
        };
      }
    }
    return null;
  }

  private splitWhereTokens(whereExpr: string): string[] {
    const src = whereExpr.trim();
    const out: string[] = [];
    let buf = "";
    let depth = 0;
    let quote = "";
    let pendingBetween = false;
    let word = "";

    const flush = () => {
      const t = buf.trim();
      if (t) out.push(t);
      buf = "";
    };

    const flushWord = () => {
      if (!word) return;
      if (word.toUpperCase() === "BETWEEN") pendingBetween = true;
      word = "";
    };

    for (let i = 0; i < src.length; i++) {
      const ch = src[i];

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

      if (ch === "(") {
        depth++;
        flushWord();
        buf += ch;
        continue;
      }
      if (ch === ")") {
        depth = Math.max(0, depth - 1);
        flushWord();
        buf += ch;
        continue;
      }

      if (/\s/.test(ch)) {
        flushWord();
      } else {
        word += ch;
      }

      if (depth === 0) {
        const rest = src.slice(i).toUpperCase();
        if (rest.startsWith(" AND ")) {
          if (pendingBetween) {
            pendingBetween = false;
          } else {
            flush();
            out.push("AND");
            i += 4;
            continue;
          }
        }
        if (rest.startsWith(" OR ")) {
          flush();
          out.push("OR");
          i += 3;
          continue;
        }
      }

      buf += ch;
    }

    flush();
    return out;
  }

  private parseWhere(whereExpr: string): WhereClause[] {
    const tokens = this.splitWhereTokens(whereExpr);
    const out: WhereClause[] = [];
    let pendingLogic: LogicOp | undefined;

    for (const token of tokens) {
      const upper = token.toUpperCase();
      if (upper === "AND" || upper === "OR") {
        pendingLogic = upper;
        continue;
      }

      const clause = this.parseAtomicWhereClause(token);
      clause.logic = pendingLogic;
      out.push(clause);
      pendingLogic = undefined;
    }

    return out;
  }

  private tryParseWhere(whereExpr: string): WhereClause[] {
    try {
      return this.parseWhere(whereExpr);
    } catch {
      return [];
    }
  }

  private parseAtomicWhereClause(token: string): WhereClause {
    const expr = this.trimOuterParentheses(token.trim());

    const existsSubquery = this.parseExistsSubquery(expr);
    if (existsSubquery) {
      return {
        field: "__exists__",
        op: existsSubquery.not ? "NOT_EXISTS" : "EXISTS",
        value: existsSubquery.subquerySql,
      };
    }

    const anyAllMatch = this.parseAnyAllPredicate(expr);
    if (anyAllMatch) {
      return {
        field: anyAllMatch.field,
        op: anyAllMatch.quantifier,
        compareOp: anyAllMatch.compareOp,
        value: anyAllMatch.subquerySql,
      };
    }

    const cmpSubqueryMatch = expr.match(
      /^([a-zA-Z_][a-zA-Z0-9_\.]*)\s*(=|!=|<>|>=|<=|>|<)\s*\(\s*(SELECT\s+.+)\s*\)$/i,
    );
    if (cmpSubqueryMatch) {
      return {
        field: cmpSubqueryMatch[1],
        op: cmpSubqueryMatch[2] as CompareOp,
        subquerySql: cmpSubqueryMatch[3],
      };
    }

    const truthPredMatch = expr.match(/^([a-zA-Z_][a-zA-Z0-9_\.]*)\s+IS\s+(NOT\s+)?(TRUE|FALSE|UNKNOWN)$/i);
    if (truthPredMatch) {
      const subject = truthPredMatch[3]!.toUpperCase();
      const isNot = Boolean(truthPredMatch[2]);
      const op =
        subject === "TRUE"
          ? (isNot ? "IS_NOT_TRUE" : "IS_TRUE")
          : subject === "FALSE"
            ? (isNot ? "IS_NOT_FALSE" : "IS_FALSE")
            : (isNot ? "IS_NOT_UNKNOWN" : "IS_UNKNOWN");
      return {
        field: truthPredMatch[1],
        op,
      };
    }

    const distinctMatch = expr.match(/^([a-zA-Z_][a-zA-Z0-9_\.]*)\s+IS\s+(NOT\s+)?DISTINCT\s+FROM\s+(.+)$/i);
    if (distinctMatch) {
      return {
        field: distinctMatch[1],
        op: distinctMatch[2] ? "IS_NOT_DISTINCT_FROM" : "IS_DISTINCT_FROM",
        value: this.castValue(distinctMatch[3]),
      };
    }

    const nullMatch = expr.match(/^([a-zA-Z_][a-zA-Z0-9_\.]*)\s+IS\s+(NOT\s+)?NULL$/i);
    if (nullMatch) {
      return {
        field: nullMatch[1],
        op: nullMatch[2] ? "IS_NOT_NULL" : "IS_NULL",
      };
    }

    const betweenMatch = expr.match(/^([a-zA-Z_][a-zA-Z0-9_\.]*)\s+(NOT\s+)?BETWEEN\s+(.+)\s+AND\s+(.+)$/i);
    if (betweenMatch) {
      return {
        field: betweenMatch[1],
        op: betweenMatch[2] ? "NOT_BETWEEN" : "BETWEEN",
        values: [this.castValue(betweenMatch[3]), this.castValue(betweenMatch[4])],
      };
    }

    const likeMatch = expr.match(/^([a-zA-Z_][a-zA-Z0-9_\.]*)\s+(NOT\s+)?LIKE\s+(.+?)(?:\s+ESCAPE\s+(.+))?$/i);
    if (likeMatch) {
      const escRaw = likeMatch[4] ? this.trimQuoted(likeMatch[4].trim()) : undefined;
      const esc = escRaw && escRaw.length > 0 ? escRaw[0] : undefined;
      return {
        field: likeMatch[1],
        op: likeMatch[2] ? "NOT_LIKE" : "LIKE",
        value: this.castValue(likeMatch[3]),
        likeEscape: esc,
      };
    }

    const inSubqueryMatch = expr.match(/^([a-zA-Z_][a-zA-Z0-9_\.]*)\s+(NOT\s+)?IN\s*\(\s*(SELECT\s+.+)\s*\)$/i);
    if (inSubqueryMatch) {
      return {
        field: inSubqueryMatch[1],
        op: inSubqueryMatch[2] ? "NOT_IN_SUBQUERY" : "IN_SUBQUERY",
        subquerySql: inSubqueryMatch[3],
      };
    }

    const inMatch = expr.match(/^([a-zA-Z_][a-zA-Z0-9_\.]*)\s+(NOT\s+)?IN\s*\((.+)\)$/i);
    if (inMatch) {
      return {
        field: inMatch[1],
        op: inMatch[2] ? "NOT_IN" : "IN",
        values: this.smartSplit(inMatch[3]).map((v) => this.castValue(v)),
      };
    }

    const cmpMatch = expr.match(/^([a-zA-Z_][a-zA-Z0-9_\.]*)\s*(=|!=|<>|>=|<=|>|<)\s*(.+)$/i);
    if (cmpMatch) {
      return {
        field: cmpMatch[1],
        op: cmpMatch[2] as CompareOp,
        value: this.castValue(cmpMatch[3]),
      };
    }

    throw new Error(`Unsupported WHERE expression: ${token}`);
  }

  private parseSubquerySelect(subquerySql: string, outerRow?: SqlRow): SqlRow[] {
    const normalized = subquerySql.trim().replace(/\s+/g, " ");
    const m = normalized.match(/^SELECT\s+(.+?)\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+WHERE\s+(.+))?$/i);
    if (!m) throw new Error(`Unsupported subquery syntax: ${subquerySql}`);

    const fieldExpr = m[1]!.trim();
    const table = m[2]!.trim();
    const where = m[3]?.trim();

    const rows = this.requireTable(table);
    const boundWhere = where && outerRow ? this.bindOuterRefs(where, outerRow) : where;
    const filtered = boundWhere
      ? rows.filter((r) => this.evaluateWhereTree(r, this.parseWhereTree(boundWhere)) === "TRUE")
      : rows;

    if (fieldExpr === "*") return filtered.map((r) => ({ ...r }));

    const fields = fieldExpr.split(",").map((x) => x.trim()).filter(Boolean);
    return filtered.map((row) => {
      const out: SqlRow = {};
      for (const f of fields) out[f] = row[f] ?? null;
      return out;
    });
  }

  private parseSubqueryValues(subquerySql: string, field?: string, outerRow?: SqlRow): SqlPrimitive[] {
    const rows = this.parseSubquerySelect(subquerySql, outerRow);
    if (!rows.length) return [];

    if (field) {
      return rows.map((r) => r[field] ?? null);
    }

    const firstRow = rows[0]!;
    const keys = Object.keys(firstRow);
    if (keys.length !== 1) throw new Error(`Subquery must return exactly 1 column: ${subquerySql}`);
    const key = keys[0]!;
    return rows.map((r) => r[key] ?? null);
  }

  private parseExistsSubquery(expr: string): { not: boolean; subquerySql: string } | null {
    const m = expr.match(/^(NOT\s+)?EXISTS\s*\((SELECT\s+.+)\)$/i);
    if (!m) return null;
    return {
      not: Boolean(m[1]),
      subquerySql: m[2]!.trim(),
    };
  }

  private parseAnyAllPredicate(expr: string):
    | { field: string; compareOp: ComparePredicate; quantifier: "ANY" | "ALL"; subquerySql: string }
    | null {
    const m = expr.match(
      /^([a-zA-Z_][a-zA-Z0-9_\.]*)\s*(=|!=|<>|>=|<=|>|<)\s*(ANY|SOME|ALL)\s*\((SELECT\s+.+)\)$/i,
    );
    if (!m) return null;
    return {
      field: m[1]!,
      compareOp: m[2] as ComparePredicate,
      quantifier: m[3]!.toUpperCase() === "SOME" ? "ANY" : (m[3]!.toUpperCase() as "ANY" | "ALL"),
      subquerySql: m[4]!.trim(),
    };
  }

  private bindOuterRefs(expr: string, outerRow: SqlRow): string {
    return expr.replace(/\bouter\.([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (_m, key: string) => {
      const v = outerRow[key];
      if (v === null || v === undefined) return "NULL";
      if (typeof v === "number") return String(v);
      if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
      const s = String(v).replace(/'/g, "''");
      return `'${s}'`;
    });
  }

  private resolveRowValue(row: SqlRow, field: string): SqlPrimitive | undefined {
    return row[field] as SqlPrimitive | undefined;
  }

  private compareByOp(left: SqlPrimitive | undefined, right: SqlPrimitive | undefined, op: ComparePredicate): TruthValue {
    if (left == null || right == null) return "UNKNOWN";

    switch (op) {
      case "=":
        return this.eq(left, right) ? "TRUE" : "FALSE";
      case "!=":
      case "<>":
        return this.eq(left, right) ? "FALSE" : "TRUE";
      case ">":
        return this.compare(left, right) > 0 ? "TRUE" : "FALSE";
      case "<":
        return this.compare(left, right) < 0 ? "TRUE" : "FALSE";
      case ">=":
        return this.compare(left, right) >= 0 ? "TRUE" : "FALSE";
      case "<=":
        return this.compare(left, right) <= 0 ? "TRUE" : "FALSE";
      default:
        return "FALSE";
    }
  }

  private tvNot(v: TruthValue): TruthValue {
    if (v === "TRUE") return "FALSE";
    if (v === "FALSE") return "TRUE";
    return "UNKNOWN";
  }

  private tvAnd(a: TruthValue, b: TruthValue): TruthValue {
    if (a === "FALSE" || b === "FALSE") return "FALSE";
    if (a === "TRUE" && b === "TRUE") return "TRUE";
    return "UNKNOWN";
  }

  private tvOr(a: TruthValue, b: TruthValue): TruthValue {
    if (a === "TRUE" || b === "TRUE") return "TRUE";
    if (a === "FALSE" && b === "FALSE") return "FALSE";
    return "UNKNOWN";
  }

  private truthEq(a: TruthValue, b: TruthValue): boolean {
    return a === b;
  }

  private valueToTruth(value: SqlPrimitive | undefined): TruthValue {
    if (value === null || value === undefined) return "UNKNOWN";
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    const s = String(value).toUpperCase();
    if (s === "TRUE") return "TRUE";
    if (s === "FALSE") return "FALSE";
    return "UNKNOWN";
  }

  private evaluateWhereTree(row: SqlRow, node: WhereExprNode): TruthValue {
    if (node.type === "clause") return this.evaluateClause(row, node.clause);
    if (node.type === "not") return this.tvNot(this.evaluateWhereTree(row, node.node));
    if (node.type === "and") return this.tvAnd(this.evaluateWhereTree(row, node.left), this.evaluateWhereTree(row, node.right));
    return this.tvOr(this.evaluateWhereTree(row, node.left), this.evaluateWhereTree(row, node.right));
  }

  private applyWhereClauses(rows: SqlRow[], clauses: WhereClause[]): SqlRow[] {
    return rows.filter((row) => {
      let acc: TruthValue | null = null;
      for (const c of clauses) {
        const matched = this.evaluateClause(row, c);
        if (acc === null) {
          acc = matched;
        } else if (c.logic === "OR") {
          acc = this.tvOr(acc, matched);
        } else {
          acc = this.tvAnd(acc, matched);
        }
      }
      return acc === "TRUE";
    });
  }

  private likeToRegex(patternRaw: string, escapeChar?: string): string {
    const escaped = /[.*+?^${}()|[\]\\]/;
    let out = "";

    for (let i = 0; i < patternRaw.length; i++) {
      const ch = patternRaw[i]!;
      if (escapeChar && ch === escapeChar) {
        const next = patternRaw[i + 1];
        if (next !== undefined) {
          out += escaped.test(next) ? `\\${next}` : next;
          i++;
          continue;
        }
      }

      if (ch === "%") {
        out += ".*";
      } else if (ch === "_") {
        out += ".";
      } else {
        out += escaped.test(ch) ? `\\${ch}` : ch;
      }
    }

    return `^${out}$`;
  }

  private evaluateClause(row: SqlRow, clause: WhereClause): TruthValue {
    const left = this.resolveRowValue(row, clause.field);

    if (clause.op === "EXISTS" || clause.op === "NOT_EXISTS") {
      const subquerySql = String(clause.value ?? "");
      const exists = this.parseSubquerySelect(subquerySql, row).length > 0;
      const tv: TruthValue = exists ? "TRUE" : "FALSE";
      return clause.op === "EXISTS" ? tv : this.tvNot(tv);
    }

    if (clause.op === "ANY" || clause.op === "ALL") {
      const subquerySql = String(clause.value ?? "");
      const values = this.parseSubqueryValues(subquerySql, undefined, row);
      const cmp = clause.compareOp ?? "=";

      if (!values.length) {
        return clause.op === "ALL" ? "TRUE" : "FALSE";
      }

      if (clause.op === "ANY") {
        let hasUnknown = false;
        for (const v of values) {
          const t = this.compareByOp(left, v, cmp);
          if (t === "TRUE") return "TRUE";
          if (t === "UNKNOWN") hasUnknown = true;
        }
        return hasUnknown ? "UNKNOWN" : "FALSE";
      }

      let hasUnknown = false;
      for (const v of values) {
        const t = this.compareByOp(left, v, cmp);
        if (t === "FALSE") return "FALSE";
        if (t === "UNKNOWN") hasUnknown = true;
      }
      return hasUnknown ? "UNKNOWN" : "TRUE";
    }

    if (clause.op === "IN_SUBQUERY" || clause.op === "NOT_IN_SUBQUERY") {
      const values = this.parseSubqueryValues(clause.subquerySql ?? "", undefined, row);
      let hasUnknown = false;
      for (const v of values) {
        const t = this.compareByOp(left, v, "=");
        if (t === "TRUE") return clause.op === "IN_SUBQUERY" ? "TRUE" : "FALSE";
        if (t === "UNKNOWN") hasUnknown = true;
      }
      if (hasUnknown) return "UNKNOWN";
      return clause.op === "IN_SUBQUERY" ? "FALSE" : "TRUE";
    }

    if (clause.op === "IN" || clause.op === "NOT_IN") {
      const values = clause.values ?? [];
      let hasUnknown = false;
      for (const v of values) {
        const t = this.compareByOp(left, v, "=");
        if (t === "TRUE") return clause.op === "IN" ? "TRUE" : "FALSE";
        if (t === "UNKNOWN") hasUnknown = true;
      }
      if (hasUnknown) return "UNKNOWN";
      return clause.op === "IN" ? "FALSE" : "TRUE";
    }

    if (clause.op === "BETWEEN" || clause.op === "NOT_BETWEEN") {
      const lower = clause.values?.[0];
      const upper = clause.values?.[1];
      const ge = this.compareByOp(left, lower, ">=");
      const le = this.compareByOp(left, upper, "<=");
      const inRange = this.tvAnd(ge, le);
      return clause.op === "BETWEEN" ? inRange : this.tvNot(inRange);
    }

    const right = clause.subquerySql
      ? this.parseSubqueryValues(clause.subquerySql, undefined, row)[0] ?? null
      : clause.value;
    switch (clause.op) {
      case "=":
      case "!=":
      case "<>":
      case ">":
      case "<":
      case ">=":
      case "<=":
        return this.compareByOp(left, right, clause.op as ComparePredicate);
      case "LIKE":
      case "NOT_LIKE": {
        if (left == null || right == null) return "UNKNOWN";
        const regex = this.likeToRegex(String(right ?? ""), clause.likeEscape);
        const matched = new RegExp(regex, "i").test(String(left ?? ""));
        const tv: TruthValue = matched ? "TRUE" : "FALSE";
        return clause.op === "LIKE" ? tv : this.tvNot(tv);
      }
      case "IS_NULL":
        return left === null || left === undefined ? "TRUE" : "FALSE";
      case "IS_NOT_NULL":
        return left === null || left === undefined ? "FALSE" : "TRUE";
      case "IS_TRUE":
        return this.truthEq(this.valueToTruth(left), "TRUE") ? "TRUE" : "FALSE";
      case "IS_FALSE":
        return this.truthEq(this.valueToTruth(left), "FALSE") ? "TRUE" : "FALSE";
      case "IS_UNKNOWN":
        return this.truthEq(this.valueToTruth(left), "UNKNOWN") ? "TRUE" : "FALSE";
      case "IS_NOT_TRUE":
        return this.truthEq(this.valueToTruth(left), "TRUE") ? "FALSE" : "TRUE";
      case "IS_NOT_FALSE":
        return this.truthEq(this.valueToTruth(left), "FALSE") ? "FALSE" : "TRUE";
      case "IS_NOT_UNKNOWN":
        return this.truthEq(this.valueToTruth(left), "UNKNOWN") ? "FALSE" : "TRUE";
      case "IS_DISTINCT_FROM": {
        if (left == null && right == null) return "FALSE";
        if (left == null || right == null) return "TRUE";
        return this.eq(left, right) ? "FALSE" : "TRUE";
      }
      case "IS_NOT_DISTINCT_FROM": {
        if (left == null && right == null) return "TRUE";
        if (left == null || right == null) return "FALSE";
        return this.eq(left, right) ? "TRUE" : "FALSE";
      }
      default:
        return "FALSE";
    }
  }

  private applyOrder(rows: SqlRow[], orderByList?: Array<{ field: string; direction: "ASC" | "DESC" }>): SqlRow[] {
    if (!orderByList?.length) return rows;
    return [...rows].sort((a, b) => {
      for (const { field, direction } of orderByList) {
        const cmp = this.compare(a[field], b[field]);
        if (cmp !== 0) return direction === "DESC" ? -cmp : cmp;
      }
      return 0;
    });
  }

  private applyPage(rows: SqlRow[], offset?: number, limit?: number): SqlRow[] {
    const from = offset ?? 0;
    const size = limit ?? rows.length;
    return rows.slice(from, from + size);
  }

  private groupRows(
    rows: SqlRow[],
    groupBy: string[],
    aggregate?: "COUNT" | "SUM" | "AVG" | "MIN" | "MAX",
    aggregateField?: string,
  ): SqlRow[] {
    const buckets = new Map<string, SqlRow[]>();

    for (const row of rows) {
      const key = groupBy.map((g) => String(row[g])).join("||");
      const bucket = buckets.get(key) ?? [];
      bucket.push(row);
      buckets.set(key, bucket);
    }

    const out: SqlRow[] = [];
    for (const bucketRows of buckets.values()) {
      const row: SqlRow = {};
      for (const g of groupBy) row[g] = bucketRows[0]?.[g] ?? null;

      if (aggregate) {
        Object.assign(row, this.computeAggregateRow(bucketRows, aggregate, aggregateField));
      }

      out.push(row);
    }

    return out;
  }

  private computeAggregateRow(
    rows: SqlRow[],
    aggregate: "COUNT" | "SUM" | "AVG" | "MIN" | "MAX",
    aggregateField?: string,
  ): SqlRow {
    if (aggregate === "COUNT") {
      return { count: rows.length };
    }

    if (!aggregateField || aggregateField === "*") {
      throw new Error(`${aggregate} requires a numeric field`);
    }

    const nums = rows.map((r) => Number(r[aggregateField])).filter((n) => Number.isFinite(n));

    if (aggregate === "SUM") return { sum: nums.reduce((a, b) => a + b, 0) };
    if (aggregate === "AVG") return { avg: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0 };
    if (aggregate === "MIN") return { min: nums.length ? Math.min(...nums) : null };
    return { max: nums.length ? Math.max(...nums) : null };
  }

  private pickFields(row: SqlRow, fields: string[] | ["*"]): SqlRow {
    if (fields.length === 1 && fields[0] === "*") return row;
    const out: SqlRow = {};
    for (const f of fields) out[f] = row[f] ?? null;
    return out;
  }

  private eq(a: SqlPrimitive | undefined, b: SqlPrimitive | undefined): boolean {
    if (a == null && b == null) return true;
    return String(a) === String(b);
  }

  private compare(a: SqlPrimitive | undefined, b: SqlPrimitive | undefined): number {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true });
  }

  private castValue(raw: string): string | number | boolean | null {
    const v = this.trimQuoted(raw.trim());
    if (v.toLowerCase() === "null") return null;
    if (v.toLowerCase() === "true") return true;
    if (v.toLowerCase() === "false") return false;
    if (!Number.isNaN(Number(v)) && v !== "") return Number(v);
    return v;
  }

  private smartSplit(input: string): string[] {
    const out: string[] = [];
    let buf = "";
    let quote = "";
    for (const ch of input) {
      if ((ch === "'" || ch === '"') && !quote) {
        quote = ch;
        buf += ch;
        continue;
      }
      if (ch === quote) {
        quote = "";
        buf += ch;
        continue;
      }
      if (ch === "," && !quote) {
        out.push(buf.trim());
        buf = "";
        continue;
      }
      buf += ch;
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
  }

  private trimQuoted(v: string): string {
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
      return v.slice(1, -1);
    }
    return v;
  }
}
