import { randomUUID, createHash } from "node:crypto";
import { evalPredicate3VL, resolveIdentifierValue, toTruthValue } from "./sql-semantics.js";
import type {
  ExecuteResult,
  QueryProofResult,
  QueryResult,
  SqlPrimitive,
  SqlRow,
  StorageWriteEvent,
  StorageWriteOperation,
  WalrusSqlClientOptions,
} from "./types.js";
import { buildMoveCall } from "./onchain.js";
import { parseSqlToAst } from "./sql-parser.js";
import { exprAstToSql } from "./sql-ast-eval.js";
import { SqlEngineError, createSqlError } from "./sql-errors.js";
import type { ExprAst, SelectStatementAst } from "./sql-ast.js";
import { normalizeSql } from "./sql-executor.js";
import { ClientErrorCodeEnum, sqlError, constraintError, type ClientErrorCode } from "./engine-errors.js";
import { createLogger, type Logger } from "./logger.js";
import {
  emptyConstraintCostStats,
  type ColumnSchema,
  type ColumnTypeSpec,
  type ConstraintIndexCostStats,
  type SqlTypeName,
  type TableSchema,
} from "./sql-catalog.js";

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

const BIGINT_MIN_BOUND = -9223372036854775808n;
const BIGINT_MAX_BOUND = 9223372036854775807n;
const MIN_SAFE_INTEGER_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

type TruthValue = "TRUE" | "FALSE" | "UNKNOWN";

type ComparePredicate = "=" | "!=" | "<>" | ">" | "<" | ">=" | "<=";

type WhereClause = {
  logic?: LogicOp;
  field: string;
  op: CompareOp;
  value?: SqlPrimitive;
  values?: SqlPrimitive[];
  valueExpr?: string;
  valueExprs?: string[];
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
  whereAst?: ExprAst;
  havingAst?: ExprAst;
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
  joins?: Array<{
    type: "INNER" | "LEFT" | "RIGHT";
    table: string;
    leftField: string;
    rightField: string;
  }>;
  rowNumberAlias?: string;
  rowNumberSpec?: {
    partitionBy: string[];
    orderBy: Array<{ field: string; direction: "ASC" | "DESC" }>;
  };
};

type DmlPlan = {
  table: string;
  whereExpr: string;
  joinAware: boolean;
};

type UpdatePlan = DmlPlan & {
  setField: string;
  setValue: string;
  join?: {
    table: string;
    leftAlias?: string;
    rightAlias?: string;
    leftField: string;
    rightField: string;
  };
};

type DeletePlan = DmlPlan & {
  join?: {
    table: string;
    leftAlias?: string;
    rightAlias?: string;
    leftField: string;
    rightField: string;
  };
};

export class WalrusSqlClient {
  private readonly opts: WalrusSqlClientOptions;
  private readonly tables = new Map<string, SqlRow[]>();
  private readonly schemas = new Map<string, TableSchema>();
  private readonly uniqueIndexes = new Map<string, Map<string, Map<string, SqlRow>>>();
  private readonly uniqueGroupsCache = new Map<string, string[][]>();
  private readonly constraintCost = new Map<string, ConstraintIndexCostStats>();
  private readonly dirtyTables = new Set<string>();
  private readonly queryCache = new Map<string, { rows: SqlRow[]; cachedAt: number; writeVersion: number }>();
  private readonly storageWriteLog: StorageWriteEvent[] = [];
  private readonly logger: Logger;
  private writeVersion = 0;

  constructor(opts: WalrusSqlClientOptions) {
    this.opts = opts;
    this.logger = createLogger({
      level: opts.logging?.level ?? "error",
      sink: opts.logging?.sink,
      scope: "WalrusSqlClient",
    });
  }

  private isKnownError(err: unknown): err is Error {
    if (!(err instanceof Error)) return false;
    if (err instanceof SqlEngineError) return true;
    return /^(?:ERR_[A-Z_]+|SQL_[A-Z_]+)/.test(err.message);
  }

  private stringifyError(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }

  private wrapAsyncError(err: unknown, fallbackCode: ClientErrorCode, context: string): Error {
    if (this.isKnownError(err)) return err;
    return sqlError(fallbackCode, `${context}: ${this.stringifyError(err)}`);
  }

  async execute(sql: string): Promise<ExecuteResult> {
    const normalized = normalizeSql(sql);
    this.logger.debug("execute start", { sql: normalized, mode: this.opts.mode ?? "simulator" });
    try {
      if ((this.opts.mode ?? "simulator") === "onchain") {
        const result = await this.executeOnchain(sql);
        this.logger.debug("execute success", {
          sql: normalized,
          statementType: result.statementType,
          affectedRows: result.affectedRows ?? 0,
        });
        return result;
      }
      const result = await this.executeSimulator(sql);
      this.logger.debug("execute success", {
        sql: normalized,
        statementType: result.statementType,
        affectedRows: result.affectedRows ?? 0,
      });
      return result;
    } catch (err) {
      const wrapped = this.wrapAsyncError(err, ClientErrorCodeEnum.ExecutionFailed, "execute() failed");
      this.logger.error("execute failed", { sql: normalized, error: wrapped.message });
      throw wrapped;
    }
  }

  async executeBatch(sqlList: string[]): Promise<ExecuteResult[]> {
    if (!Array.isArray(sqlList) || sqlList.length === 0) return [];

    // P0 batch-write interface: aggregate multiple writes through one API call.
    // Current engine applies statements sequentially while preserving result order.
    const out: ExecuteResult[] = [];
    for (const sql of sqlList) {
      out.push(await this.execute(sql));
    }
    return out;
  }

  getConstraintIndexCost(table?: string): ConstraintIndexCostStats | Record<string, ConstraintIndexCostStats> {
    if (table) return { ...(this.constraintCost.get(table) ?? emptyConstraintCostStats()) };
    const out: Record<string, ConstraintIndexCostStats> = {};
    for (const [k, v] of this.constraintCost.entries()) out[k] = { ...v };
    return out;
  }

  getDirtyTables(): string[] {
    return [...this.dirtyTables.values()].sort();
  }

  flushDirtyTables(tables?: string[]): string[] {
    const target = tables && tables.length > 0 ? tables : [...this.dirtyTables.values()];
    const flushed: string[] = [];
    for (const t of target) {
      if (this.dirtyTables.delete(t)) flushed.push(t);
    }
    return flushed;
  }

  resetConstraintIndexCost(table?: string): void {
    if (table) {
      this.constraintCost.set(table, emptyConstraintCostStats());
      return;
    }
    this.constraintCost.clear();
  }

  getStorageWriteLog(table?: string): StorageWriteEvent[] {
    const events = table ? this.storageWriteLog.filter((evt) => evt.table === table) : this.storageWriteLog;
    return events.map((evt) => ({ ...evt }));
  }

  flushStorageWriteLog(table?: string): StorageWriteEvent[] {
    if (!table) {
      const out = this.storageWriteLog.map((evt) => ({ ...evt }));
      this.storageWriteLog.length = 0;
      return out;
    }

    const kept: StorageWriteEvent[] = [];
    const flushed: StorageWriteEvent[] = [];
    for (const evt of this.storageWriteLog) {
      if (evt.table === table) flushed.push({ ...evt });
      else kept.push(evt);
    }
    this.storageWriteLog.length = 0;
    this.storageWriteLog.push(...kept);
    return flushed;
  }

  private recordStorageWrite(
    table: string,
    op: StorageWriteOperation,
    affectedRows: number,
    mode: "simulator" | "onchain",
  ): void {
    this.storageWriteLog.push({
      table,
      op,
      affectedRows,
      mode,
      at: Date.now(),
    });
  }

  private bumpConstraintCost(table: string, patch: Partial<ConstraintIndexCostStats>): void {
    const curr = this.constraintCost.get(table) ?? emptyConstraintCostStats();
    this.constraintCost.set(table, {
      insertOps: curr.insertOps + (patch.insertOps ?? 0),
      updateOps: curr.updateOps + (patch.updateOps ?? 0),
      deleteOps: curr.deleteOps + (patch.deleteOps ?? 0),
      rebuildOps: curr.rebuildOps + (patch.rebuildOps ?? 0),
      conflictChecks: curr.conflictChecks + (patch.conflictChecks ?? 0),
      rowsIndexed: curr.rowsIndexed + (patch.rowsIndexed ?? 0),
    });
  }

  private getReadCacheConfig(): { enabled: boolean; maxEntries: number; ttlMs: number } {
    const cfg = this.opts.readCache;
    const enabled = cfg?.enabled ?? true;
    const maxEntries = Math.max(1, cfg?.maxEntries ?? 256);
    const ttlMs = Math.max(1, cfg?.ttlMs ?? 5_000);
    return { enabled, maxEntries, ttlMs };
  }

  private deepCloneRows(rows: SqlRow[]): SqlRow[] {
    return rows.map((r) => ({ ...r }));
  }

  private getCachedQuery(sql: string): SqlRow[] | null {
    const cfg = this.getReadCacheConfig();
    if (!cfg.enabled) return null;

    const hit = this.queryCache.get(sql);
    if (!hit) return null;

    const expired = Date.now() - hit.cachedAt > cfg.ttlMs;
    const stale = hit.writeVersion !== this.writeVersion;
    if (expired || stale) {
      this.queryCache.delete(sql);
      return null;
    }

    // LRU touch
    this.queryCache.delete(sql);
    this.queryCache.set(sql, hit);
    this.logger.debug("read-cache hit", { sql });
    return this.deepCloneRows(hit.rows);
  }

  private setCachedQuery(sql: string, rows: SqlRow[]): void {
    const cfg = this.getReadCacheConfig();
    if (!cfg.enabled) return;

    if (this.queryCache.has(sql)) this.queryCache.delete(sql);
    this.queryCache.set(sql, {
      rows: this.deepCloneRows(rows),
      cachedAt: Date.now(),
      writeVersion: this.writeVersion,
    });

    while (this.queryCache.size > cfg.maxEntries) {
      const oldest = this.queryCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.queryCache.delete(oldest);
    }
  }

  private buildQueryResult(sql: string, rows: SqlRow[]): QueryResult {
    this.setCachedQuery(sql, rows);
    return { rows };
  }

  private invalidateReadCacheOnWrite(): void {
    this.writeVersion += 1;
    this.queryCache.clear();
  }

  private getRetryConfig(): { maxAttempts: number; baseDelayMs: number; maxDelayMs: number } {
    const cfg = this.opts.walrusRetry;
    return {
      maxAttempts: Math.max(1, cfg?.maxAttempts ?? 3),
      baseDelayMs: Math.max(1, cfg?.baseDelayMs ?? 120),
      maxDelayMs: Math.max(1, cfg?.maxDelayMs ?? 1_500),
    };
  }

  private isRetryableWalrusError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /timeout|temporar|temporarily|rate\s*limit|429|5\d\d|network|ECONN|ENOTFOUND|ETIMEDOUT/i.test(msg);
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async withWalrusRetry<T>(op: () => Promise<T>): Promise<T> {
    const cfg = this.getRetryConfig();
    let attempt = 0;
    let lastErr: unknown;

    while (attempt < cfg.maxAttempts) {
      attempt += 1;
      try {
        return await op();
      } catch (err) {
        lastErr = err;
        const retryable = this.isRetryableWalrusError(err);
        if (!retryable || attempt >= cfg.maxAttempts) break;

        const exp = cfg.baseDelayMs * 2 ** (attempt - 1);
        const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(cfg.baseDelayMs / 3)));
        const waitMs = Math.min(cfg.maxDelayMs, exp + jitter);
        this.logger.warn("walrus retry", {
          attempt,
          maxAttempts: cfg.maxAttempts,
          waitMs,
          error: this.stringifyError(err),
        });
        await this.sleep(waitMs);
      }
    }

    const wrapped = this.wrapAsyncError(lastErr, ClientErrorCodeEnum.ExecutionFailed, "walrus operation failed");
    this.logger.error("walrus retry exhausted", { error: wrapped.message });
    throw wrapped;
  }

  private async executeOnchain(sql: string): Promise<ExecuteResult> {
    const moveCall = buildMoveCall({
      packageId: this.opts.packageId,
      moduleName: this.opts.moduleName,
      sql,
    });

    const result = !this.opts.onchainExecutor
      ? {
          txDigest: this.fakeDigest(`planned:${sql}`),
          statementType: moveCall.statementType,
          moveCall: {
            target: moveCall.target,
            arguments: moveCall.arguments,
            typeArguments: moveCall.typeArguments,
            tableName: moveCall.tableName,
          },
        }
      : await this.withWalrusRetry(async () => {
          const res = await this.opts.onchainExecutor!(moveCall);
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
        });

    if (moveCall.tableName) {
      const op: StorageWriteOperation =
        moveCall.statementType === "CREATE"
          ? "CREATE_TABLE"
          : moveCall.statementType === "INSERT"
            ? "INSERT_ROW"
            : moveCall.statementType === "UPDATE"
              ? "UPDATE_ROW"
              : "DELETE_ROW";
      const affectedRows = moveCall.statementType === "INSERT" ? 1 : 0;
      this.recordStorageWrite(moveCall.tableName, op, affectedRows, "onchain");
    }

    this.invalidateReadCacheOnWrite();
    return result;
  }

  private async executeSimulator(sql: string): Promise<ExecuteResult> {
    const normalized = sql.trim().replace(/\s+/g, " ");
    const upper = normalized.toUpperCase();

    if (upper.startsWith("CREATE TABLE")) {
      const schema = this.parseCreateTableSchema(normalized);
      if (!this.tables.has(schema.name)) this.tables.set(schema.name, []);
      this.schemas.set(schema.name, schema);
      this.uniqueGroupsCache.set(schema.name, this.collectUniqueGroups(schema));
      this.ensureUniqueIndexMaps(schema.name);
      this.dirtyTables.add(schema.name);
      this.recordStorageWrite(schema.name, "CREATE_TABLE", 0, "simulator");
      this.invalidateReadCacheOnWrite();
      return {
        txDigest: this.fakeDigest(normalized),
        statementType: "CREATE",
        tableObjectId: `0x${randomUUID().replace(/-/g, "")}`,
        affectedRows: 0,
      };
    }

    if (upper.startsWith("DROP TABLE")) {
      const table = this.extractTableName(normalized, /DROP TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
      this.tables.delete(table);
      this.schemas.delete(table);
      this.uniqueIndexes.delete(table);
      this.uniqueGroupsCache.delete(table);
      this.constraintCost.delete(table);
      this.dirtyTables.delete(table);
      this.recordStorageWrite(table, "DROP_TABLE", 0, "simulator");
      this.invalidateReadCacheOnWrite();
      return {
        txDigest: this.fakeDigest(normalized),
        statementType: "DELETE",
        affectedRows: 0,
      };
    }

    if (upper.startsWith("ALTER TABLE")) {
      const table = this.extractTableName(normalized, /ALTER TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
      this.applyAlterTable(normalized);
      this.recordStorageWrite(table, "ALTER_TABLE", 0, "simulator");
      this.invalidateReadCacheOnWrite();
      return {
        txDigest: this.fakeDigest(normalized),
        statementType: "UPDATE",
        affectedRows: 0,
      };
    }

    if (upper.startsWith("INSERT INTO")) {
      const table = this.extractTableName(normalized, /INSERT INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
      const row = this.parseInsert(normalized);
      const bucket = this.requireTable(table);
      const coerced = this.applySchemaOnWrite(table, row, undefined);
      bucket.push(coerced);
      this.addRowToUniqueIndexes(table, coerced);
      this.dirtyTables.add(table);
      this.recordStorageWrite(table, "INSERT_ROW", 1, "simulator");
      this.invalidateReadCacheOnWrite();
      return {
        txDigest: this.fakeDigest(normalized),
        statementType: "INSERT",
        affectedRows: 1,
      };
    }

    if (upper.startsWith("UPDATE")) {
      const plan = this.planUpdate(normalized);
      const bucket = this.requireTable(plan.table);

      const joinedRows = plan.join
        ? (() => {
            const rightRows = this.requireTable(plan.join.table);
            const { leftField, rightField } = this.normalizeJoinOnFields(plan, "update");
            this.assertJoinOnFieldsExist(plan, leftField, rightField, "update");
            const leftAlias = plan.join.leftAlias ?? plan.table;
            const rightAlias = plan.join.rightAlias ?? plan.join.table;

            const out = new Map<SqlRow, SqlRow[]>();
            for (const l of bucket) {
              for (const r of rightRows) {
                if (String(l[leftField]) !== String(r[rightField])) continue;
                const merged: SqlRow = {};
                for (const [k, v] of Object.entries(l)) {
                  merged[k] = v;
                  merged[`${leftAlias}.${k}`] = v;
                  merged[`${plan.table}.${k}`] = v;
                }
                for (const [k, v] of Object.entries(r)) {
                  merged[`${rightAlias}.${k}`] = v;
                  merged[`${plan.join!.table}.${k}`] = v;
                }
                const arr = out.get(l);
                if (arr) arr.push(merged);
                else out.set(l, [merged]);
              }
            }
            return out;
          })()
        : new Map(bucket.map((row) => [row, [row]] as const));

      const whereTree = this.parseWhereTree(plan.whereExpr);
      const targetSetField = this.resolveUpdateSetField(plan);
      let touched = 0;
      for (const row of bucket) {
        const mergedHits = joinedRows.get(row);
        if (!mergedHits || mergedHits.length === 0) continue;
        const matched = mergedHits.some((merged) => this.evaluateWhereTree(merged, whereTree) === "TRUE");
        if (!matched) continue;

        const next = this.applySchemaOnWrite(
          plan.table,
          { ...row, [targetSetField]: this.castValue(plan.setValue) },
          row,
        );
        this.removeRowFromUniqueIndexes(plan.table, row);
        Object.keys(row).forEach((k) => delete row[k]);
        Object.assign(row, next);
        this.addRowToUniqueIndexes(plan.table, row);
        this.bumpConstraintCost(plan.table, { updateOps: 1 });
        this.dirtyTables.add(plan.table);
        touched++;
      }
      if (touched > 0) this.recordStorageWrite(plan.table, "UPDATE_ROW", touched, "simulator");
      this.invalidateReadCacheOnWrite();
      return {
        txDigest: this.fakeDigest(normalized),
        statementType: "UPDATE",
        affectedRows: touched,
      };
    }

    if (upper.startsWith("DELETE")) {
      const plan = this.planDelete(normalized);
      const bucket = this.requireTable(plan.table);

      const joinedRows = plan.join
        ? (() => {
            const rightRows = this.requireTable(plan.join.table);
            const { leftField, rightField } = this.normalizeJoinOnFields(plan, "delete");
            this.assertJoinOnFieldsExist(plan, leftField, rightField, "delete");
            const leftAlias = plan.join.leftAlias ?? plan.table;
            const rightAlias = plan.join.rightAlias ?? plan.join.table;

            const out = new Map<SqlRow, SqlRow[]>();
            for (const l of bucket) {
              for (const r of rightRows) {
                if (String(l[leftField]) !== String(r[rightField])) continue;

                const merged: SqlRow = {};
                for (const [k, v] of Object.entries(l)) {
                  merged[k] = v;
                  merged[`${leftAlias}.${k}`] = v;
                  merged[`${plan.table}.${k}`] = v;
                }
                for (const [k, v] of Object.entries(r)) {
                  merged[`${rightAlias}.${k}`] = v;
                  merged[`${plan.join!.table}.${k}`] = v;
                }
                const arr = out.get(l);
                if (arr) arr.push(merged);
                else out.set(l, [merged]);
              }
            }
            return out;
          })()
        : new Map(bucket.map((row) => [row, [row]] as const));

      const whereTree = this.parseWhereTree(plan.whereExpr);
      let touched = 0;
      const next: SqlRow[] = [];
      for (const row of bucket) {
        const mergedHits = joinedRows.get(row);
        const matched = mergedHits ? mergedHits.some((merged) => this.evaluateWhereTree(merged, whereTree) === "TRUE") : false;
        if (matched) {
          this.removeRowFromUniqueIndexes(plan.table, row);
          touched++;
        } else {
          next.push(row);
        }
      }
      this.tables.set(plan.table, next);
      this.dirtyTables.add(plan.table);
      if (touched > 0) this.recordStorageWrite(plan.table, "DELETE_ROW", touched, "simulator");
      this.invalidateReadCacheOnWrite();
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
    const normalized = normalizeSql(sql);
    this.logger.debug("query start", { sql: normalized, mode: this.opts.mode ?? "simulator" });
    try {
      const normalizedSql = sql.trim().replace(/\s+/g, " ");
      const cachedRows = this.getCachedQuery(normalizedSql);
      if (cachedRows) return { rows: cachedRows };

      const ast = parseSqlToAst(sql, { dialect: this.opts.dialect ?? "ansi" });

    if (ast.kind === "union") {
      const rightPlan = this.splitSelectTail(ast.rightSql);

      const left = await this.query(ast.leftSql);
      const right = await this.query(rightPlan.baseSql);

      const inferredLeftColumns = this.inferUnionColumns(ast.leftSql);
      const leftColumns =
        inferredLeftColumns
        ?? (left.rows[0] ? Object.keys(left.rows[0]) : right.rows[0] ? Object.keys(right.rows[0]) : undefined);

      const normalizedLeft = leftColumns ? left.rows.map((row) => this.normalizeUnionRow(row, leftColumns)) : left.rows;
      const normalizedRight = leftColumns ? right.rows.map((row) => this.normalizeUnionRow(row, leftColumns)) : right.rows;

      const merged = ast.all
        ? [...normalizedLeft, ...normalizedRight]
        : (() => {
            const dedup = new Map<string, SqlRow>();
            for (const row of [...normalizedLeft, ...normalizedRight]) {
              dedup.set(this.makeRowKey(row), row);
            }
            return [...dedup.values()];
          })();

      const ordered = this.applyOrder(merged, rightPlan.orderByList);
      const paged = this.applyPage(ordered, rightPlan.offset, rightPlan.limit);
      return this.buildQueryResult(normalizedSql, paged);
    }

    if (ast.kind === "select" && ast.from.kind === "subquery") {
      const { subquerySql, alias, rewrittenSql } = ast.from;
      const inner = await this.query(subquerySql);
      const tempTable = `__derived_${randomUUID().replace(/-/g, "")}`;
      const materialized = inner.rows.map((r) => {
        const out: SqlRow = { ...r };
        for (const [k, v] of Object.entries(r)) out[`${alias}.${k}`] = v;
        return out;
      });

      this.tables.set(tempTable, materialized);
      try {
        const result = await this.query(rewrittenSql.replace(/__DERIVED_TABLE__/g, tempTable));
        return this.buildQueryResult(normalizedSql, result.rows);
      } finally {
        this.tables.delete(tempTable);
      }
    }

    const normalized = sql.trim().replace(/\s+/g, " ");
    const parsed = this.parseSelect(normalized, sql);

    if (parsed.explain) {
      return this.buildQueryResult(normalizedSql, [
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
          joins: parsed.joins?.length
            ? parsed.joins.map((j) => `${j.type} ${j.table} ON ${j.leftField}=${j.rightField}`).join(" ; ")
            : null,
        },
      ]);
    }

    if ((this.opts.mode ?? "simulator") === "onchain" && this.opts.onchainQueryExecutor) {
      const onchain = await this.withWalrusRetry(async () =>
        this.opts.onchainQueryExecutor!({
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
          joins: parsed.joins,
        }),
      );
      return this.buildQueryResult(normalizedSql, onchain.rows);
    }

    const bucket = this.requireTable(parsed.table);
    const baseRows = parsed.joins?.length
      ? parsed.joins.reduce((acc, j, idx) => this.applyJoin(idx === 0 ? parsed.table : parsed.joins![idx - 1]!.table, acc, j), bucket)
      : parsed.join
      ? this.applyJoin(parsed.table, bucket, parsed.join)
      : bucket;
    const filtered = parsed.whereAst
      ? baseRows.filter((row) => this.evaluateWhereAst(row, parsed.whereAst!, parsed.where) === "TRUE")
      : parsed.whereTree
      ? baseRows.filter((row) => this.evaluateWhereTree(row, parsed.whereTree!) === "TRUE")
      : parsed.whereClauses.length
        ? this.applyWhereClauses(baseRows, parsed.whereClauses)
        : baseRows;

    if (parsed.groupBy?.length) {
      const grouped = this.groupRows(filtered, parsed.groupBy, parsed.aggregate, parsed.aggregateField);
      const havingRows = parsed.havingAst
        ? grouped.filter((row) => this.evaluateWhereAst(row, parsed.havingAst!, parsed.having) === "TRUE")
        : parsed.having
        ? grouped.filter((row) => this.evaluateWhereTree(row, this.parseWhereTree(parsed.having!)) === "TRUE")
        : grouped;
      const orderedGrouped = this.applyOrder(havingRows, parsed.orderByList);
      const pagedGrouped = this.applyPage(orderedGrouped, parsed.offset, parsed.limit);
      return this.buildQueryResult(
        normalizedSql,
        pagedGrouped.map((row) => this.pickFields(row, parsed.fields)),
      );
    }

    if (parsed.aggregate) {
      return this.buildQueryResult(normalizedSql, [this.computeAggregateRow(filtered, parsed.aggregate, parsed.aggregateField)]);
    }

    const withWindow = parsed.rowNumberAlias
      ? this.applyRowNumber(filtered, parsed.rowNumberAlias, parsed.rowNumberSpec)
      : filtered;
    const ordered = this.applyOrder(withWindow, parsed.orderByList);
    const paged = this.applyPage(ordered, parsed.offset, parsed.limit);

      const result = this.buildQueryResult(
        normalizedSql,
        paged.map((row) => this.pickFields(row, parsed.fields)),
      );
      this.logger.debug("query success", { sql: normalized, rows: result.rows.length });
      return result;
    } catch (err) {
      const wrapped = this.wrapAsyncError(err, ClientErrorCodeEnum.QueryFailed, `query() failed for SQL: ${normalized}`);
      this.logger.error("query failed", { sql: normalized, error: wrapped.message });
      throw wrapped;
    }
  }

  async queryOne(sql: string): Promise<SqlRow | null> {
    const result = await this.query(sql);
    return result.rows[0] ?? null;
  }

  async queryWithProof(sql: string): Promise<QueryProofResult> {
    try {
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
    } catch (err) {
      throw this.wrapAsyncError(err, ClientErrorCodeEnum.QueryFailed, "queryWithProof() failed");
    }
  }

  async verify(result: QueryProofResult): Promise<boolean> {
    try {
      return Boolean(result.proof.manifestHash && result.proof.indexRoot && result.proof.txDigest);
    } catch (err) {
      throw this.wrapAsyncError(err, ClientErrorCodeEnum.VerificationFailed, "verify() failed");
    }
  }

  private fakeDigest(input: string): string {
    return createHash("sha256")
      .update(`${this.opts.network}:${this.opts.packageId}:${input}`)
      .digest("hex")
      .slice(0, 40);
  }

  private requireTable(name: string): SqlRow[] {
    const table = this.tables.get(name);
    if (!table) throw sqlError("ERR_TABLE_NOT_FOUND", name);
    return table;
  }

  private extractTableName(sql: string, pattern: RegExp): string {
    const m = sql.match(pattern);
    if (!m) throw sqlError("ERR_UNSUPPORTED_DDL", `unable to parse table name from SQL: ${sql}`);
    return m[1];
  }

  private splitTopLevelComma(input: string): string[] {
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

  private parseSqlTypeSpec(rawType: string): ColumnTypeSpec {
    const t = rawType.trim().toUpperCase();
    const m = t.match(/^([A-Z]+)(?:\((.+)\))?$/);
    if (!m) throw sqlError("ERR_UNSUPPORTED_TYPE", rawType);

    const name = m[1] as SqlTypeName;
    const supported: SqlTypeName[] = [
      "SMALLINT",
      "INT",
      "BIGINT",
      "DECIMAL",
      "FLOAT",
      "DOUBLE",
      "CHAR",
      "VARCHAR",
      "DATE",
      "TIME",
      "TIMESTAMP",
      "BOOLEAN",
      "BLOB",
      "TEXT",
      "STRING",
      "U64",
    ];
    if (!supported.includes(name)) throw sqlError("ERR_UNSUPPORTED_TYPE", rawType);

    const params = m[2]?.split(",").map((x) => Number(x.trim()));

    if (name === "DECIMAL") {
      if (!params || params.length !== 2 || !Number.isInteger(params[0]) || !Number.isInteger(params[1])) {
        throw sqlError("ERR_TYPE_CONSTRAINT", `DECIMAL requires (precision,scale): ${rawType}`);
      }
      const precision = params[0]!;
      const scale = params[1]!;
      if (precision <= 0 || scale < 0 || scale > precision) {
        throw sqlError("ERR_TYPE_CONSTRAINT", `invalid DECIMAL bounds: ${rawType}`);
      }
      return { name, precision, scale };
    }

    if (name === "CHAR" || name === "VARCHAR") {
      if (!params || params.length !== 1 || !Number.isInteger(params[0]) || params[0]! <= 0) {
        throw sqlError("ERR_TYPE_CONSTRAINT", `${name} requires positive length: ${rawType}`);
      }
      return { name, length: params[0]! };
    }

    if (params && params.length > 0) {
      throw sqlError("ERR_TYPE_CONSTRAINT", `${name} does not accept parameters: ${rawType}`);
    }

    return { name };
  }

  private parseCreateTableSchema(sql: string): TableSchema {
    const m = sql.match(/^CREATE TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\((.+)\)\s*$/i);
    if (!m) throw sqlError("ERR_UNSUPPORTED_DDL", sql);
    const table = m[1]!;
    const defs = this.splitTopLevelComma(m[2]!);
    if (defs.length === 0) throw sqlError("ERR_UNSUPPORTED_DDL", `CREATE TABLE has no columns: ${sql}`);

    const columns: ColumnSchema[] = [];
    const tableUniqueGroups: string[][] = [];
    let primaryKeyGroup: string[] | undefined;

    for (const d of defs) {
      const pkMatch = d.match(/^PRIMARY\s+KEY\s*\((.+)\)$/i);
      if (pkMatch) {
        if (primaryKeyGroup) throw sqlError("ERR_UNSUPPORTED_DDL", `duplicate PRIMARY KEY definition`);
        primaryKeyGroup = this.splitTopLevelComma(pkMatch[1]!).map((x) => x.trim());
        if (!primaryKeyGroup.length) throw sqlError("ERR_UNSUPPORTED_DDL", `empty PRIMARY KEY definition`);
        continue;
      }

      const uqMatch = d.match(/^UNIQUE\s*\((.+)\)$/i);
      if (uqMatch) {
        const cols = this.splitTopLevelComma(uqMatch[1]!).map((x) => x.trim());
        if (!cols.length) throw sqlError("ERR_UNSUPPORTED_DDL", `empty UNIQUE definition`);
        tableUniqueGroups.push(cols);
        continue;
      }

      const dm = d.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+([a-zA-Z]+(?:\s*\([^\)]*\))?)\s*(.*)$/i);
      if (!dm) throw sqlError("ERR_UNSUPPORTED_DDL", `invalid column definition: ${d}`);
      const colName = dm[1]!.trim();
      const type = this.parseSqlTypeSpec(dm[2]!);
      const cons = dm[3]!.toUpperCase();
      const primaryKey = /\bPRIMARY\s+KEY\b/.test(cons);
      const notNull = primaryKey || /\bNOT\s+NULL\b/.test(cons);
      const unique = primaryKey || /\bUNIQUE\b/.test(cons);
      columns.push({ name: colName, type, notNull, primaryKey, unique });
    }

    const seen = new Set<string>();
    for (const c of columns) {
      const key = c.name.toUpperCase();
      if (seen.has(key)) throw sqlError("ERR_UNSUPPORTED_DDL", `duplicate column: ${c.name}`);
      seen.add(key);
    }

    const colByUpper = new Map(columns.map((c) => [c.name.toUpperCase(), c] as const));

    if (primaryKeyGroup) {
      for (const k of primaryKeyGroup) {
        const col = colByUpper.get(k.toUpperCase());
        if (!col) throw sqlError("ERR_UNSUPPORTED_DDL", `PRIMARY KEY column not found: ${k}`);
        col.notNull = true;
        if (primaryKeyGroup.length === 1) col.primaryKey = true;
      }
    }

    for (const grp of tableUniqueGroups) {
      for (const k of grp) {
        if (!colByUpper.has(k.toUpperCase())) {
          throw sqlError("ERR_UNSUPPORTED_DDL", `UNIQUE column not found: ${k}`);
        }
      }
    }

    return { name: table, columns, uniqueGroups: tableUniqueGroups, primaryKeyGroup };
  }

  private applyAlterTable(sql: string): void {
    const add = sql.match(
      /^ALTER TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+ADD\s+COLUMN\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+([a-zA-Z]+(?:\s*\([^\)]*\))?)\s*(.*)$/i,
    );
    if (add) {
      const table = add[1]!;
      const schema = this.schemas.get(table);
      if (!schema) throw sqlError("ERR_TABLE_NOT_FOUND", table);

      const column = add[2]!;
      if (schema.columns.some((c) => c.name.toUpperCase() === column.toUpperCase())) {
        throw sqlError("ERR_UNSUPPORTED_DDL", `column already exists: ${column}`);
      }

      const type = this.parseSqlTypeSpec(add[3]!);
      const cons = add[4]!.toUpperCase();
      const primaryKey = /\bPRIMARY\s+KEY\b/.test(cons);
      const notNull = primaryKey || /\bNOT\s+NULL\b/.test(cons);
      const unique = primaryKey || /\bUNIQUE\b/.test(cons);
      const col: ColumnSchema = { name: column, type, notNull, primaryKey, unique };

      const rows = this.requireTable(table);
      if (notNull && rows.length > 0) {
        throw constraintError("NOT_NULL_ADD_COLUMN", `cannot ADD COLUMN ${column} NOT NULL on non-empty table`);
      }
      for (const r of rows) r[column] = null;
      schema.columns.push(col);
      this.uniqueGroupsCache.delete(table);
      this.rebuildUniqueIndexes(table);
      this.dirtyTables.add(table);
      return;
    }

    const drop = sql.match(
      /^ALTER TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+DROP\s+COLUMN\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*$/i,
    );
    if (drop) {
      const table = drop[1]!;
      const column = drop[2]!;
      const schema = this.schemas.get(table);
      if (!schema) throw sqlError("ERR_TABLE_NOT_FOUND", table);

      const idx = schema.columns.findIndex((c) => c.name.toUpperCase() === column.toUpperCase());
      if (idx < 0) throw sqlError("ERR_UNSUPPORTED_DDL", `column not found: ${column}`);
      if (this.isPrimaryKeyMember(schema, column)) {
        throw constraintError("PK_DROP", `cannot DROP primary key column: ${column}`);
      }

      schema.columns.splice(idx, 1);
      schema.uniqueGroups = (schema.uniqueGroups ?? []).filter(
        (g) => !g.some((c) => c.toUpperCase() === column.toUpperCase()),
      );
      this.uniqueGroupsCache.delete(table);
      const rows = this.requireTable(table);
      for (const r of rows) delete r[column];
      this.rebuildUniqueIndexes(table);
      this.dirtyTables.add(table);
      return;
    }

    throw sqlError("ERR_UNSUPPORTED_DDL", sql);
  }

  private coerceByType(type: ColumnTypeSpec, value: SqlPrimitive): SqlPrimitive {
    if (value === null) return null;

    const toNum = (v: SqlPrimitive): number => {
      const n = Number(v);
      if (!Number.isFinite(n)) throw sqlError("ERR_TYPE_CONSTRAINT", `expected numeric for ${type.name}, got ${String(v)}`);
      return n;
    };

    const toInt = (v: SqlPrimitive): number => {
      const n = toNum(v);
      if (!Number.isInteger(n)) throw sqlError("ERR_TYPE_CONSTRAINT", `expected integer for ${type.name}, got ${String(v)}`);
      return n;
    };

    const toBigInt = (v: SqlPrimitive): bigint => {
      if (typeof v === "number") {
        if (!Number.isInteger(v)) {
          throw sqlError("ERR_TYPE_CONSTRAINT", `expected integer for ${type.name}, got ${String(v)}`);
        }
        if (!Number.isSafeInteger(v)) {
          throw sqlError(
            "ERR_TYPE_CONSTRAINT",
            `unsafe integer literal for ${type.name}; use quoted digits for precise conversion`,
          );
        }
        return BigInt(v);
      }

      const raw = String(v).trim();
      if (!/^[+-]?\d+$/.test(raw)) {
        throw sqlError("ERR_TYPE_CONSTRAINT", `expected integer for ${type.name}, got ${String(v)}`);
      }

      try {
        return BigInt(raw);
      } catch {
        throw sqlError("ERR_TYPE_CONSTRAINT", `expected integer for ${type.name}, got ${String(v)}`);
      }
    };

    if (type.name === "SMALLINT") {
      const n = toInt(value);
      if (n < -32768 || n > 32767) throw sqlError("ERR_TYPE_CONSTRAINT", `SMALLINT out of range: ${n}`);
      return n;
    }
    if (type.name === "INT") {
      const n = toInt(value);
      if (n < -2147483648 || n > 2147483647) throw sqlError("ERR_TYPE_CONSTRAINT", `INT out of range: ${n}`);
      return n;
    }
    if (type.name === "BIGINT") {
      const n = toBigInt(value);
      if (n < BIGINT_MIN_BOUND || n > BIGINT_MAX_BOUND) {
        throw sqlError("ERR_TYPE_CONSTRAINT", `BIGINT out of range: ${n.toString()}`);
      }
      if (n < MIN_SAFE_INTEGER_BIGINT || n > MAX_SAFE_INTEGER_BIGINT) return n.toString();
      return Number(n);
    }
    if (type.name === "U64") {
      const n = toInt(value);
      if (n < 0) throw sqlError("ERR_TYPE_CONSTRAINT", `U64 must be >= 0: ${n}`);
      if (!Number.isSafeInteger(n)) return String(n);
      return n;
    }
    if (type.name === "DECIMAL") {
      const s = String(value).trim();
      if (!/^[+-]?\d+(?:\.\d+)?$/.test(s)) throw sqlError("ERR_TYPE_CONSTRAINT", `invalid DECIMAL literal: ${s}`);
      const sign = s.startsWith("-") ? "-" : "";
      const [intPartRaw, fracPartRaw = ""] = s.replace(/^[+-]/, "").split(".");
      const intPart = intPartRaw.replace(/^0+(?=\d)/, "") || "0";
      const fracPart = fracPartRaw;
      const precision = type.precision ?? 0;
      const scale = type.scale ?? 0;
      const maxIntegerDigits = precision - scale;

      if (fracPart.length > scale) {
        throw sqlError(
          "ERR_TYPE_CONSTRAINT",
          `DECIMAL(${precision},${scale}) scale overflow (rounding disabled): ${s}`,
        );
      }
      if (intPart.length > maxIntegerDigits) {
        throw sqlError("ERR_TYPE_CONSTRAINT", `DECIMAL(${precision},${scale}) overflow: ${s}`);
      }

      if (scale === 0) return `${sign}${intPart}`;
      const paddedFrac = fracPart.padEnd(scale, "0");
      const isZero = intPart === "0" && /^0*$/.test(paddedFrac);
      const normalizedSign = sign === "-" && !isZero ? "-" : "";
      return `${normalizedSign}${intPart}.${paddedFrac}`;
    }
    if (type.name === "FLOAT" || type.name === "DOUBLE") {
      return toNum(value);
    }
    if (type.name === "CHAR" || type.name === "VARCHAR") {
      const str = String(value);
      const maxLen = type.length ?? 0;
      if (str.length > maxLen) {
        throw sqlError("ERR_TYPE_CONSTRAINT", `${type.name}(${maxLen}) length overflow: ${str.length}`);
      }
      return type.name === "CHAR" ? str.padEnd(maxLen, " ") : str;
    }
    if (type.name === "TEXT" || type.name === "STRING" || type.name === "BLOB") {
      return String(value);
    }
    if (type.name === "BOOLEAN") {
      if (typeof value === "boolean") return value;
      const v = String(value).trim().toLowerCase();
      if (v === "true" || v === "1") return true;
      if (v === "false" || v === "0") return false;
      throw sqlError("ERR_TYPE_CONSTRAINT", `invalid BOOLEAN: ${String(value)}`);
    }
    if (type.name === "DATE") {
      const s = String(value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw sqlError("ERR_TYPE_CONSTRAINT", `invalid DATE: ${s}`);
      const d = new Date(`${s}T00:00:00.000Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
        throw sqlError("ERR_TYPE_CONSTRAINT", `invalid DATE: ${s}`);
      }
      return s;
    }
    if (type.name === "TIME") {
      const s = String(value);
      if (!/^\d{2}:\d{2}:\d{2}$/.test(s)) throw sqlError("ERR_TYPE_CONSTRAINT", `invalid TIME: ${s}`);
      const [hh, mm, ss] = s.split(":").map((x) => Number(x));
      if (hh > 23 || mm > 59 || ss > 59) throw sqlError("ERR_TYPE_CONSTRAINT", `invalid TIME: ${s}`);
      return s;
    }
    if (type.name === "TIMESTAMP") {
      const s = String(value).trim();
      const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\s*(Z|[+-]\d{2}:\d{2}))?$/i);
      if (!m) throw sqlError("ERR_TYPE_CONSTRAINT", `invalid TIMESTAMP: ${s}`);

      const datePart = m[1]!;
      const timePart = m[2]!;
      const zonePart = (m[3] ?? "Z").toUpperCase();

      const dateCheck = new Date(`${datePart}T00:00:00.000Z`);
      if (Number.isNaN(dateCheck.getTime()) || dateCheck.toISOString().slice(0, 10) !== datePart) {
        throw sqlError("ERR_TYPE_CONSTRAINT", `invalid TIMESTAMP: ${s}`);
      }

      const [hh, mm, ss] = timePart.split(":").map((x) => Number(x));
      if (hh > 23 || mm > 59 || ss > 59) {
        throw sqlError("ERR_TYPE_CONSTRAINT", `invalid TIMESTAMP: ${s}`);
      }

      if (zonePart !== "Z") {
        const [zh, zm] = zonePart.slice(1).split(":").map((x) => Number(x));
        if (zh > 23 || zm > 59) {
          throw sqlError("ERR_TYPE_CONSTRAINT", `invalid TIMESTAMP: ${s}`);
        }
      }

      const dt = new Date(`${datePart}T${timePart}${zonePart}`);
      if (Number.isNaN(dt.getTime())) throw sqlError("ERR_TYPE_CONSTRAINT", `invalid TIMESTAMP: ${s}`);
      return `${dt.toISOString().slice(0, 19)}Z`;
    }
    if (type.name === "BLOB") {
      return String(value);
    }

    throw sqlError("ERR_UNSUPPORTED_TYPE", type.name);
  }

  private applySchemaOnWrite(table: string, candidate: SqlRow, previous?: SqlRow): SqlRow {
    const schema = this.schemas.get(table);
    if (!schema) return candidate;

    for (const k of Object.keys(candidate)) {
      if (!schema.columns.some((c) => c.name === k)) {
        throw sqlError("ERR_TYPE_CONSTRAINT", `unknown column: ${k}`);
      }
    }

    const out: SqlRow = {};
    for (const c of schema.columns) {
      const raw = Object.prototype.hasOwnProperty.call(candidate, c.name) ? candidate[c.name] : null;
      const coerced = this.coerceByType(c.type, (raw ?? null) as SqlPrimitive);
      if ((c.notNull || c.primaryKey) && (coerced === null || coerced === undefined)) {
        throw constraintError("NOT_NULL", `${table}.${c.name} is NOT NULL`);
      }
      out[c.name] = coerced;
    }

    const rows = this.requireTable(table);
    this.ensureUniqueIndexMaps(table);
    const indexByKey = this.uniqueIndexes.get(table) ?? new Map<string, Map<string, SqlRow>>();

    for (const group of this.getUniqueGroups(table, schema)) {
      const keyName = this.uniqueGroupName(group);
      const keyVal = this.uniqueGroupValue(out, group);
      if (keyVal === null) continue;

      const hitRow = indexByKey.get(keyName)?.get(keyVal);
      this.bumpConstraintCost(table, { conflictChecks: 1 });
      if (hitRow !== undefined) {
        if (!previous || hitRow !== previous) {
          throw constraintError("DUPLICATE_KEY", `Duplicate key value for ${table}(${group.join(",")})`);
        }
      }
    }

    return out;
  }

  private collectUniqueGroups(schema: TableSchema): string[][] {
    const groups: string[][] = [];
    const pushGroup = (g: string[]) => {
      if (!g.length) return;
      const norm = g.map((x) => x.trim());
      const key = norm.map((x) => x.toUpperCase()).join("|");
      if (!groups.some((ex) => ex.map((x) => x.toUpperCase()).join("|") === key)) groups.push(norm);
    };

    for (const c of schema.columns) {
      if (c.primaryKey || c.unique) pushGroup([c.name]);
    }
    if (schema.primaryKeyGroup?.length) pushGroup(schema.primaryKeyGroup);
    for (const g of schema.uniqueGroups ?? []) pushGroup(g);
    return groups;
  }

  private getUniqueGroups(table: string, schema?: TableSchema): string[][] {
    const cached = this.uniqueGroupsCache.get(table);
    if (cached) return cached;
    const resolvedSchema = schema ?? this.schemas.get(table);
    if (!resolvedSchema) return [];
    const groups = this.collectUniqueGroups(resolvedSchema);
    this.uniqueGroupsCache.set(table, groups);
    return groups;
  }

  private isPrimaryKeyMember(schema: TableSchema, column: string): boolean {
    if (schema.columns.some((c) => c.name.toUpperCase() === column.toUpperCase() && c.primaryKey)) return true;
    if (schema.primaryKeyGroup?.some((c) => c.toUpperCase() === column.toUpperCase())) return true;
    return false;
  }

  private uniqueGroupName(group: string[]): string {
    return group.map((x) => x.toUpperCase()).join("+");
  }

  private uniqueGroupValue(row: SqlRow, group: string[]): string | null {
    const vals: string[] = [];
    for (const c of group) {
      const v = row[c];
      if (v === null || v === undefined) return null;
      vals.push(String(v));
    }
    return vals.join("||");
  }

  private ensureUniqueIndexMaps(table: string): void {
    const schema = this.schemas.get(table);
    if (!schema) return;
    if (this.uniqueIndexes.has(table)) return;

    const idxMap = new Map<string, Map<string, SqlRow>>();
    for (const g of this.getUniqueGroups(table, schema)) {
      idxMap.set(this.uniqueGroupName(g), new Map<string, SqlRow>());
    }
    this.uniqueIndexes.set(table, idxMap);
  }

  private rebuildUniqueIndexes(table: string): void {
    const schema = this.schemas.get(table);
    if (!schema) {
      this.uniqueIndexes.delete(table);
      return;
    }

    const rows = this.requireTable(table);
    const idxMap = new Map<string, Map<string, SqlRow>>();
    for (const g of this.getUniqueGroups(table, schema)) {
      const colMap = new Map<string, SqlRow>();
      for (let i = 0; i < rows.length; i++) {
        const key = this.uniqueGroupValue(rows[i]!, g);
        if (key === null) continue;
        colMap.set(key, rows[i]!);
        this.bumpConstraintCost(table, { rowsIndexed: 1 });
      }
      idxMap.set(this.uniqueGroupName(g), colMap);
    }
    this.uniqueIndexes.set(table, idxMap);
    this.bumpConstraintCost(table, { rebuildOps: 1 });
  }

  private addRowToUniqueIndexes(table: string, row: SqlRow): void {
    const schema = this.schemas.get(table);
    if (!schema) return;
    this.ensureUniqueIndexMaps(table);
    const idxMap = this.uniqueIndexes.get(table);
    if (!idxMap) return;

    for (const g of this.getUniqueGroups(table, schema)) {
      const keyName = this.uniqueGroupName(g);
      const keyVal = this.uniqueGroupValue(row, g);
      if (keyVal === null) continue;
      idxMap.get(keyName)?.set(keyVal, row);
      this.bumpConstraintCost(table, { insertOps: 1, rowsIndexed: 1 });
    }
  }

  private removeRowFromUniqueIndexes(table: string, row: SqlRow): void {
    const schema = this.schemas.get(table);
    if (!schema) return;
    const idxMap = this.uniqueIndexes.get(table);
    if (!idxMap) return;

    for (const g of this.getUniqueGroups(table, schema)) {
      const keyName = this.uniqueGroupName(g);
      const keyVal = this.uniqueGroupValue(row, g);
      if (keyVal === null) continue;
      idxMap.get(keyName)?.delete(keyVal);
      this.bumpConstraintCost(table, { deleteOps: 1 });
    }
  }

  private replaceRowInUniqueIndexes(table: string, previous: SqlRow, next: SqlRow): void {
    this.removeRowFromUniqueIndexes(table, previous);
    this.addRowToUniqueIndexes(table, next);
    this.bumpConstraintCost(table, { updateOps: 1 });
  }

  private parseInsert(sql: string): SqlRow {
    const m = sql.match(/INSERT INTO\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\((.+)\)\s*VALUES\s*\((.+)\)/i);
    if (!m) throw sqlError("ERR_UNSUPPORTED_INSERT", sql);
    const cols = this.splitTopLevelComma(m[1]).map((c) => c.trim());
    const vals = this.smartSplit(m[2]).map((v) => this.castValue(v));
    if (cols.length !== vals.length) throw sqlError("ERR_UNSUPPORTED_INSERT", "INSERT column/value mismatch");
    const row: SqlRow = {};
    cols.forEach((c, i) => (row[c] = vals[i] ?? null));
    return row;
  }

  private planUpdate(sql: string): UpdatePlan {
    if (/^UPDATE\s+[a-zA-Z_][a-zA-Z0-9_]*(?:\s+(?:AS\s+)?[a-zA-Z_][a-zA-Z0-9_]*)?\s+(LEFT|RIGHT|FULL)(?:\s+OUTER)?\s+JOIN\b/i.test(sql)) {
      throw sqlError("ERR_UNSUPPORTED_UPDATE", `non-inner join UPDATE not supported yet: ${sql}`);
    }

    const joinM = sql.match(
      /^UPDATE\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?\s+(?:INNER\s+)?JOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?\s+ON\s+([a-zA-Z_][a-zA-Z0-9_\.]*)\s*=\s*([a-zA-Z_][a-zA-Z0-9_\.]*)\s+SET\s+([a-zA-Z_][a-zA-Z0-9_\.]*)\s*=\s*(.+?)(?:\s+WHERE\s+(.+))?$/i,
    );
    if (joinM) {
      const leftTable = joinM[1]!.trim();
      const leftAlias = joinM[2]?.trim() || leftTable;
      const rightTable = joinM[3]!.trim();
      const rightAlias = joinM[4]?.trim() || rightTable;
      this.assertJoinAliasSafety(leftTable, leftAlias, rightTable, rightAlias, "update", sql);
      return {
        table: joinM[1]!.trim(),
        setField: joinM[7]!.trim(),
        setValue: this.trimQuoted(joinM[8]!.trim()),
        whereExpr: joinM[9]?.trim() ?? "1 = 1",
        joinAware: true,
        join: {
          table: joinM[3]!.trim(),
          leftAlias: joinM[2]?.trim() || joinM[1]!.trim(),
          rightAlias: joinM[4]?.trim() || joinM[3]!.trim(),
          leftField: joinM[5]!.trim(),
          rightField: joinM[6]!.trim(),
        },
      };
    }

    const upper = sql.toUpperCase();
    const whereIdx = upper.indexOf(" WHERE ");
    const head = whereIdx >= 0 ? upper.slice(0, whereIdx) : upper;
    if (/\bUPDATE\s+[A-Z_][A-Z0-9_]*\s+SET\b[\s\S]*\bFROM\b/.test(head)) {
      throw sqlError("ERR_UNSUPPORTED_UPDATE", `join-aware UPDATE not supported yet: ${sql}`);
    }

    const parsed = this.parseUpdate(sql);
    return {
      table: parsed.table,
      setField: parsed.setField,
      setValue: parsed.setValue,
      whereExpr: parsed.whereExpr,
      joinAware: false,
    };
  }

  private planDelete(sql: string): DeletePlan {
    if (/^DELETE\s+[a-zA-Z_][a-zA-Z0-9_]*\s+FROM\s+[a-zA-Z_][a-zA-Z0-9_]*(?:\s+(?:AS\s+)?[a-zA-Z_][a-zA-Z0-9_]*)?\s+(LEFT|RIGHT|FULL)(?:\s+OUTER)?\s+JOIN\b/i.test(sql)) {
      throw sqlError("ERR_UNSUPPORTED_DELETE", `non-inner join DELETE not supported yet: ${sql}`);
    }

    const joinM = sql.match(
      /^DELETE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?\s+(?:INNER\s+)?JOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?\s+ON\s+([a-zA-Z_][a-zA-Z0-9_\.]*)\s*=\s*([a-zA-Z_][a-zA-Z0-9_\.]*)\s*(?:WHERE\s+(.+))?$/i,
    );
    if (joinM) {
      const targetAlias = joinM[1]!.trim();
      const leftTable = joinM[2]!.trim();
      const leftAlias = joinM[3]?.trim() || leftTable;
      const rightTable = joinM[4]!.trim();
      const rightAlias = joinM[5]?.trim() || rightTable;
      this.assertJoinAliasSafety(leftTable, leftAlias, rightTable, rightAlias, "delete", sql);
      if (targetAlias.toUpperCase() !== leftTable.toUpperCase() && targetAlias.toUpperCase() !== leftAlias.toUpperCase()) {
        throw sqlError("ERR_UNSUPPORTED_DELETE", `DELETE target must equal left table/alias: ${sql}`);
      }
      return {
        table: leftTable,
        whereExpr: joinM[8]?.trim() ?? "1 = 1",
        joinAware: true,
        join: {
          table: joinM[4]!.trim(),
          leftAlias,
          rightAlias: joinM[5]?.trim() || joinM[4]!.trim(),
          leftField: joinM[6]!.trim(),
          rightField: joinM[7]!.trim(),
        },
      };
    }

    if (/\bDELETE\s+FROM\s+[a-zA-Z_][a-zA-Z0-9_]*\s+USING\b/i.test(sql)) {
      throw sqlError("ERR_UNSUPPORTED_DELETE", `join-aware DELETE not supported yet: ${sql}`);
    }

    const parsed = this.parseDelete(sql);
    return {
      table: parsed.table,
      whereExpr: parsed.whereExpr,
      joinAware: false,
    };
  }

  private assertJoinAliasSafety(
    leftTable: string,
    leftAlias: string,
    rightTable: string,
    rightAlias: string,
    op: "update" | "delete",
    sql: string,
  ): void {
    const norm = (s: string) => s.trim().toUpperCase();
    const leftTableNorm = norm(leftTable);
    const rightTableNorm = norm(rightTable);

    const code = op === "update" ? "ERR_UNSUPPORTED_UPDATE" : "ERR_UNSUPPORTED_DELETE";

    if (leftTableNorm === rightTableNorm) {
      throw sqlError(code, `self-join in join-aware ${op} is not supported yet: ${sql}`);
    }

    const leftNames = new Set<string>([leftTableNorm, norm(leftAlias)]);
    const rightNames = new Set<string>([rightTableNorm, norm(rightAlias)]);

    for (const name of leftNames) {
      if (rightNames.has(name)) {
        throw sqlError(code, `conflicting join aliases/tables are not supported: ${sql}`);
      }
    }
  }

  private assertJoinOnFieldsExist(
    plan: UpdatePlan | DeletePlan,
    leftField: string,
    rightField: string,
    op: "update" | "delete",
  ): void {
    const leftSchema = this.schemas.get(plan.table);
    const rightSchema = plan.join ? this.schemas.get(plan.join.table) : undefined;

    const code = op === "update" ? "ERR_UNSUPPORTED_UPDATE" : "ERR_UNSUPPORTED_DELETE";

    if (leftSchema && !leftSchema.columns.some((c) => c.name.toUpperCase() === leftField.toUpperCase())) {
      throw sqlError(code, `ON left field not found on table ${plan.table}: ${leftField}`);
    }

    if (plan.join && rightSchema && !rightSchema.columns.some((c) => c.name.toUpperCase() === rightField.toUpperCase())) {
      throw sqlError(code, `ON right field not found on table ${plan.join.table}: ${rightField}`);
    }
  }

  private normalizeJoinOnFields(plan: UpdatePlan | DeletePlan, op: "update" | "delete"): { leftField: string; rightField: string } {
    const join = plan.join;
    if (!join) throw sqlError(op === "update" ? "ERR_UNSUPPORTED_UPDATE" : "ERR_UNSUPPORTED_DELETE", `${op} join missing`);

    const split = (s: string): string[] => s.split(".").map((x) => x.trim()).filter(Boolean);
    const leftParts = split(join.leftField);
    const rightParts = split(join.rightField);

    const leftAllow = new Set<string>([plan.table.toUpperCase()]);
    if (join.leftAlias) leftAllow.add(join.leftAlias.toUpperCase());

    const rightAllow = new Set<string>([join.table.toUpperCase()]);
    if (join.rightAlias) rightAllow.add(join.rightAlias.toUpperCase());

    const resolve = (parts: string[], allow: Set<string>, side: "left" | "right"): string => {
      if (parts.length === 1) return parts[0]!;
      if (parts.length === 2) {
        const [prefix, col] = parts;
        if (!allow.has(prefix.toUpperCase())) {
          const code = op === "update" ? "ERR_UNSUPPORTED_UPDATE" : "ERR_UNSUPPORTED_DELETE";
          throw sqlError(code, `ON ${side} field prefix must reference ${side} table/alias: ${prefix}`);
        }
        return col;
      }
      const code = op === "update" ? "ERR_UNSUPPORTED_UPDATE" : "ERR_UNSUPPORTED_DELETE";
      throw sqlError(code, `invalid ON ${side} field: ${parts.join(".")}`);
    };

    return {
      leftField: resolve(leftParts, leftAllow, "left"),
      rightField: resolve(rightParts, rightAllow, "right"),
    };
  }

  private resolveUpdateSetField(plan: UpdatePlan): string {
    const raw = plan.setField.trim();
    if (!raw.includes(".")) return raw;

    const parts = raw.split(".").map((x) => x.trim()).filter(Boolean);
    if (parts.length !== 2) {
      throw sqlError("ERR_UNSUPPORTED_UPDATE", `unsupported SET target: ${plan.setField}`);
    }

    const [prefix, col] = parts;
    const allowed = new Set<string>([plan.table.toUpperCase()]);
    if (plan.join?.leftAlias) allowed.add(plan.join.leftAlias.toUpperCase());

    if (!allowed.has(prefix.toUpperCase())) {
      throw sqlError("ERR_UNSUPPORTED_UPDATE", `SET target must reference left table/alias: ${plan.setField}`);
    }

    return col;
  }

  private parseUpdate(sql: string): { table: string; setField: string; setValue: string; whereExpr: string } {
    const m = sql.match(
      /UPDATE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+SET\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+?)(?:\s+WHERE\s+(.+))?$/i,
    );
    if (!m) throw sqlError("ERR_UNSUPPORTED_UPDATE", sql);
    return {
      table: m[1].trim(),
      setField: m[2].trim(),
      setValue: this.trimQuoted(m[3].trim()),
      whereExpr: m[4]?.trim() ?? "1 = 1",
    };
  }

  private parseDelete(sql: string): { table: string; whereExpr: string } {
    const m = sql.match(
      /DELETE FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+WHERE\s+(.+))?$/i,
    );
    if (!m) throw sqlError("ERR_UNSUPPORTED_DELETE", sql);
    return {
      table: m[1].trim(),
      whereExpr: m[2]?.trim() ?? "1 = 1",
    };
  }

  private exprAstToSql(expr?: ExprAst): string | undefined {
    return exprAstToSql(expr);
  }

  private isAllowedRawExpr(sql: string): boolean {
    const s = sql.trim();
    if (!s) return false;

    // currently supported raw expression buckets in evaluator path
    if (/\bOVER\s*\(/i.test(s)) return true; // window expressions in select list
    if (/\bIS\s+NOT\s+DISTINCT\s+FROM\b/i.test(s) || /\bIS\s+DISTINCT\s+FROM\b/i.test(s)) return true;
    if (/\bLIKE\b[\s\S]*\bESCAPE\b/i.test(s)) return true;
    if (/^CASE\b/i.test(s)) return true;
    if (/\bCAST\s*\(/i.test(s)) return true;
    if (/\b(?:NOT\s+)?EXISTS\s*\(\s*SELECT\b/i.test(s)) return true;
    if (/\b(?:ANY|SOME|ALL)\s*\(\s*SELECT\b/i.test(s)) return true;
    if (/\b(?:NOT\s+)?IN\s*\(\s*SELECT\b/i.test(s)) return true;
    if (/[=<>!]\s*\(\s*SELECT\b/i.test(s)) return true;

    return false;
  }

  private validateExprAst(expr?: ExprAst): void {
    if (!expr) return;

    switch (expr.kind) {
      case "raw": {
        if (!this.isAllowedRawExpr(expr.text)) {
          throw sqlError("ERR_UNSUPPORTED_RAW_EXPR", expr.text);
        }
        return;
      }
      case "binary":
        this.validateExprAst(expr.left);
        this.validateExprAst(expr.right);
        return;
      case "unary":
        this.validateExprAst(expr.expr);
        return;
      case "function":
        for (const arg of expr.args) this.validateExprAst(arg);
        return;
      default:
        return;
    }
  }

  private astSelectToParsedSelect(ast: SelectStatementAst): ParsedSelect {
    if (ast.from.kind !== "table") {
      throw sqlError("ERR_UNSUPPORTED_AST_FROM", ast.from.kind);
    }
    this.validateExprAst(ast.where);
    this.validateExprAst(ast.having);
    for (const it of ast.selectItems) this.validateExprAst(it.expr);
    for (const ob of ast.orderBy ?? []) this.validateExprAst(ob.expr);
    for (const gb of ast.groupBy ?? []) this.validateExprAst(gb);

    const table = ast.from.name;
    const where = ast.whereText ?? this.exprAstToSql(ast.where);
    const having = ast.havingText ?? this.exprAstToSql(ast.having);

    const groupBy = ast.groupBy?.map((g) => this.exprAstToSql(g) ?? "").filter(Boolean);

    const orderByList = ast.orderBy
      ?.map((o) => ({
        field: this.exprAstToSql(o.expr) ?? "",
        direction: o.direction,
      }))
      .filter((x) => x.field);

    const rowNumberItem = ast.selectItems.find(
      (it) => it.expr.kind === "raw" && /ROW_NUMBER\(\)\s+OVER\s*\(/i.test(it.expr.text),
    );
    const rowNumberAlias = rowNumberItem?.alias ?? (rowNumberItem ? "row_number" : undefined);
    const rowNumberSpec = rowNumberItem?.expr.kind === "raw"
      ? this.parseRowNumberSpec(rowNumberItem.expr.text)
      : undefined;

    const rawFieldTexts = ast.selectItems.map((it) => {
      if (it.expr.kind === "raw" && /ROW_NUMBER\(\)\s+OVER\s*\(/i.test(it.expr.text)) {
        return it.alias ?? "row_number";
      }
      const exprText = this.exprAstToSql(it.expr) ?? "";
      return it.alias ? `${exprText} AS ${it.alias}` : exprText;
    });

    const normalizedFieldTexts = ast.selectItems.map((it) => {
      if (it.alias) return it.alias;
      if (it.expr.kind === "function" && ["COUNT", "SUM", "AVG", "MIN", "MAX"].includes(it.expr.name)) {
        return it.expr.name.toLowerCase();
      }
      if (it.expr.kind === "raw" && /ROW_NUMBER\(\)\s+OVER\s*\(/i.test(it.expr.text)) {
        return rowNumberAlias ?? "row_number";
      }
      return this.exprAstToSql(it.expr) ?? "";
    });

    const aggregateItem = ast.selectItems.find(
      (it) => it.expr.kind === "function" && ["COUNT", "SUM", "AVG", "MIN", "MAX"].includes(it.expr.name),
    );
    const aggregate =
      aggregateItem?.expr.kind === "function" ? (aggregateItem.expr.name as ParsedSelect["aggregate"]) : undefined;
    const aggregateField =
      aggregateItem?.expr.kind === "function" ? (this.exprAstToSql(aggregateItem.expr.args[0]) ?? "*") : undefined;

    const fields = aggregate
      ? (normalizedFieldTexts as string[])
      : rawFieldTexts.length === 1 && rawFieldTexts[0] === "*"
        ? (["*"] as ["*"])
        : rawFieldTexts;

    const whereClauses = where ? this.tryParseWhere(where) : [];
    const whereTree = where ? this.parseWhereTree(where) : undefined;

    return {
      explain: ast.explain,
      table,
      fields,
      where,
      whereAst: ast.where,
      havingAst: ast.having,
      whereClauses,
      whereTree,
      limit: ast.limit,
      offset: ast.offset,
      orderBy: orderByList?.[0]?.field,
      orderDirection: orderByList?.[0]?.direction,
      orderByList,
      aggregate,
      aggregateField,
      groupBy,
      having,
      join: ast.join
        ? {
            type: ast.join.joinType,
            table: ast.join.table,
            leftField: ast.join.onLeft,
            rightField: ast.join.onRight,
          }
        : undefined,
      joins: ast.joins?.map((j) => ({
        type: j.joinType,
        table: j.table,
        leftField: j.onLeft,
        rightField: j.onRight,
      })),
      rowNumberAlias,
      rowNumberSpec,
    };
  }

  private inferUnionColumns(selectSql: string): string[] | undefined {
    const ast = parseSqlToAst(selectSql, { dialect: this.opts.dialect ?? "ansi" });
    if (ast.kind !== "select") return undefined;

    return ast.selectItems.map((it, idx) => {
      if (it.alias) return it.alias;
      if (it.expr.kind === "identifier") {
        const parts = it.expr.name.split(".");
        return parts[parts.length - 1] ?? `col${idx + 1}`;
      }
      if (it.expr.kind === "raw") {
        const asMatch = it.expr.text.match(/\s+AS\s+([a-zA-Z_][a-zA-Z0-9_]*)$/i);
        if (asMatch) return asMatch[1]!;
      }
      return `col${idx + 1}`;
    });
  }

  private normalizeUnionRow(row: SqlRow, columns: string[]): SqlRow {
    const values = Object.values(row);
    const out: SqlRow = {};
    columns.forEach((col, idx) => {
      out[col] = values[idx] ?? null;
    });
    return out;
  }

  private splitSelectTail(sql: string): {
    baseSql: string;
    orderByList?: Array<{ field: string; direction: "ASC" | "DESC" }>;
    limit?: number;
    offset?: number;
  } {
    const ast = parseSqlToAst(sql, { dialect: this.opts.dialect ?? "ansi" });
    if (ast.kind !== "select") {
      throw createSqlError("SQL_DIALECT_UNSUPPORTED_SYNTAX", {
        message: "UNION right branch must be a SELECT statement for tail planning",
        token: "UNION",
        dialect: this.opts.dialect ?? "ansi",
      });
    }

    const orderByList = ast.orderBy
      ? ast.orderBy.map((o) => {
          let field: string;
          if (o.expr.kind === "identifier") {
            field = o.expr.name;
          } else {
            const rendered = exprAstToSql(o.expr);
            if (!rendered) {
              throw createSqlError("SQL_SEMANTIC_UNKNOWN_IDENTIFIER", {
                message: "Unable to render ORDER BY expression in UNION tail",
                token: "ORDER BY",
              });
            }
            field = rendered;
          }
          return { field, direction: o.direction };
        })
      : undefined;

    const normalized = sql.trim().replace(/\s+/g, " ");
    const tailMatch = normalized.match(
      /^(.*?)(?:\s+ORDER\s+BY\s+.+?)?(?:\s+LIMIT\s+\d+)?(?:\s+OFFSET\s+\d+)?(?:\s+FETCH\s+(?:FIRST|NEXT)\s+\d+\s+ROWS?\s+ONLY)?\s*$/i,
    );

    return {
      baseSql: (tailMatch?.[1] ?? normalized).trim(),
      orderByList,
      limit: ast.limit,
      offset: ast.offset,
    };
  }

  private parseSelect(normalizedSql: string, rawSql: string): ParsedSelect {
    const ast = parseSqlToAst(rawSql, { dialect: this.opts.dialect ?? "ansi" });
    if (ast.kind === "select") {
      return this.astSelectToParsedSelect(ast);
    }

    const explain = /^EXPLAIN\s+/i.test(normalizedSql);
    const base = explain ? normalizedSql.replace(/^EXPLAIN\s+/i, "") : normalizedSql;

    const m = base.match(/^SELECT\s+(.+?)\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)\b(.*)$/i);
    if (!m) throw sqlError("ERR_UNSUPPORTED_SELECT", rawSql);

    const selectFields = m[1].trim();
    const table = m[2];
    let tail = m[3] ?? "";
    let join: ParsedSelect["join"];
    let joins: ParsedSelect["joins"];

    const joinMatches = Array.from(
      tail.matchAll(
        /\s+(INNER|LEFT|RIGHT)\s+JOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+ON\s+([a-zA-Z_][a-zA-Z0-9_\.]*)\s*=\s*([a-zA-Z_][a-zA-Z0-9_\.]*)/gi,
      ),
    );
    if (joinMatches.length) {
      joins = joinMatches.map((m) => ({
        type: m[1]!.toUpperCase() as "INNER" | "LEFT" | "RIGHT",
        table: m[2]!,
        leftField: m[3]!,
        rightField: m[4]!,
      }));
      join = joins[0];

      const last = joinMatches[joinMatches.length - 1]!;
      const consumed = last.index! + last[0].length;
      tail = tail.slice(consumed);
    }

    const tm = tail.match(
      /^(?:\s*WHERE\s+(.+?))?(?:\s*GROUP BY\s+(.+?))?(?:\s*HAVING\s+(.+?))?(?:\s*ORDER BY\s+(.+?))?(?:\s*LIMIT\s+(\d+))?(?:\s*OFFSET\s+(\d+))?\s*$/i,
    );
    if (!tm) throw sqlError("ERR_UNSUPPORTED_SELECT_CLAUSES", rawSql);

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
            if (!om) throw sqlError("ERR_UNSUPPORTED_ORDER_BY", part);
            const dir = om[2]?.trim().toUpperCase() as "ASC" | "DESC" | "";
            return { field: om[1], direction: (dir || "ASC") as "ASC" | "DESC" };
          })
      : undefined;

    const rawFieldList = selectFields.split(",").map((x) => x.trim());
    const rowNumberExpr = rawFieldList.find((f) => /^ROW_NUMBER\(\)\s+OVER\s*\(.+\)(?:\s+AS\s+[a-zA-Z_][a-zA-Z0-9_]*)?$/i.test(f));
    const rowNumberAlias = rowNumberExpr?.match(/\s+AS\s+([a-zA-Z_][a-zA-Z0-9_]*)$/i)?.[1] ?? "row_number";
    const rowNumberSpec = rowNumberExpr ? this.parseRowNumberSpec(rowNumberExpr) : undefined;

    const aggregateFieldExpr = rawFieldList.find((f) =>
      /^(COUNT|SUM|AVG|MIN|MAX)\((\*|[a-zA-Z_][a-zA-Z0-9_]*)\)(?:\s+AS\s+[a-zA-Z_][a-zA-Z0-9_]*)?$/i.test(f),
    );

    const aggregateMatch = aggregateFieldExpr?.match(
      /^(COUNT|SUM|AVG|MIN|MAX)\((\*|[a-zA-Z_][a-zA-Z0-9_]*)\)(?:\s+AS\s+[a-zA-Z_][a-zA-Z0-9_]*)?$/i,
    );
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

    const outputFieldList = rawFieldList.map((f) => {
      if (/^ROW_NUMBER\(\)\s+OVER\s*\(.+\)(?:\s+AS\s+[a-zA-Z_][a-zA-Z0-9_]*)?$/i.test(f)) {
        return rowNumberAlias;
      }
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
        joins,
        rowNumberAlias: rowNumberExpr ? rowNumberAlias : undefined,
        rowNumberSpec,
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
        joins,
        rowNumberAlias: rowNumberExpr ? rowNumberAlias : undefined,
        rowNumberSpec,
      };
    }

    return {
      explain,
      table,
      fields: outputFieldList as string[],
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
      joins,
      rowNumberAlias: rowNumberExpr ? rowNumberAlias : undefined,
      rowNumberSpec,
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

  private findTopLevelComparator(expr: string): { left: string; op: ComparePredicate; right: string } | null {
    let depth = 0;
    let quote = "";
    let word = "";
    let caseDepth = 0;

    const flushWord = () => {
      if (!word) return;
      const u = word.toUpperCase();
      if (u === "CASE") caseDepth++;
      else if (u === "END" && caseDepth > 0) caseDepth--;
      word = "";
    };

    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i]!;

      if (quote) {
        if (ch === quote) quote = "";
        continue;
      }

      if (ch === "'" || ch === '"') {
        flushWord();
        quote = ch;
        continue;
      }

      if (/[a-zA-Z0-9_]/.test(ch)) {
        word += ch;
      } else {
        flushWord();
      }

      if (ch === "(") {
        depth++;
        continue;
      }
      if (ch === ")") {
        depth = Math.max(0, depth - 1);
        continue;
      }

      if (depth !== 0 || caseDepth !== 0) continue;

      const two = expr.slice(i, i + 2);
      if ([">=", "<=", "!=", "<>"] .includes(two)) {
        return {
          left: expr.slice(0, i).trim(),
          op: two as ComparePredicate,
          right: expr.slice(i + 2).trim(),
        };
      }

      if (["=", ">", "<"].includes(ch)) {
        return {
          left: expr.slice(0, i).trim(),
          op: ch as ComparePredicate,
          right: expr.slice(i + 1).trim(),
        };
      }
    }

    return null;
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
      const leftParsed = this.parseFieldExpr(anyAllMatch.leftExpr);
      return {
        field: leftParsed.field,
        valueExpr: leftParsed.valueExpr,
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

    const truthPredMatch = expr.match(/^(.+?)\s+IS\s+(NOT\s+)?(TRUE|FALSE|UNKNOWN)$/i);
    if (truthPredMatch) {
      const leftParsed = this.parseFieldExpr(truthPredMatch[1]!);
      const subject = truthPredMatch[3]!.toUpperCase();
      const isNot = Boolean(truthPredMatch[2]);
      const op =
        subject === "TRUE"
          ? (isNot ? "IS_NOT_TRUE" : "IS_TRUE")
          : subject === "FALSE"
            ? (isNot ? "IS_NOT_FALSE" : "IS_FALSE")
            : (isNot ? "IS_NOT_UNKNOWN" : "IS_UNKNOWN");
      return {
        field: leftParsed.field,
        valueExpr: leftParsed.valueExpr,
        op,
      };
    }

    const distinctMatch = expr.match(/^(.+?)\s+IS\s+(NOT\s+)?DISTINCT\s+FROM\s+(.+)$/i);
    if (distinctMatch) {
      const leftParsed = this.parseFieldExpr(distinctMatch[1]!);
      return {
        field: leftParsed.field,
        valueExpr: leftParsed.valueExpr,
        op: distinctMatch[2] ? "IS_NOT_DISTINCT_FROM" : "IS_DISTINCT_FROM",
        valueExprs: [distinctMatch[3]!.trim()],
      };
    }

    const nullMatch = expr.match(/^(.+?)\s+IS\s+(NOT\s+)?NULL$/i);
    if (nullMatch) {
      const leftParsed = this.parseFieldExpr(nullMatch[1]!);
      return {
        field: leftParsed.field,
        valueExpr: leftParsed.valueExpr,
        op: nullMatch[2] ? "IS_NOT_NULL" : "IS_NULL",
      };
    }

    const betweenMatch = expr.match(/^(.+?)\s+(NOT\s+)?BETWEEN\s+(.+)\s+AND\s+(.+)$/i);
    if (betweenMatch) {
      const leftParsed = this.parseFieldExpr(betweenMatch[1]!);
      return {
        field: leftParsed.field,
        valueExpr: leftParsed.valueExpr,
        op: betweenMatch[2] ? "NOT_BETWEEN" : "BETWEEN",
        valueExprs: [betweenMatch[3]!.trim(), betweenMatch[4]!.trim()],
      };
    }

    const likeMatch = expr.match(/^(.+?)\s+(NOT\s+)?LIKE\s+(.+?)(?:\s+ESCAPE\s+(.+))?$/i);
    if (likeMatch) {
      const leftParsed = this.parseFieldExpr(likeMatch[1]!);
      const escRaw = likeMatch[4] ? this.trimQuoted(likeMatch[4].trim()) : undefined;
      const esc = escRaw && escRaw.length > 0 ? escRaw[0] : undefined;
      return {
        field: leftParsed.field,
        valueExpr: leftParsed.valueExpr,
        op: likeMatch[2] ? "NOT_LIKE" : "LIKE",
        valueExprs: [likeMatch[3]!.trim()],
        likeEscape: esc,
      };
    }

    const inSubqueryMatch = expr.match(/^(.+?)\s+(NOT\s+)?IN\s*\(\s*(SELECT\s+.+)\s*\)$/i);
    if (inSubqueryMatch) {
      const leftParsed = this.parseFieldExpr(inSubqueryMatch[1]!);
      return {
        field: leftParsed.field,
        valueExpr: leftParsed.valueExpr,
        op: inSubqueryMatch[2] ? "NOT_IN_SUBQUERY" : "IN_SUBQUERY",
        subquerySql: inSubqueryMatch[3],
      };
    }

    const inMatch = expr.match(/^(.+?)\s+(NOT\s+)?IN\s*\((.+)\)$/i);
    if (inMatch) {
      const leftParsed = this.parseFieldExpr(inMatch[1]!);
      return {
        field: leftParsed.field,
        valueExpr: leftParsed.valueExpr,
        op: inMatch[2] ? "NOT_IN" : "IN",
        valueExprs: this.smartSplit(inMatch[3]).map((v) => v.trim()),
      };
    }

    const cmpMatch = this.findTopLevelComparator(expr);
    if (cmpMatch) {
      const leftParsed = this.parseFieldExpr(cmpMatch.left);
      return {
        field: leftParsed.field,
        valueExpr: leftParsed.valueExpr,
        op: cmpMatch.op as CompareOp,
        valueExprs: [cmpMatch.right],
      };
    }

    throw sqlError("ERR_UNSUPPORTED_WHERE", token);
  }

  private parseSubquerySelect(subquerySql: string, outerRow?: SqlRow): SqlRow[] {
    const normalized = subquerySql.trim().replace(/\s+/g, " ");
    const m = normalized.match(/^SELECT\s+(.+?)\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+WHERE\s+(.+))?$/i);
    if (!m) throw sqlError("ERR_UNSUPPORTED_SUBQUERY", subquerySql);

    const fieldExpr = m[1]!.trim();
    const table = m[2]!.trim();
    const where = m[3]?.trim();

    const rows = this.requireTable(table);
    const boundWhere = where && outerRow ? this.bindOuterRefs(where, outerRow) : where;
    const filtered = boundWhere
      ? rows.filter((r) => this.evaluateWhereTree(r, this.parseWhereTree(boundWhere)) === "TRUE")
      : rows;

    if (fieldExpr === "*") return filtered.map((r) => ({ ...r }));

    const aggMatch = fieldExpr.match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\((\*|[a-zA-Z_][a-zA-Z0-9_\.]*)\)(?:\s+AS\s+([a-zA-Z_][a-zA-Z0-9_\.]*))?$/i,
    );
    if (aggMatch) {
      const fn = aggMatch[1]!.toUpperCase();
      const aggField = aggMatch[2]!;
      const alias = aggMatch[3] ?? fn.toLowerCase();

      if (fn === "COUNT") {
        const count = aggField === "*"
          ? filtered.length
          : filtered.filter((r) => this.resolveRowValue(r, aggField) !== null && this.resolveRowValue(r, aggField) !== undefined).length;
        return [{ [alias]: count }];
      }

      const nums = filtered
        .map((r) => Number(this.resolveRowValue(r, aggField)))
        .filter((n) => Number.isFinite(n));

      if (fn === "SUM") return [{ [alias]: nums.length ? nums.reduce((a, b) => a + b, 0) : null }];
      if (fn === "AVG") return [{ [alias]: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null }];
      if (fn === "MIN") return [{ [alias]: nums.length ? Math.min(...nums) : null }];
      if (fn === "MAX") return [{ [alias]: nums.length ? Math.max(...nums) : null }];
    }

    const fields = fieldExpr.split(",").map((x) => x.trim()).filter(Boolean);
    return filtered.map((row) => {
      const out: SqlRow = {};
      for (const f of fields) out[f] = this.evalExpr(row, f) ?? null;
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
    if (keys.length !== 1) throw sqlError("ERR_UNSUPPORTED_SUBQUERY", `Subquery must return exactly 1 column: ${subquerySql}`);
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
    | { leftExpr: string; compareOp: ComparePredicate; quantifier: "ANY" | "ALL"; subquerySql: string }
    | null {
    const m = expr.match(
      /^(.+?)\s*(=|!=|<>|>=|<=|>|<)\s*(ANY|SOME|ALL)\s*\((SELECT\s+.+)\)$/i,
    );
    if (!m) return null;
    return {
      leftExpr: m[1]!.trim(),
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

  private evalExpr(row: SqlRow, exprRaw: string): SqlPrimitive | undefined {
    const expr = this.trimOuterParentheses(exprRaw.trim());

    if (/^NULL$/i.test(expr)) return null;
    if (/^TRUE$/i.test(expr)) return true;
    if (/^FALSE$/i.test(expr)) return false;

    const caseMatch = expr.match(/^CASE\s+WHEN\s+(.+?)\s+THEN\s+(.+?)\s+ELSE\s+(.+?)\s+END$/i);
    if (caseMatch) {
      const cond = this.evaluateWhereTree(row, this.parseWhereTree(caseMatch[1]!));
      const branch = cond === "TRUE" ? caseMatch[2]! : caseMatch[3]!;
      return this.evalExpr(row, branch);
    }

    const coalesceMatch = expr.match(/^COALESCE\((.+)\)$/i);
    if (coalesceMatch) {
      for (const p of this.smartSplit(coalesceMatch[1]!)) {
        const v = this.evalExpr(row, p);
        if (v !== null && v !== undefined) return v;
      }
      return null;
    }

    const nullifMatch = expr.match(/^NULLIF\((.+),(.+)\)$/i);
    if (nullifMatch) {
      const a = this.evalExpr(row, nullifMatch[1]!);
      const b = this.evalExpr(row, nullifMatch[2]!);
      return this.eq(a, b) ? null : a;
    }

    const castMatch = expr.match(/^CAST\((.+)\s+AS\s+(TEXT|INT|INTEGER|REAL)\)$/i);
    if (castMatch) {
      const v = this.evalExpr(row, castMatch[1]!);
      const t = castMatch[2]!.toUpperCase();
      if (v === null || v === undefined) return null;
      if (t === "TEXT") return String(v);
      if (t === "INT" || t === "INTEGER") {
        const n = Number(v);
        return Number.isFinite(n) ? Math.trunc(n) : null;
      }
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }

    if (/^[a-zA-Z_][a-zA-Z0-9_\.]*$/.test(expr)) return this.resolveRowValue(row, expr);

    const lit = this.castValue(expr);
    if (expr.startsWith("'") || expr.startsWith('"') || typeof lit !== "string") return lit;

    const toks = this.tokenizeExpr(expr);
    if (toks.length === 0) return null;
    const rpn = this.toRpn(toks);
    return this.evalRpn(row, rpn);
  }

  private tokenizeExpr(expr: string): string[] {
    const out: string[] = [];
    let buf = "";
    let quote = "";
    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i]!;
      if (quote) {
        buf += ch;
        if (ch === quote) {
          out.push(buf);
          buf = "";
          quote = "";
        }
        continue;
      }
      if (ch === "'" || ch === '"') {
        if (buf.trim()) out.push(buf.trim());
        buf = ch;
        quote = ch;
        continue;
      }
      if (/\s/.test(ch)) {
        if (buf.trim()) out.push(buf.trim());
        buf = "";
        continue;
      }
      if ("()+-*/%".includes(ch)) {
        if (buf.trim()) out.push(buf.trim());
        out.push(ch);
        buf = "";
        continue;
      }
      buf += ch;
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
  }

  private toRpn(tokens: string[]): string[] {
    const out: string[] = [];
    const ops: string[] = [];
    const pri: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "u-": 3 };

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      if (t === "(") {
        ops.push(t);
        continue;
      }
      if (t === ")") {
        while (ops.length && ops[ops.length - 1] !== "(") out.push(ops.pop()!);
        ops.pop();
        continue;
      }
      if (["+", "-", "*", "/", "%"].includes(t)) {
        const prev = tokens[i - 1];
        const unary = t === "-" && (i === 0 || prev === "(" || ["+", "-", "*", "/", "%"].includes(prev!));
        const op = unary ? "u-" : t;
        while (ops.length && pri[ops[ops.length - 1]!] >= pri[op]) out.push(ops.pop()!);
        ops.push(op);
        continue;
      }
      out.push(t);
    }

    while (ops.length) out.push(ops.pop()!);
    return out;
  }

  private evalRpn(row: SqlRow, rpn: string[]): SqlPrimitive | undefined {
    const st: Array<SqlPrimitive | undefined> = [];
    for (const t of rpn) {
      if (t === "u-") {
        const a = st.pop();
        if (a == null) {
          st.push(null);
        } else {
          const n = Number(a);
          st.push(Number.isFinite(n) ? -n : null);
        }
        continue;
      }
      if (["+", "-", "*", "/", "%"].includes(t)) {
        const b = st.pop();
        const a = st.pop();
        if (a == null || b == null) {
          st.push(null);
          continue;
        }
        const an = Number(a);
        const bn = Number(b);
        if (!Number.isFinite(an) || !Number.isFinite(bn)) {
          st.push(null);
          continue;
        }
        if (t === "+") st.push(an + bn);
        else if (t === "-") st.push(an - bn);
        else if (t === "*") st.push(an * bn);
        else if (t === "/") st.push(bn === 0 ? null : an / bn);
        else st.push(bn === 0 ? null : an % bn);
        continue;
      }

      if (/^[a-zA-Z_][a-zA-Z0-9_\.]*$/.test(t)) {
        st.push(this.resolveRowValue(row, t));
      } else {
        st.push(this.castValue(t));
      }
    }

    return st.length ? st[st.length - 1] : null;
  }

  private parseFieldExpr(input: string): { field: string; valueExpr?: string } {
    const s = input.trim();
    const cm = s.match(/^(.+)\s+AS\s+([a-zA-Z_][a-zA-Z0-9_\.]*)$/i);
    if (cm) return { field: cm[2]!, valueExpr: cm[1]!.trim() };

    if (/^[a-zA-Z_][a-zA-Z0-9_\.]*$/.test(s)) return { field: s };
    return { field: s, valueExpr: s };
  }

  private resolveRowValue(row: SqlRow, field: string): SqlPrimitive | undefined {
    return resolveIdentifierValue(row, field, "strict");
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
    return toTruthValue(value);
  }

  private evaluateWhereAst(row: SqlRow, expr: ExprAst, fallbackSql?: string): TruthValue {
    // prefer semantic 3VL evaluator for non-raw AST
    if (expr.kind !== "raw") return evalPredicate3VL(expr, row, "strict");

    const sql = (fallbackSql && fallbackSql.trim()) || this.exprAstToSql(expr);
    if (!sql) return "UNKNOWN";
    return this.evaluateWhereTree(row, this.parseWhereTree(sql));
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
    if (clause.op === "EXISTS" || clause.op === "NOT_EXISTS") {
      const subquerySql = String(clause.value ?? "");
      const exists = this.parseSubquerySelect(subquerySql, row).length > 0;
      const tv: TruthValue = exists ? "TRUE" : "FALSE";
      return clause.op === "EXISTS" ? tv : this.tvNot(tv);
    }

    const left = clause.valueExpr ? this.evalExpr(row, clause.valueExpr) : this.resolveRowValue(row, clause.field);

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
      const values = (clause.valueExprs?.length ? clause.valueExprs.map((v) => this.evalExpr(row, v) ?? null) : clause.values) ?? [];
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
      const lower = clause.valueExprs?.[0] ? this.evalExpr(row, clause.valueExprs[0]) : clause.values?.[0];
      const upper = clause.valueExprs?.[1] ? this.evalExpr(row, clause.valueExprs[1]) : clause.values?.[1];
      const ge = this.compareByOp(left, lower, ">=");
      const le = this.compareByOp(left, upper, "<=");
      const inRange = this.tvAnd(ge, le);
      return clause.op === "BETWEEN" ? inRange : this.tvNot(inRange);
    }

    const right = clause.subquerySql
      ? this.parseSubqueryValues(clause.subquerySql, undefined, row)[0] ?? null
      : clause.valueExprs?.[0]
        ? this.evalExpr(row, clause.valueExprs[0])
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

  private parseRowNumberSpec(rawExpr: string): ParsedSelect["rowNumberSpec"] {
    const m = rawExpr.match(/ROW_NUMBER\(\)\s+OVER\s*\((.+)\)/i);
    if (!m) return undefined;

    const inside = m[1].trim();
    const pm = inside.match(/PARTITION\s+BY\s+(.+?)(?:\s+ORDER\s+BY\s+(.+))?$/i);
    const om = inside.match(/ORDER\s+BY\s+(.+)$/i);

    const partitionBy = pm
      ? pm[1]
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      : [];

    const orderExpr = pm ? pm[2] : om?.[1];
    const orderBy = orderExpr
      ? orderExpr
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
          .map((part) => {
            const mm = part.match(/^([a-zA-Z_][a-zA-Z0-9_\.]*)((?:\s+(?:ASC|DESC))?)$/i);
            if (!mm) return { field: part, direction: "ASC" as const };
            const dir = mm[2]?.trim().toUpperCase() as "ASC" | "DESC" | "";
            return { field: mm[1], direction: (dir || "ASC") as "ASC" | "DESC" };
          })
      : [];

    return { partitionBy, orderBy };
  }

  private applyRowNumber(
    rows: SqlRow[],
    alias: string,
    spec?: ParsedSelect["rowNumberSpec"],
  ): SqlRow[] {
    if (!spec || (!spec.partitionBy.length && !spec.orderBy.length)) {
      return rows.map((row, idx) => ({ ...row, [alias]: idx + 1 }));
    }

    const groups = new Map<string, Array<{ row: SqlRow; idx: number }>>();
    rows.forEach((row, idx) => {
      const key = spec.partitionBy.map((f) => String(this.resolveRowValue(row, f) ?? "")).join("||");
      const arr = groups.get(key) ?? [];
      arr.push({ row, idx });
      groups.set(key, arr);
    });

    const byOriginalIndex = new Map<number, SqlRow>();
    for (const groupRows of groups.values()) {
      const sorted = [...groupRows].sort((a, b) => {
        for (const ord of spec.orderBy) {
          const av = this.resolveRowValue(a.row, ord.field);
          const bv = this.resolveRowValue(b.row, ord.field);
          const c = this.compareForOrder(av, bv, ord.direction);
          if (c !== 0) return c;
        }
        return a.idx - b.idx;
      });

      sorted.forEach((entry, i) => {
        byOriginalIndex.set(entry.idx, { ...entry.row, [alias]: i + 1 });
      });
    }

    return rows.map((_, idx) => byOriginalIndex.get(idx) ?? { ...rows[idx], [alias]: idx + 1 });
  }

  private applyOrder(rows: SqlRow[], orderByList?: Array<{ field: string; direction: "ASC" | "DESC" }>): SqlRow[] {
    if (!orderByList?.length) return rows;
    return [...rows].sort((a, b) => {
      for (const { field, direction } of orderByList) {
        const cmp = this.compareForOrder(a[field], b[field], direction);
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
  }

  private compareForOrder(
    a: SqlPrimitive | undefined,
    b: SqlPrimitive | undefined,
    direction: "ASC" | "DESC",
  ): number {
    const aNull = a === null || a === undefined;
    const bNull = b === null || b === undefined;
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;

    const base = this.compare(a, b);
    return direction === "DESC" ? -base : base;
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
      throw sqlError("ERR_UNSUPPORTED_SELECT", `${aggregate} requires a numeric field`);
    }

    const nums = rows
      .map((r) => r[aggregateField])
      .filter((v) => v !== null && v !== undefined)
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n));

    if (aggregate === "SUM") return { sum: nums.reduce((a, b) => a + b, 0) };
    if (aggregate === "AVG") return { avg: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0 };
    if (aggregate === "MIN") return { min: nums.length ? Math.min(...nums) : null };
    return { max: nums.length ? Math.max(...nums) : null };
  }

  private pickFields(row: SqlRow, fields: string[] | ["*"]): SqlRow {
    if (fields.length === 1 && fields[0] === "*") return row;
    const out: SqlRow = {};
    for (const f of fields) {
      const parsed = this.parseFieldExpr(f);
      const key = parsed.field;
      const val = parsed.valueExpr ? this.evalExpr(row, parsed.valueExpr) : row[key];
      out[key] = val ?? null;
    }
    return out;
  }

  private makeRowKey(row: SqlRow): string {
    const ordered = Object.keys(row)
      .sort()
      .reduce((acc, k) => {
        acc[k] = row[k] ?? null;
        return acc;
      }, {} as SqlRow);
    return JSON.stringify(ordered);
  }

  private eq(a: SqlPrimitive | undefined, b: SqlPrimitive | undefined): boolean {
    if (a == null && b == null) return true;
    return String(a) === String(b);
  }

  private compare(a: SqlPrimitive | undefined, b: SqlPrimitive | undefined): number {
    const aNull = a === null || a === undefined;
    const bNull = b === null || b === undefined;
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;

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
    if (/^[+-]?\d+$/.test(v)) {
      try {
        const parsed = BigInt(v);
        if (parsed < MIN_SAFE_INTEGER_BIGINT || parsed > MAX_SAFE_INTEGER_BIGINT) return v;
        return Number(v);
      } catch {
        return v;
      }
    }
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
