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

type CompareOp = "=" | "!=" | ">" | "<" | ">=" | "<=" | "IN";
type LogicOp = "AND" | "OR";

type WhereClause = {
  logic?: LogicOp;
  field: string;
  op: CompareOp;
  value?: SqlPrimitive;
  values?: SqlPrimitive[];
};

type ParsedSelect = {
  explain: boolean;
  table: string;
  fields: string[] | ["*"];
  where?: string;
  whereClauses: WhereClause[];
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
    type: "INNER";
    table: string;
    leftField: string;
    rightField: string;
  };
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
      const { setField, setValue, whereField, whereValue } = this.parseUpdate(normalized);
      const bucket = this.requireTable(table);
      let touched = 0;
      for (const row of bucket) {
        if (String(row[whereField]) === whereValue) {
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
      const { whereField, whereValue } = this.parseDelete(normalized);
      const bucket = this.requireTable(table);
      const next = bucket.filter((row) => String(row[whereField]) !== whereValue);
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
    const baseRows = parsed.join ? this.applyInnerJoin(parsed.table, bucket, parsed.join) : bucket;
    const filtered = parsed.whereClauses.length ? this.applyWhereClauses(baseRows, parsed.whereClauses) : baseRows;

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
    const paged = this.applyPage(ordered, parsed.offset, parsed.limit);

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

  private parseUpdate(sql: string): { setField: string; setValue: string; whereField: string; whereValue: string } {
    const m = sql.match(
      /UPDATE\s+[a-zA-Z_][a-zA-Z0-9_]*\s+SET\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)\s+WHERE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)/i,
    );
    if (!m) throw new Error(`Unsupported UPDATE syntax: ${sql}`);
    return {
      setField: m[1].trim(),
      setValue: this.trimQuoted(m[2].trim()),
      whereField: m[3].trim(),
      whereValue: this.trimQuoted(m[4].trim()),
    };
  }

  private parseDelete(sql: string): { whereField: string; whereValue: string } {
    const m = sql.match(
      /DELETE FROM\s+[a-zA-Z_][a-zA-Z0-9_]*\s+WHERE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)/i,
    );
    if (!m) throw new Error(`Unsupported DELETE syntax: ${sql}`);
    return {
      whereField: m[1].trim(),
      whereValue: this.trimQuoted(m[2].trim()),
    };
  }

  private parseSelect(normalizedSql: string, rawSql: string): ParsedSelect {
    const explain = /^EXPLAIN\s+/i.test(normalizedSql);
    const base = explain ? normalizedSql.replace(/^EXPLAIN\s+/i, "") : normalizedSql;

    const m = base.match(/^SELECT\s+(.+)\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)(.*)$/i);
    if (!m) throw new Error(`Unsupported SELECT: ${rawSql}`);

    const selectFields = m[1].trim();
    const table = m[2];
    let tail = m[3] ?? "";
    let join: ParsedSelect["join"];

    const joinMatch = tail.match(
      /^\s+INNER\s+JOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+ON\s+([a-zA-Z_][a-zA-Z0-9_\.]*)\s*=\s*([a-zA-Z_][a-zA-Z0-9_\.]*)\s*(.*)$/i,
    );
    if (joinMatch) {
      join = {
        type: "INNER",
        table: joinMatch[1],
        leftField: joinMatch[2],
        rightField: joinMatch[3],
      };
      tail = joinMatch[4] ?? "";
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
    const aggregateFieldExpr = rawFieldList.find((f) => /^(COUNT|SUM|AVG|MIN|MAX)\((\*|[a-zA-Z_][a-zA-Z0-9_]*)\)$/i.test(f));

    const aggregateMatch = aggregateFieldExpr?.match(/^(COUNT|SUM|AVG|MIN|MAX)\((\*|[a-zA-Z_][a-zA-Z0-9_]*)\)$/i);
    const aggregate = aggregateMatch?.[1]?.toUpperCase() as ParsedSelect["aggregate"] | undefined;
    const aggregateField = aggregateMatch?.[2];

    const whereClauses = where ? this.parseWhere(where) : [];

    const normalizedFieldList = rawFieldList.map((f) => {
      const aliasMatch = f.match(/^(.+?)\s+AS\s+([a-zA-Z_][a-zA-Z0-9_]*)$/i);
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
      };
    }

    if (selectFields === "*") {
      return {
        explain,
        table,
        fields: ["*"],
        where,
        whereClauses,
        limit,
        offset,
        orderBy: orderByList?.[0]?.field,
        orderDirection: orderByList?.[0]?.direction,
        orderByList,
        groupBy,
        having,
        join,
      };
    }

    return {
      explain,
      table,
      fields: selectFields.split(",").map((x) => x.trim()),
      where,
      whereClauses,
      limit,
      offset,
      orderBy: orderByList?.[0]?.field,
      orderDirection: orderByList?.[0]?.direction,
      orderByList,
      groupBy,
      having,
      join,
    };
  }

  private applyInnerJoin(
    leftTable: string,
    leftRows: SqlRow[],
    join: NonNullable<ParsedSelect["join"]>,
  ): SqlRow[] {
    const rightRows = this.requireTable(join.table);
    const leftField = join.leftField.includes(".") ? join.leftField.split(".")[1] : join.leftField;
    const rightField = join.rightField.includes(".") ? join.rightField.split(".")[1] : join.rightField;

    const out: SqlRow[] = [];
    for (const l of leftRows) {
      for (const r of rightRows) {
        if (String(l[leftField]) !== String(r[rightField])) continue;
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
    }
    return out;
  }

  private parseWhere(whereExpr: string): WhereClause[] {
    const tokens = whereExpr.split(/\s+(AND|OR)\s+/i).map((x) => x.trim()).filter(Boolean);
    const out: WhereClause[] = [];
    let pendingLogic: LogicOp | undefined;

    for (const token of tokens) {
      const upper = token.toUpperCase();
      if (upper === "AND" || upper === "OR") {
        pendingLogic = upper;
        continue;
      }

      const inMatch = token.match(/^([a-zA-Z_][a-zA-Z0-9_\.]+)\s+IN\s*\((.+)\)$/i);
      if (inMatch) {
        out.push({
          logic: pendingLogic,
          field: inMatch[1],
          op: "IN",
          values: this.smartSplit(inMatch[2]).map((v) => this.castValue(v)),
        });
        pendingLogic = undefined;
        continue;
      }

      const cmpMatch = token.match(/^([a-zA-Z_][a-zA-Z0-9_\.]*)\s*(=|!=|>=|<=|>|<)\s*(.+)$/i);
      if (!cmpMatch) throw new Error(`Unsupported WHERE expression: ${whereExpr}`);

      out.push({
        logic: pendingLogic,
        field: cmpMatch[1],
        op: cmpMatch[2] as CompareOp,
        value: this.castValue(cmpMatch[3]),
      });
      pendingLogic = undefined;
    }

    return out;
  }

  private applyWhereClauses(rows: SqlRow[], clauses: WhereClause[]): SqlRow[] {
    return rows.filter((row) => {
      let acc: boolean | null = null;
      for (const c of clauses) {
        const matched = this.evaluateClause(row, c);
        if (acc === null) {
          acc = matched;
        } else if (c.logic === "OR") {
          acc = acc || matched;
        } else {
          acc = acc && matched;
        }
      }
      return Boolean(acc);
    });
  }

  private evaluateClause(row: SqlRow, clause: WhereClause): boolean {
    const left = row[clause.field];

    if (clause.op === "IN") {
      return (clause.values ?? []).some((v) => this.eq(left, v));
    }

    const right = clause.value;
    switch (clause.op) {
      case "=":
        return this.eq(left, right);
      case "!=":
        return !this.eq(left, right);
      case ">":
        return this.compare(left, right) > 0;
      case "<":
        return this.compare(left, right) < 0;
      case ">=":
        return this.compare(left, right) >= 0;
      case "<=":
        return this.compare(left, right) <= 0;
      default:
        return false;
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
