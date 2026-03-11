import { randomUUID, createHash } from "node:crypto";
import type {
  ExecuteResult,
  QueryProofResult,
  QueryResult,
  SqlRow,
  WalrusSqlClientOptions,
} from "./types.js";
import { buildMoveCall } from "./onchain.js";

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
        aggregate: parsed.aggregate,
      });
    }

    const bucket = this.requireTable(parsed.table);
    const filtered = parsed.where ? this.applyWhere(bucket, parsed.where) : bucket;

    if (parsed.aggregate === "COUNT") {
      return { rows: [{ count: filtered.length }] };
    }

    const ordered = parsed.orderBy
      ? [...filtered].sort((a, b) => {
          const av = a[parsed.orderBy!];
          const bv = b[parsed.orderBy!];
          const cmp = String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true });
          return parsed.orderDirection === "DESC" ? -cmp : cmp;
        })
      : filtered;

    const paged = ordered.slice(parsed.offset ?? 0, (parsed.offset ?? 0) + (parsed.limit ?? ordered.length));

    if (parsed.fields.length === 1 && parsed.fields[0] === "*") return { rows: paged };

    const rows = paged.map((row) => {
      const out: SqlRow = {};
      for (const f of parsed.fields) out[f] = row[f] ?? null;
      return out;
    });
    return { rows };
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
    const m = sql.match(/UPDATE\s+[a-zA-Z_][a-zA-Z0-9_]*\s+SET\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)\s+WHERE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)/i);
    if (!m) throw new Error(`Unsupported UPDATE syntax: ${sql}`);
    return {
      setField: m[1].trim(),
      setValue: this.trimQuoted(m[2].trim()),
      whereField: m[3].trim(),
      whereValue: this.trimQuoted(m[4].trim()),
    };
  }

  private parseDelete(sql: string): { whereField: string; whereValue: string } {
    const m = sql.match(/DELETE FROM\s+[a-zA-Z_][a-zA-Z0-9_]*\s+WHERE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)/i);
    if (!m) throw new Error(`Unsupported DELETE syntax: ${sql}`);
    return {
      whereField: m[1].trim(),
      whereValue: this.trimQuoted(m[2].trim()),
    };
  }

  private parseSelect(
    normalizedSql: string,
    rawSql: string,
  ): {
    table: string;
    fields: string[] | ["*"];
    where?: string;
    limit?: number;
    offset?: number;
    orderBy?: string;
    orderDirection?: "ASC" | "DESC";
    aggregate?: "COUNT";
  } {
    const m = normalizedSql.match(
      /SELECT\s+(.+)\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER BY\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(ASC|DESC))?)?(?:\s+LIMIT\s+(\d+))?(?:\s+OFFSET\s+(\d+))?$/i,
    );
    if (!m) throw new Error(`Unsupported SELECT: ${rawSql}`);

    const selectFields = m[1].trim();
    const table = m[2];
    const where = m[3]?.trim();
    const orderBy = m[4]?.trim();
    const orderDirection = (m[5]?.toUpperCase() as "ASC" | "DESC" | undefined) ?? "ASC";
    const limit = m[6] ? Number(m[6]) : undefined;
    const offset = m[7] ? Number(m[7]) : undefined;

    const aggregate = /^COUNT\(\*\)$/i.test(selectFields) ? "COUNT" : undefined;

    if (aggregate === "COUNT") {
      return {
        table,
        fields: ["count"],
        where,
        limit,
        offset,
        orderBy,
        orderDirection,
        aggregate,
      };
    }

    if (selectFields === "*") {
      return { table, fields: ["*"], where, limit, offset, orderBy, orderDirection };
    }

    return {
      table,
      fields: selectFields.split(",").map((x) => x.trim()),
      where,
      limit,
      offset,
      orderBy,
      orderDirection,
    };
  }

  private applyWhere(rows: SqlRow[], whereExpr: string): SqlRow[] {
    const m = whereExpr.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)/i);
    if (!m) throw new Error(`Unsupported WHERE expression: ${whereExpr}`);
    const field = m[1].trim();
    const value = this.trimQuoted(m[2].trim());
    return rows.filter((r) => String(r[field]) === value);
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
