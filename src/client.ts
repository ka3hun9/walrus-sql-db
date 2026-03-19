import { randomUUID, createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { evalPredicate3VL, resolveIdentifierValue, toTruthValue } from "./sql-semantics.js";
import {
  createTransactionLogRecord,
  convertTypedValue,
  encodeBlob,
  fromJs,
  fromLiteral,
  fromStorage,
  normalizeRuntimeTypeName,
  SqlRuntimeType,
  typedValueComparator,
  typedValueOperators,
  verifyTransactionLogRecordChecksum,
} from "./types.js";
import type {
  ExecuteResult,
  DurabilityRecoverySummary,
  QueryProofResult,
  QueryResult,
  SessionTransactionState,
  SqlPrimitive,
  SqlRow,
  SqlRuntimeTypeMetadata,
  SqlRuntimeTypeName,
  SqlTypedValue,
  StorageWriteEvent,
  StorageWriteOperation,
  TransactionObservabilityStats,
  TransactionCommitBatchPayload,
  TransactionLogRecord,
  TransactionLogWriteEntry,
  TransactionLogWriteOperation,
  IndexVersionedStorageObject,
  VersionedStorageObject,
  WalrusSqlClientOptions,
} from "./types.js";
import { buildMoveCall } from "./onchain.js";
import { parseSqlToAst } from "./sql-parser.js";
import { exprAstToSql } from "./sql-ast-eval.js";
import { SqlEngineError, createSqlError } from "./sql-errors.js";
import type {
  CreateIndexStatementAst,
  CreateViewStatementAst,
  DropIndexStatementAst,
  DropViewStatementAst,
  ExprAst,
  SqlAstStatement,
  SelectStatementAst,
  SqlTransactionAction,
} from "./sql-ast.js";
import { normalizeSql } from "./sql-executor.js";
import { ClientErrorCodeEnum, ConstraintViolationKindEnum, sqlError, constraintError, type ClientErrorCode } from "./engine-errors.js";
import { createLogger, type Logger } from "./logger.js";
import {
  emptyConstraintCostStats,
  type ColumnSchema,
  type ColumnTypeSpec,
  type ConstraintIndexCostStats,
  type ForeignKeySpec,
  type IndexCatalogEntry,
  type SqlTypeName,
  type TableSchema,
  type ViewDependencyEntry,
  type ViewCatalogEntry,
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
const MAX_FK_CASCADE_DEPTH = 16;
const VIEW_DEPENDENCY_WILDCARD = "*";
const VIEW_DEPENDENCY_KEYWORDS = new Set<string>([
  "SELECT",
  "FROM",
  "WHERE",
  "GROUP",
  "BY",
  "HAVING",
  "ORDER",
  "LIMIT",
  "OFFSET",
  "FETCH",
  "FIRST",
  "NEXT",
  "ROWS",
  "ROW",
  "ONLY",
  "AS",
  "AND",
  "OR",
  "NOT",
  "ON",
  "INNER",
  "LEFT",
  "RIGHT",
  "FULL",
  "OUTER",
  "JOIN",
  "UNION",
  "INTERSECT",
  "EXCEPT",
  "ALL",
  "DISTINCT",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "IN",
  "IS",
  "NULL",
  "TRUE",
  "FALSE",
  "EXISTS",
  "ANY",
  "SOME",
  "BETWEEN",
  "LIKE",
  "ESCAPE",
  "CAST",
  "TOP",
]);

type TruthValue = "TRUE" | "FALSE" | "UNKNOWN";

type ComparePredicate = "=" | "!=" | "<>" | ">" | "<" | ">=" | "<=";
type ViewPolicyAction = "CREATE" | "DROP" | "SELECT";

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
    type: "INNER" | "LEFT" | "RIGHT" | "FULL";
    table: string;
    leftField: string;
    rightField: string;
  };
  joins?: Array<{
    type: "INNER" | "LEFT" | "RIGHT" | "FULL";
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

type LogicalPredicateSource = "AST" | "TREE" | "CLAUSES" | "NONE";

type LogicalRewriteRule =
  | "RULE_CANONICALIZE_JOIN_CHAIN"
  | "RULE_PREFER_AST_PREDICATE"
  | "RULE_NORMALIZE_ORDER_BY_DIRECTION"
  | "RULE_COST_BASED_JOIN_REORDER";

type SelectJoinStep = NonNullable<ParsedSelect["joins"]>[number];

type LogicalJoinReorderInfo = {
  applied: boolean;
  algorithm: "NONE" | "GREEDY_CBO";
  estimatedCost: number | null;
  originalJoinOrder: string[];
  finalJoinOrder: string[];
};

type LogicalSelectPlan = {
  table: string;
  fields: string[] | ["*"];
  joins: SelectJoinStep[];
  joinReorder: LogicalJoinReorderInfo;
  predicateSource: LogicalPredicateSource;
  where?: string;
  having?: string;
  groupBy?: string[];
  aggregate?: ParsedSelect["aggregate"];
  aggregateField?: string;
  orderByList?: Array<{ field: string; direction: "ASC" | "DESC" }>;
  limit?: number;
  offset?: number;
  rowNumberAlias?: string;
  rowNumberSpec?: ParsedSelect["rowNumberSpec"];
  rewriteRules: LogicalRewriteRule[];
};

type PhysicalAccessPathMethod =
  | "TABLE_SCAN"
  | "HASH_INDEX_LOOKUP"
  | "BTREE_INDEX_LOOKUP"
  | "BTREE_ORDERED_SCAN";

type PhysicalIndexAccessStrategy = "FULL_TABLE_SCAN" | "INDEX_SCAN" | "INDEX_BACK_TABLE";

type PlanStabilityReason = "NONE" | "PLAN_STABILITY_PIN" | "BAD_PLAN_FALLBACK_PIN";
type JoinExecutionAlgorithm = "NESTED_LOOP" | "HASH_JOIN" | "SORT_MERGE_JOIN";

type PhysicalSelectAccessPath = {
  method: PhysicalAccessPathMethod;
  indexStrategy: PhysicalIndexAccessStrategy;
  estimatedCost: number;
  estimatedRows: number;
  orderSatisfied: boolean;
  indexName?: string;
  indexColumn?: string;
};

type PhysicalSelectRuntimePath = PhysicalSelectAccessPath & {
  rows: SqlRow[];
};

type PhysicalJoinPlanStep = {
  algorithm: JoinExecutionAlgorithm;
  estimatedCost: number;
  estimatedOutputRows: number;
  leftRows: number;
  rightRows: number;
};

type PhysicalSelectPlan = {
  optimizerChosen: PhysicalSelectAccessPath;
  chosen: PhysicalSelectAccessPath;
  candidates: PhysicalSelectAccessPath[];
  joinAlgorithms: PhysicalJoinPlanStep[];
  stabilityReason: PlanStabilityReason;
  stabilityPinned: boolean;
};

type SelectExecutionPlan = {
  logical: LogicalSelectPlan;
  physical: PhysicalSelectPlan;
  scannedRows: SqlRow[];
  orderSatisfied: boolean;
};

type DmlPlan = {
  table: string;
  whereExpr: string;
  joinAware: boolean;
};

type BoundColumnValues = Record<string, SqlTypedValue>;

type UpdatePlan = DmlPlan & {
  setField: string;
  setValue: string;
  join?: {
    type: "INNER" | "LEFT" | "RIGHT" | "FULL";
    table: string;
    leftAlias?: string;
    rightAlias?: string;
    leftField: string;
    rightField: string;
  };
};

type DeletePlan = DmlPlan & {
  join?: {
    type: "INNER" | "LEFT" | "RIGHT" | "FULL";
    table: string;
    leftAlias?: string;
    rightAlias?: string;
    leftField: string;
    rightField: string;
  };
};

type SessionTransactionEvent = "begin" | "commit" | "commit_done" | "rollback" | "error";

type TransactionTableWriteStats = {
  insertRows: number;
  updateRows: number;
  deleteRows: number;
};

type TransactionTableWriteSet = {
  rows: SqlRow[];
  uniqueIndexes: Map<string, Map<string, SqlRow>>;
  stats: TransactionTableWriteStats;
};

type TransactionWriteSet = {
  tables: Map<string, TransactionTableWriteSet>;
  logEntries: TransactionLogWriteEntry[];
  observedVersions: Map<string, Map<string, number>>;
};

type QueryCacheEntry = {
  rows: SqlRow[];
  cachedAt: number;
  writeVersion: number;
};

type BtreeIndexLeafEntry = {
  key: SqlPrimitive;
  rows: Set<SqlRow>;
};

type BtreeRuntimeIndex = {
  column: string;
  entries: BtreeIndexLeafEntry[];
};

type BtreeRuntimeIndexMap = Map<string, BtreeRuntimeIndex>;

type BtreeRangeBound = {
  value: SqlPrimitive;
  inclusive: boolean;
};

type BtreeRangePredicate = {
  lower?: BtreeRangeBound;
  upper?: BtreeRangeBound;
};

type TransactionTableCommitSnapshot = {
  hadTableRows: boolean;
  rows?: SqlRow[];
  hadUniqueIndexes: boolean;
  uniqueIndexes?: Map<string, Map<string, SqlRow>>;
  hadHashIndexes: boolean;
  hashIndexes?: Map<string, Map<string, Set<SqlRow>>>;
  hadHashIndexStats: boolean;
  hashIndexStats?: { keys: number; rowsIndexed: number };
  hadBtreeIndexes: boolean;
  btreeIndexes?: BtreeRuntimeIndexMap;
  hadBtreeIndexStats: boolean;
  btreeIndexStats?: { keys: number; rowsIndexed: number };
};

type TransactionCommitRuntimeSnapshot = {
  tableSnapshots: Map<string, TransactionTableCommitSnapshot>;
  dirtyTables: Set<string>;
  storageWriteLog: StorageWriteEvent[];
  rowVersions: Map<string, Map<string, number>>;
  tableVersionObjects: Map<string, VersionedStorageObject[]>;
  indexVersionObjects: Map<string, IndexVersionedStorageObject[]>;
  optimizerStatsVersionObjects: Map<string, OptimizerStatsVersionedStorageObject[]>;
  indexObservability: Map<string, IndexObservabilityStats>;
  writeVersion: number;
  queryCache: Map<string, QueryCacheEntry>;
};

type TransactionTableCommitSideEffect = {
  table: string;
  stats: TransactionTableWriteStats;
};

type TransactionWalEntryPhase = "PREPARE" | "COMMIT" | "ROLLBACK";

type TransactionWalEntry = {
  phase: TransactionWalEntryPhase;
  txnId: string;
  at: number;
  record?: TransactionLogRecord;
};

type ReadCommittedView = {
  isolationLevel: "read_committed";
  getTableRows: (name: string) => SqlRow[];
};

type TransactionObservabilityAccumulator = {
  started: number;
  committed: number;
  aborted: number;
  totalTxnLatencyMs: number;
  maxTxnLatencyMs: number;
  totalLockWaitMs: number;
  lockWaitEvents: number;
};

type IndexObservabilityStats = {
  lookupCount: number;
  lookupHits: number;
  lookupMisses: number;
  maintenanceInsertOps: number;
  maintenanceUpdateOps: number;
  maintenanceDeleteOps: number;
  maintenanceRebuildOps: number;
  maintenanceRows: number;
};

type SelectPlanStabilityState = {
  preferredMethod: PhysicalAccessPathMethod;
  preferredIndexName?: string;
  preferredIndexColumn?: string;
  badPlanFallbackRemaining: number;
  badPlanFallbackCount: number;
  stablePinCount: number;
  planSwitchCount: number;
  executions: number;
  lastReason: PlanStabilityReason | "BAD_PLAN_TRIGGER";
};

type ParsedSubqueryPlan = {
  normalizedSql: string;
  fieldExpr: string;
  table: string;
  tableAlias?: string;
  where?: string;
  whereTree?: WhereExprNode;
  outerRefs: string[];
};

type SubqueryExecutionStats = {
  executions: number;
  correlatedExecutions: number;
  cacheHits: number;
  cacheMisses: number;
  rowsScanned: number;
  rowsReturned: number;
  budgetExceededCount: number;
};

type SubqueryRuntimeState = {
  depth: number;
  costUnits: number;
  costBudget: number;
  planCache: Map<string, ParsedSubqueryPlan>;
  resultCache: Map<string, SqlRow[]>;
};

type OptimizerHistogramBucket = {
  lowerBound: SqlPrimitive;
  upperBound: SqlPrimitive;
  rowCount: number;
  ndv: number;
};

type OptimizerColumnStatistics = {
  column: string;
  rowCount: number;
  ndv: number;
  nullCount: number;
  nullRatio: number;
  histogram: OptimizerHistogramBucket[];
};

type OptimizerTableStatistics = {
  table: string;
  rowCount: number;
  analyzedAt: number;
  columns: OptimizerColumnStatistics[];
};

type OptimizerStatsVersionedStorageObject = {
  table: string;
  objectId: string;
  version: number;
  prevVersion: number | null;
  currentVersion: number;
  commitDigest: string;
  createdAt: number;
  analyzedAt: number;
  confirmationStatus: "pending" | "confirmed";
  immutable: true;
  statistics: OptimizerTableStatistics;
};

type OptimizerStatisticsReadOptions = {
  source?: "live" | "versioned";
  visibility?: "pending" | "confirmed";
  version?: number;
};

type OptimizerStatisticsVersionDiffColumn = {
  column: string;
  rowCountDelta: number;
  ndvDelta: number;
  nullCountDelta: number;
  nullRatioDelta: number;
  histogramBucketDelta: number;
  histogramRowCountDelta: number;
  histogramNdvDelta: number;
};

type OptimizerStatisticsVersionDiff = {
  table: string;
  fromVersion: number;
  toVersion: number;
  rowCountDelta: number;
  analyzedAtDeltaMs: number;
  addedColumns: string[];
  removedColumns: string[];
  changedColumns: OptimizerStatisticsVersionDiffColumn[];
};

const SESSION_TRANSACTION_TRANSITIONS: Record<
  SessionTransactionState,
  Partial<Record<SessionTransactionEvent, SessionTransactionState>>
> = {
  idle: {
    begin: "active",
  },
  active: {
    commit: "committing",
    rollback: "idle",
    error: "aborted",
  },
  committing: {
    commit_done: "idle",
    error: "aborted",
  },
  aborted: {
    rollback: "idle",
    error: "aborted",
  },
};

const SELECT_PLAN_STABILITY_SWITCH_RATIO = 0.85;
const BAD_PLAN_FALLBACK_SCAN_RATIO = 0.85;
const BAD_PLAN_FALLBACK_RESULT_RATIO = 0.8;
const BAD_PLAN_FALLBACK_MIN_TABLE_ROWS = 32;
const BAD_PLAN_FALLBACK_COOLDOWN = 3;
const OPTIMIZER_HISTOGRAM_MAX_BUCKETS = 8;
const INDEX_BACK_TABLE_FETCH_RATIO = 1.1;
const DEFAULT_PREDICATE_SELECTIVITY = 0.25;
const DEFAULT_EQUALITY_SELECTIVITY = 0.1;
const DEFAULT_RANGE_SELECTIVITY = 1 / 3;
const DEFAULT_LIKE_SELECTIVITY = 0.2;
const DEFAULT_JOIN_SELECTIVITY = 0.1;
const HASH_JOIN_STARTUP_COST = 8;
const HASH_JOIN_BUILD_ROW_THRESHOLD = 64;
const HASH_JOIN_SPILL_PENALTY_FACTOR = 4;
const SORT_MERGE_SORT_WORK_FACTOR = 0.2;
const SORT_MERGE_JOIN_STARTUP_COST = 12;
const CORRELATED_SUBQUERY_COST_BUDGET = 250_000;
const CORRELATED_SUBQUERY_RESULT_CACHE_LIMIT = 512;

export class WalrusSqlClient {
  private readonly opts: WalrusSqlClientOptions;
  private readonly isolationLevel: "read_committed";
  private readonly tables = new Map<string, SqlRow[]>();
  private readonly schemas = new Map<string, TableSchema>();
  private readonly indexCatalog = new Map<string, IndexCatalogEntry>();
  private readonly viewCatalog = new Map<string, ViewCatalogEntry>();
  private readonly hashIndexes = new Map<string, Map<string, Map<string, Set<SqlRow>>>>();
  private readonly hashIndexStats = new Map<string, { keys: number; rowsIndexed: number }>();
  private readonly btreeIndexes = new Map<string, BtreeRuntimeIndexMap>();
  private readonly btreeIndexStats = new Map<string, { keys: number; rowsIndexed: number }>();
  private readonly uniqueIndexes = new Map<string, Map<string, Map<string, SqlRow>>>();
  private readonly uniqueGroupsCache = new Map<string, string[][]>();
  private readonly constraintCost = new Map<string, ConstraintIndexCostStats>();
  private readonly dirtyTables = new Set<string>();
  private readonly queryCache = new Map<string, QueryCacheEntry>();
  private readonly storageWriteLog: StorageWriteEvent[] = [];
  private readonly rowVersions = new Map<string, Map<string, number>>();
  private readonly tableVersionObjects = new Map<string, VersionedStorageObject[]>();
  private readonly indexVersionObjects = new Map<string, IndexVersionedStorageObject[]>();
  private readonly optimizerStatsVersionObjects = new Map<string, OptimizerStatsVersionedStorageObject[]>();
  private readonly indexObservability = new Map<string, IndexObservabilityStats>();
  private readonly selectPlanStability = new Map<string, SelectPlanStabilityState>();
  private readonly subqueryExecutionStats = new Map<string, SubqueryExecutionStats>();
  private readonly logger: Logger;
  private transactionState: SessionTransactionState = "idle";
  private transactionWriteSet: TransactionWriteSet | null = null;
  private transactionStartedAt: number | null = null;
  private currentTransactionLockWaitMs = 0;
  private readonly transactionObservability: TransactionObservabilityAccumulator = {
    started: 0,
    committed: 0,
    aborted: 0,
    totalTxnLatencyMs: 0,
    maxTxnLatencyMs: 0,
    totalLockWaitMs: 0,
    lockWaitEvents: 0,
  };
  private writeVersion = 0;
  private subqueryRuntime: SubqueryRuntimeState | null = null;
  private readonly activeViewResolutionStack: string[] = [];

  constructor(opts: WalrusSqlClientOptions) {
    this.opts = opts;
    const isolation = String(opts.isolationLevel ?? "read_committed").toLowerCase();
    if (isolation !== "read_committed") {
      throw sqlError(
        ClientErrorCodeEnum.TransactionState,
        `unsupported isolation level: ${String(opts.isolationLevel)}`,
        { clause: "TRANSACTION", token: String(opts.isolationLevel) },
      );
    }
    this.isolationLevel = "read_committed";
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

  getTransactionState(): SessionTransactionState {
    return this.transactionState;
  }

  getIsolationLevel(): "read_committed" {
    return this.isolationLevel;
  }

  getTransactionObservabilityStats(): TransactionObservabilityStats {
    const { started, committed, aborted, totalTxnLatencyMs, maxTxnLatencyMs, totalLockWaitMs, lockWaitEvents } = this.transactionObservability;
    const finished = committed + aborted;
    return {
      started,
      committed,
      aborted,
      abortRatio: finished > 0 ? aborted / finished : 0,
      avgTxnLatencyMs: finished > 0 ? totalTxnLatencyMs / finished : 0,
      maxTxnLatencyMs,
      totalTxnLatencyMs,
      totalLockWaitMs,
      lockWaitEvents,
    };
  }

  private getTransactionTimeoutMs(): number {
    const raw = this.opts.transactionTimeoutMs;
    if (raw === undefined) return 0;
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.floor(raw));
  }

  private assertTransactionNotTimedOut(sql: string): void {
    if (this.transactionState !== "active") return;
    const timeoutMs = this.getTransactionTimeoutMs();
    if (timeoutMs <= 0) return;
    if (this.transactionStartedAt === null) return;
    if (Date.now() - this.transactionStartedAt <= timeoutMs) return;

    this.transitionTransactionState("error", sql);
    this.clearTransactionWriteSet();
    this.recordTransactionOutcome("aborted");
    this.transactionStartedAt = null;
    throw sqlError(
      ClientErrorCodeEnum.TransactionState,
      `transaction timeout exceeded (${timeoutMs}ms): ${sql}`,
      { clause: "TRANSACTION", token: "TIMEOUT" },
    );
  }

  private tryParseTransactionAction(sql: string): SqlTransactionAction | null {
    const first = sql.split(/\s+/, 1)[0]?.toUpperCase();
    if (first !== "BEGIN" && first !== "COMMIT" && first !== "ROLLBACK") return null;
    const ast = parseSqlToAst(sql, { dialect: this.opts.dialect ?? "ansi" });
    if (ast.kind !== "transaction") {
      throw sqlError(
        ClientErrorCodeEnum.TransactionState,
        `transaction control parse mismatch: ${sql}`,
        { clause: "TRANSACTION" },
      );
    }
    return ast.action;
  }

  private transitionTransactionState(event: SessionTransactionEvent, sql: string): SessionTransactionState {
    const current = this.transactionState;
    const next = SESSION_TRANSACTION_TRANSITIONS[current][event];
    if (!next) {
      throw sqlError(
        ClientErrorCodeEnum.TransactionState,
        `invalid transaction transition: state=${current}, event=${event}, sql=${sql}`,
        { clause: "TRANSACTION", token: event.toUpperCase() },
      );
    }
    this.transactionState = next;
    return next;
  }

  private recordTransactionOutcome(outcome: "committed" | "aborted"): void {
    const startedAt = this.transactionStartedAt;
    const latency = startedAt === null ? 0 : Math.max(0, Date.now() - startedAt);

    if (outcome === "committed") this.transactionObservability.committed += 1;
    else this.transactionObservability.aborted += 1;

    this.transactionObservability.totalTxnLatencyMs += latency;
    this.transactionObservability.maxTxnLatencyMs = Math.max(this.transactionObservability.maxTxnLatencyMs, latency);
    this.currentTransactionLockWaitMs = 0;
  }

  private assertStatementAllowedDuringTransaction(sql: string): void {
    if (this.transactionState === "aborted") {
      throw sqlError(
        ClientErrorCodeEnum.TransactionState,
        `transaction is aborted; run ROLLBACK before statement: ${sql}`,
        { clause: "TRANSACTION", token: "ROLLBACK" },
      );
    }
    if (this.transactionState === "committing") {
      throw sqlError(
        ClientErrorCodeEnum.TransactionState,
        `transaction is committing; wait for COMMIT to finish before statement: ${sql}`,
        { clause: "COMMIT" },
      );
    }
  }

  private isDdlStatement(sql: string): boolean {
    return /^(?:CREATE|ALTER|DROP)\b/i.test(sql);
  }

  private assertDdlTransactionPolicy(sql: string): void {
    if (this.transactionState !== "active") return;
    if (!this.isDdlStatement(sql)) return;
    const token = sql.split(/\s+/, 1)[0]?.toUpperCase() ?? "DDL";
    throw sqlError(
      ClientErrorCodeEnum.UnsupportedDdl,
      `DDL statements are not supported in active transactions (policy=forbid_ddl_in_tx): ${sql}`,
      { clause: "TRANSACTION", token },
    );
  }

  private transitionTransactionToAbortedOnError(sql: string): void {
    if (this.transactionState !== "active" && this.transactionState !== "committing") return;
    this.transitionTransactionState("error", sql);
    this.clearTransactionWriteSet();
    this.recordTransactionOutcome("aborted");
    this.transactionStartedAt = null;
  }

  private async waitTransactionCommitTurn(): Promise<void> {
    // Use a macrotask boundary so "committing" remains observable for concurrent calls
    // until COMMIT finishes and transitions to idle.
    const startedAt = Date.now();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const waitedMs = Math.max(0, Date.now() - startedAt);
    this.currentTransactionLockWaitMs += waitedMs;
    this.transactionObservability.totalLockWaitMs += waitedMs;
    if (waitedMs > 0) this.transactionObservability.lockWaitEvents += 1;
  }

  private isSimulatorMode(): boolean {
    return (this.opts.mode ?? "simulator") === "simulator";
  }

  private createEmptyTransactionWriteSet(): TransactionWriteSet {
    return {
      tables: new Map<string, TransactionTableWriteSet>(),
      logEntries: [],
      observedVersions: new Map<string, Map<string, number>>(),
    };
  }

  private clearTransactionWriteSet(): void {
    if (!this.transactionWriteSet) return;
    this.transactionWriteSet.tables.clear();
    this.transactionWriteSet.logEntries.length = 0;
    this.transactionWriteSet.observedVersions.clear();
    this.transactionWriteSet = null;
  }

  private getWalFilePath(): string | null {
    const cfg = this.opts.wal;
    if (!cfg?.enabled) return null;
    const normalized = (cfg.filePath ?? ".cache/walrus-sql/transaction.wal.ndjson").trim();
    return normalized.length > 0 ? normalized : ".cache/walrus-sql/transaction.wal.ndjson";
  }

  private getWalArchivePath(): string | null {
    const walPath = this.getWalFilePath();
    if (!walPath) return null;
    const configured = this.opts.wal?.archivePath?.trim();
    if (configured && configured.length > 0) return configured;
    return `${walPath}.archive.ndjson`;
  }

  private getWalCheckpointPath(): string | null {
    const walPath = this.getWalFilePath();
    if (!walPath) return null;
    const configured = this.opts.wal?.checkpointPath?.trim();
    if (configured && configured.length > 0) return configured;
    return `${walPath}.checkpoint.json`;
  }

  private getWalRetentionMaxEntries(): number {
    const raw = this.opts.wal?.maxEntries;
    if (raw === undefined) return 2_000;
    if (!Number.isFinite(raw)) return 2_000;
    return Math.max(1, Math.floor(raw));
  }

  private parseTransactionWalEntry(line: string): TransactionWalEntry | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== "object") return null;
    const payload = parsed as Partial<TransactionWalEntry>;
    if (payload.phase !== "PREPARE" && payload.phase !== "COMMIT" && payload.phase !== "ROLLBACK") return null;
    if (typeof payload.txnId !== "string" || payload.txnId.trim().length === 0) return null;
    if (typeof payload.at !== "number" || !Number.isFinite(payload.at)) return null;
    return payload as TransactionWalEntry;
  }

  private async loadWalLines(): Promise<string[]> {
    const walPath = this.getWalFilePath();
    if (!walPath) return [];

    let text = "";
    try {
      text = await readFile(walPath, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") return [];
      throw this.wrapAsyncError(err, ClientErrorCodeEnum.ExecutionFailed, "failed to read WAL file");
    }

    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  private collectPendingWalRecords(lines: string[]): Map<string, TransactionLogRecord> {
    const pending = new Map<string, TransactionLogRecord>();

    for (const line of lines) {
      const entry = this.parseTransactionWalEntry(line);
      if (!entry) {
        this.logger.warn("skip malformed WAL line during scan", { line });
        continue;
      }

      if (entry.phase === "PREPARE") {
        if (!entry.record || !verifyTransactionLogRecordChecksum(entry.record)) {
          this.logger.warn("skip WAL PREPARE with invalid/missing checksum", { txnId: entry.txnId });
          continue;
        }
        pending.set(entry.txnId, entry.record);
        continue;
      }

      pending.delete(entry.txnId);
    }

    return pending;
  }

  private async enforceWalRetention(): Promise<void> {
    const walPath = this.getWalFilePath();
    if (!walPath) return;

    const maxEntries = this.getWalRetentionMaxEntries();
    const lines = await this.loadWalLines();
    if (lines.length <= maxEntries) return;

    const pendingTxnIds = new Set<string>(this.collectPendingWalRecords(lines).keys());
    const keepFlags = lines.map(() => true);
    let keptCount = lines.length;
    for (let idx = 0; idx < lines.length && keptCount > maxEntries; idx += 1) {
      const entry = this.parseTransactionWalEntry(lines[idx]!);
      if (entry && pendingTxnIds.has(entry.txnId)) continue;
      keepFlags[idx] = false;
      keptCount -= 1;
    }

    if (keptCount === lines.length) return;

    const archivedLines: string[] = [];
    const keptLines: string[] = [];
    for (let idx = 0; idx < lines.length; idx += 1) {
      if (keepFlags[idx]) keptLines.push(lines[idx]!);
      else archivedLines.push(lines[idx]!);
    }

    const archivePath = this.getWalArchivePath();
    if (archivePath && archivedLines.length > 0) {
      await mkdir(dirname(archivePath), { recursive: true });
      await appendFile(archivePath, `${archivedLines.join("\n")}\n`, "utf8");
    }

    const nextWalBody = keptLines.length > 0 ? `${keptLines.join("\n")}\n` : "";
    await writeFile(walPath, nextWalBody, "utf8");
  }

  private async appendTransactionWalEntry(entry: TransactionWalEntry): Promise<void> {
    const walPath = this.getWalFilePath();
    if (!walPath) return;

    await mkdir(dirname(walPath), { recursive: true });
    await appendFile(walPath, `${JSON.stringify(entry)}\n`, "utf8");
    await this.enforceWalRetention();
  }

  async checkpointWal(): Promise<{ checkpointPath: string | null; pendingTxnIds: string[]; walLineCount: number }> {
    const checkpointPath = this.getWalCheckpointPath();
    if (!checkpointPath) return { checkpointPath: null, pendingTxnIds: [], walLineCount: 0 };

    const walPath = this.getWalFilePath()!;
    const lines = await this.loadWalLines();
    const pending = this.collectPendingWalRecords(lines);
    const payload = {
      at: Date.now(),
      walPath,
      walLineCount: lines.length,
      pendingTxnIds: [...pending.keys()],
      pendingRecords: [...pending.values()],
    };

    await mkdir(dirname(checkpointPath), { recursive: true });
    await writeFile(checkpointPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await this.enforceWalRetention();

    return {
      checkpointPath,
      pendingTxnIds: payload.pendingTxnIds,
      walLineCount: payload.walLineCount,
    };
  }

  private encodeRowVersionKey(key: Record<string, SqlPrimitive>): string {
    const ordered: Record<string, SqlPrimitive> = {};
    for (const column of Object.keys(key).sort()) ordered[column] = key[column] ?? null;
    return JSON.stringify(ordered);
  }

  private getOrCreateRowVersionsForTable(table: string): Map<string, number> {
    const existing = this.rowVersions.get(table);
    if (existing) return existing;
    const created = new Map<string, number>();
    this.rowVersions.set(table, created);
    return created;
  }

  private getCommittedRowVersion(table: string, key: Record<string, SqlPrimitive>): number {
    const encoded = this.encodeRowVersionKey(key);
    const versions = this.rowVersions.get(table);
    return versions?.get(encoded) ?? 0;
  }

  private getCommittedRowVersionByEncodedKey(table: string, encodedKey: string): number {
    const versions = this.rowVersions.get(table);
    return versions?.get(encodedKey) ?? 0;
  }

  private rememberObservedRowVersion(table: string, key: Record<string, SqlPrimitive>): void {
    const staged = this.transactionWriteSet;
    if (!staged) return;

    let tableObserved = staged.observedVersions.get(table);
    if (!tableObserved) {
      tableObserved = new Map<string, number>();
      staged.observedVersions.set(table, tableObserved);
    }

    const encoded = this.encodeRowVersionKey(key);
    if (tableObserved.has(encoded)) return;
    tableObserved.set(encoded, this.getCommittedRowVersionByEncodedKey(table, encoded));
  }

  private assertNoWriteConflicts(staged: TransactionWriteSet): void {
    for (const [table, observed] of staged.observedVersions.entries()) {
      for (const [encodedKey, expectedVersion] of observed.entries()) {
        const currentVersion = this.getCommittedRowVersionByEncodedKey(table, encodedKey);
        if (currentVersion === expectedVersion) continue;
        throw constraintError(
          ConstraintViolationKindEnum.WriteConflict,
          `write conflict detected on ${table}; expectedVersion=${expectedVersion}, currentVersion=${currentVersion}`,
          { clause: "COMMIT", token: `${table}:${encodedKey}` },
        );
      }
    }
  }

  private applyCommittedRowVersions(staged: TransactionWriteSet): void {
    const finalOps = new Map<string, Map<string, TransactionLogWriteOperation>>();
    for (const entry of staged.logEntries) {
      let tableOps = finalOps.get(entry.table);
      if (!tableOps) {
        tableOps = new Map<string, TransactionLogWriteOperation>();
        finalOps.set(entry.table, tableOps);
      }
      tableOps.set(this.encodeRowVersionKey(entry.key), entry.op);
    }

    for (const [table, tableOps] of finalOps.entries()) {
      const versions = this.getOrCreateRowVersionsForTable(table);
      for (const [encodedKey, op] of tableOps.entries()) {
        if (op === "DELETE") {
          versions.delete(encodedKey);
          continue;
        }
        versions.set(encodedKey, (versions.get(encodedKey) ?? 0) + 1);
      }
    }
  }

  private applyImmediateRowVersion(table: string, op: TransactionLogWriteOperation, row: SqlRow): void {
    const key = this.buildTransactionRowKey(table, row);
    const encoded = this.encodeRowVersionKey(key);
    const versions = this.getOrCreateRowVersionsForTable(table);
    if (op === "DELETE") {
      versions.delete(encoded);
      return;
    }
    versions.set(encoded, (versions.get(encoded) ?? 0) + 1);
  }

  private toImmutableRows(rows: SqlRow[]): ReadonlyArray<Readonly<SqlRow>> {
    return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
  }

  private cloneVersionObject(object: VersionedStorageObject): VersionedStorageObject {
    return {
      ...object,
      rows: object.rows.map((row) => ({ ...row })),
    };
  }

  private recordImmutableVersionObject(table: string, rows: SqlRow[]): void {
    const history = this.tableVersionObjects.get(table) ?? [];
    const prevVersion = history[history.length - 1]?.currentVersion ?? null;
    const currentVersion = (prevVersion ?? 0) + 1;
    const version = currentVersion;
    const immutableRows = this.toImmutableRows(rows);
    const createdAt = Date.now();
    const commitDigest = createHash("sha256")
      .update(JSON.stringify({ table, prevVersion, currentVersion, createdAt, rows: immutableRows }))
      .digest("hex");
    const objectId = `0x${commitDigest.slice(0, 40)}`;

    const object = Object.freeze({
      table,
      objectId,
      version,
      prevVersion,
      currentVersion,
      commitDigest,
      createdAt,
      confirmationStatus: this.opts.transactionCommitExecutor ? "pending" as const : "confirmed" as const,
      immutable: true as const,
      rows: immutableRows,
    }) as VersionedStorageObject;

    history.push(object);
    this.tableVersionObjects.set(table, history);
  }

  getTableVersionObjects(table?: string): VersionedStorageObject[] | Record<string, VersionedStorageObject[]> {
    if (table) {
      return (this.tableVersionObjects.get(table) ?? []).map((object) => this.cloneVersionObject(object));
    }

    const out: Record<string, VersionedStorageObject[]> = {};
    for (const [name, history] of this.tableVersionObjects.entries()) {
      out[name] = history.map((object) => this.cloneVersionObject(object));
    }
    return out;
  }

  confirmVersionObject(table: string, version?: number): VersionedStorageObject | null {
    const history = this.tableVersionObjects.get(table);
    if (!history || history.length === 0) return null;
    const targetVersion = version ?? history[history.length - 1]!.currentVersion;
    const idx = history.findIndex((object) => object.currentVersion === targetVersion);
    if (idx < 0) return null;

    const current = history[idx]!;
    if (current.confirmationStatus === "confirmed") return this.cloneVersionObject(current);

    const confirmed = Object.freeze({
      ...current,
      confirmationStatus: "confirmed" as const,
    }) as VersionedStorageObject;
    history[idx] = confirmed;
    return this.cloneVersionObject(confirmed);
  }

  private cloneIndexVersionObjectPayload(
    payload: IndexVersionedStorageObject["payload"],
  ): IndexVersionedStorageObject["payload"] {
    if (payload.indexType === "HASH") {
      return {
        indexType: "HASH",
        buckets: payload.buckets.map((bucket) => ({
          encodedKey: bucket.encodedKey,
          rowKeys: [...bucket.rowKeys],
        })),
      };
    }

    return {
      indexType: "BTREE",
      entries: payload.entries.map((entry) => ({
        key: entry.key,
        rowKeys: [...entry.rowKeys],
      })),
    };
  }

  private toImmutableIndexVersionObjectPayload(
    payload: IndexVersionedStorageObject["payload"],
  ): IndexVersionedStorageObject["payload"] {
    const cloned = this.cloneIndexVersionObjectPayload(payload);
    if (cloned.indexType === "HASH") {
      return Object.freeze({
        indexType: "HASH" as const,
        buckets: Object.freeze(cloned.buckets.map((bucket) => Object.freeze({
          encodedKey: bucket.encodedKey,
          rowKeys: Object.freeze([...bucket.rowKeys]),
        }))),
      });
    }

    return Object.freeze({
      indexType: "BTREE" as const,
      entries: Object.freeze(cloned.entries.map((entry) => Object.freeze({
        key: entry.key,
        rowKeys: Object.freeze([...entry.rowKeys]),
      }))),
    });
  }

  private cloneIndexVersionObject(object: IndexVersionedStorageObject): IndexVersionedStorageObject {
    return {
      ...object,
      payload: this.cloneIndexVersionObjectPayload(object.payload),
    };
  }

  private encodeIndexRowRefKey(table: string, row: SqlRow): string {
    return this.encodeRowVersionKey(this.buildTransactionRowKey(table, row));
  }

  private getActiveIndexEntriesForTable(table: string): IndexCatalogEntry[] {
    const upper = table.toUpperCase();
    return [...this.indexCatalog.values()]
      .filter((entry) =>
        entry.table.toUpperCase() === upper
          && entry.status === "ACTIVE"
          && entry.columns.length === 1
          && (entry.type === "HASH" || entry.type === "BTREE"))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private recordImmutableIndexVersionObject(entry: IndexCatalogEntry): void {
    const indexName = this.normalizeIndexName(entry.name);
    const table = entry.table;
    const column = entry.columns[0]!;
    const history = this.indexVersionObjects.get(indexName) ?? [];
    const prevVersion = history[history.length - 1]?.currentVersion ?? null;
    const currentVersion = (prevVersion ?? 0) + 1;
    const version = currentVersion;
    const createdAt = Date.now();

    let keyCount = 0;
    let rowCount = 0;
    let payload: IndexVersionedStorageObject["payload"];

    if (entry.type === "HASH") {
      const buckets = this.hashIndexes.get(table)?.get(indexName);
      const serializedBuckets = [...(buckets?.entries() ?? [])]
        .map(([encodedKey, rows]) => {
          const rowKeys = [...new Set(
            [...rows].map((row) => this.encodeIndexRowRefKey(table, row)),
          )].sort();
          return { encodedKey, rowKeys };
        })
        .sort((a, b) => a.encodedKey.localeCompare(b.encodedKey));
      keyCount = serializedBuckets.length;
      rowCount = serializedBuckets.reduce((sum, bucket) => sum + bucket.rowKeys.length, 0);
      payload = this.toImmutableIndexVersionObjectPayload({
        indexType: "HASH",
        buckets: serializedBuckets,
      });
    } else {
      const runtime = this.btreeIndexes.get(table)?.get(indexName);
      const serializedEntries = (runtime?.entries ?? [])
        .map((leaf) => {
          const rowKeys = [...new Set(
            [...leaf.rows].map((row) => this.encodeIndexRowRefKey(table, row)),
          )].sort();
          return { key: leaf.key, rowKeys };
        });
      keyCount = serializedEntries.length;
      rowCount = serializedEntries.reduce((sum, leaf) => sum + leaf.rowKeys.length, 0);
      payload = this.toImmutableIndexVersionObjectPayload({
        indexType: "BTREE",
        entries: serializedEntries,
      });
    }

    const digestPayload = this.cloneIndexVersionObjectPayload(payload);
    const commitDigest = createHash("sha256")
      .update(JSON.stringify({
        table,
        indexName,
        indexType: entry.type,
        column,
        prevVersion,
        currentVersion,
        createdAt,
        payload: digestPayload,
      }))
      .digest("hex");
    const objectId = `0x${commitDigest.slice(0, 40)}`;

    const object = Object.freeze({
      table,
      indexName,
      column,
      indexType: entry.type,
      objectId,
      version,
      prevVersion,
      currentVersion,
      commitDigest,
      createdAt,
      confirmationStatus: this.opts.transactionCommitExecutor ? "pending" as const : "confirmed" as const,
      immutable: true as const,
      keyCount,
      rowCount,
      payload,
    }) as IndexVersionedStorageObject;

    history.push(object);
    this.indexVersionObjects.set(indexName, history);
  }

  private recordImmutableIndexVersionObjectsForTable(table: string): void {
    for (const entry of this.getActiveIndexEntriesForTable(table)) {
      this.recordImmutableIndexVersionObject(entry);
    }
  }

  getIndexVersionObjects(indexName?: string): IndexVersionedStorageObject[] | Record<string, IndexVersionedStorageObject[]> {
    if (indexName) {
      const normalized = this.normalizeIndexName(indexName);
      return (this.indexVersionObjects.get(normalized) ?? []).map((object) => this.cloneIndexVersionObject(object));
    }

    const out: Record<string, IndexVersionedStorageObject[]> = {};
    for (const [name, history] of this.indexVersionObjects.entries()) {
      out[name] = history.map((object) => this.cloneIndexVersionObject(object));
    }
    return out;
  }

  confirmIndexVersionObject(indexName: string, version?: number): IndexVersionedStorageObject | null {
    const normalized = this.normalizeIndexName(indexName);
    const history = this.indexVersionObjects.get(normalized);
    if (!history || history.length === 0) return null;
    const targetVersion = version ?? history[history.length - 1]!.currentVersion;
    const idx = history.findIndex((object) => object.currentVersion === targetVersion);
    if (idx < 0) return null;

    const current = history[idx]!;
    if (current.confirmationStatus === "confirmed") return this.cloneIndexVersionObject(current);

    const confirmed = Object.freeze({
      ...current,
      confirmationStatus: "confirmed" as const,
    }) as IndexVersionedStorageObject;
    history[idx] = confirmed;
    return this.cloneIndexVersionObject(confirmed);
  }

  private cloneOptimizerHistogramBucket(bucket: OptimizerHistogramBucket): OptimizerHistogramBucket {
    return {
      lowerBound: bucket.lowerBound,
      upperBound: bucket.upperBound,
      rowCount: bucket.rowCount,
      ndv: bucket.ndv,
    };
  }

  private cloneOptimizerColumnStatistics(column: OptimizerColumnStatistics): OptimizerColumnStatistics {
    return {
      column: column.column,
      rowCount: column.rowCount,
      ndv: column.ndv,
      nullCount: column.nullCount,
      nullRatio: column.nullRatio,
      histogram: column.histogram.map((bucket) => this.cloneOptimizerHistogramBucket(bucket)),
    };
  }

  private cloneOptimizerTableStatistics(stats: OptimizerTableStatistics): OptimizerTableStatistics {
    return {
      table: stats.table,
      rowCount: stats.rowCount,
      analyzedAt: stats.analyzedAt,
      columns: stats.columns.map((column) => this.cloneOptimizerColumnStatistics(column)),
    };
  }

  private toImmutableOptimizerTableStatistics(stats: OptimizerTableStatistics): OptimizerTableStatistics {
    const cloned = this.cloneOptimizerTableStatistics(stats);
    return Object.freeze({
      table: cloned.table,
      rowCount: cloned.rowCount,
      analyzedAt: cloned.analyzedAt,
      columns: Object.freeze(
        cloned.columns.map((column) =>
          Object.freeze({
            column: column.column,
            rowCount: column.rowCount,
            ndv: column.ndv,
            nullCount: column.nullCount,
            nullRatio: column.nullRatio,
            histogram: Object.freeze(
              column.histogram.map((bucket) =>
                Object.freeze({
                  lowerBound: bucket.lowerBound,
                  upperBound: bucket.upperBound,
                  rowCount: bucket.rowCount,
                  ndv: bucket.ndv,
                }),
              ),
            ),
          }),
        ),
      ),
    }) as OptimizerTableStatistics;
  }

  private cloneOptimizerStatsVersionObject(
    object: OptimizerStatsVersionedStorageObject,
  ): OptimizerStatsVersionedStorageObject {
    return {
      ...object,
      statistics: this.cloneOptimizerTableStatistics(object.statistics),
    };
  }

  private recordImmutableOptimizerStatsVersionObject(table: string, options?: { confirmationStatus?: "pending" | "confirmed" }): void {
    const stats = this.collectOptimizerStatisticsForTable(table);
    if (!stats) return;

    const history = this.optimizerStatsVersionObjects.get(table) ?? [];
    const prevVersion = history[history.length - 1]?.currentVersion ?? null;
    const currentVersion = (prevVersion ?? 0) + 1;
    const version = currentVersion;
    const createdAt = Date.now();
    const statistics = this.toImmutableOptimizerTableStatistics(stats);
    const commitDigest = createHash("sha256")
      .update(JSON.stringify({
        table,
        prevVersion,
        currentVersion,
        createdAt,
        statistics,
      }))
      .digest("hex");
    const objectId = `0x${commitDigest.slice(0, 40)}`;

    const confirmationStatus = options?.confirmationStatus
      ?? (this.opts.transactionCommitExecutor ? "pending" as const : "confirmed" as const);

    const object = Object.freeze({
      table,
      objectId,
      version,
      prevVersion,
      currentVersion,
      commitDigest,
      createdAt,
      analyzedAt: statistics.analyzedAt,
      confirmationStatus,
      immutable: true as const,
      statistics,
    }) as OptimizerStatsVersionedStorageObject;

    history.push(object);
    this.optimizerStatsVersionObjects.set(table, history);
  }

  private resolveCanonicalOptimizerStatsTableName(table: string): string | null {
    const canonicalSchemaTable = this.resolveCanonicalTableName(table);
    if (canonicalSchemaTable) return canonicalSchemaTable;

    const target = table.trim().toUpperCase();
    if (!target) return null;
    for (const tableName of this.optimizerStatsVersionObjects.keys()) {
      if (tableName.toUpperCase() === target) return tableName;
    }
    return null;
  }

  private pickOptimizerStatsVersionObject(
    table: string,
    options?: { visibility?: "pending" | "confirmed"; version?: number },
  ): OptimizerStatsVersionedStorageObject | undefined {
    const history = this.optimizerStatsVersionObjects.get(table) ?? [];
    if (history.length === 0) return undefined;

    if (options?.version !== undefined) {
      return history.find((object) => object.currentVersion === options.version);
    }

    const visibility = options?.visibility ?? "pending";
    if (visibility === "pending") return history[history.length - 1];
    return [...history].reverse().find((object) => object.confirmationStatus === "confirmed");
  }

  getOptimizerStatsVersionObjects(
    table?: string,
  ): OptimizerStatsVersionedStorageObject[] | Record<string, OptimizerStatsVersionedStorageObject[]> {
    if (table) {
      const canonical = this.resolveCanonicalOptimizerStatsTableName(table);
      if (!canonical) return [];
      return (this.optimizerStatsVersionObjects.get(canonical) ?? [])
        .map((object) => this.cloneOptimizerStatsVersionObject(object));
    }

    const out: Record<string, OptimizerStatsVersionedStorageObject[]> = {};
    for (const [name, history] of this.optimizerStatsVersionObjects.entries()) {
      out[name] = history.map((object) => this.cloneOptimizerStatsVersionObject(object));
    }
    return out;
  }

  confirmOptimizerStatsVersionObject(table: string, version?: number): OptimizerStatsVersionedStorageObject | null {
    const canonical = this.resolveCanonicalOptimizerStatsTableName(table);
    if (!canonical) return null;

    const history = this.optimizerStatsVersionObjects.get(canonical);
    if (!history || history.length === 0) return null;

    const targetVersion = version ?? history[history.length - 1]!.currentVersion;
    const idx = history.findIndex((object) => object.currentVersion === targetVersion);
    if (idx < 0) return null;

    const current = history[idx]!;
    if (current.confirmationStatus === "confirmed") return this.cloneOptimizerStatsVersionObject(current);

    const confirmed = Object.freeze({
      ...current,
      confirmationStatus: "confirmed" as const,
    }) as OptimizerStatsVersionedStorageObject;
    history[idx] = confirmed;
    return this.cloneOptimizerStatsVersionObject(confirmed);
  }

  private pruneIndexVersionObjectsForTable(table: string): void {
    const upper = table.toUpperCase();
    const activeNames = new Set(
      this.getActiveIndexEntriesForTable(table).map((entry) => this.normalizeIndexName(entry.name)),
    );
    for (const [indexName, history] of this.indexVersionObjects.entries()) {
      if (!history.length) continue;
      if (history[0]!.table.toUpperCase() !== upper) continue;
      if (activeNames.has(indexName)) continue;
      this.indexVersionObjects.delete(indexName);
    }
  }

  private buildLatestCommittedSnapshotTables(visibility: "pending" | "confirmed"): Map<string, SqlRow[]> {
    const snapshot = new Map<string, SqlRow[]>();
    const allTables = new Set<string>([...this.tables.keys(), ...this.tableVersionObjects.keys()]);
    for (const table of allTables.values()) {
      const history = this.tableVersionObjects.get(table) ?? [];
      const selectedVersion = visibility === "pending"
        ? history.at(-1)
        : [...history].reverse().find((object) => object.confirmationStatus === "confirmed");

      if (selectedVersion) {
        snapshot.set(table, selectedVersion.rows.map((row) => ({ ...row })));
        continue;
      }

      const committedRows = this.tables.get(table);
      if (!committedRows) continue;
      snapshot.set(table, this.deepCloneRows(committedRows));
    }
    return snapshot;
  }

  private async queryAgainstSnapshotTables(sql: string, tables: Map<string, SqlRow[]>): Promise<QueryResult> {
    const snapshotClient = new WalrusSqlClient({
      ...this.opts,
      mode: "simulator",
      readCache: { enabled: false },
      wal: { ...(this.opts.wal ?? {}), enabled: false },
      onchainExecutor: undefined,
      onchainQueryExecutor: undefined,
      transactionCommitExecutor: undefined,
    });

    const internals = snapshotClient as unknown as {
      tables: Map<string, SqlRow[]>;
      schemas: Map<string, TableSchema>;
      uniqueIndexes: Map<string, Map<string, Map<string, SqlRow>>>;
      uniqueGroupsCache: Map<string, string[][]>;
      constraintCost: Map<string, ConstraintIndexCostStats>;
      rowVersions: Map<string, Map<string, number>>;
      tableVersionObjects: Map<string, VersionedStorageObject[]>;
      indexVersionObjects: Map<string, IndexVersionedStorageObject[]>;
      optimizerStatsVersionObjects: Map<string, OptimizerStatsVersionedStorageObject[]>;
    };

    internals.tables.clear();
    for (const [table, rows] of tables.entries()) {
      internals.tables.set(table, rows);
    }

    internals.schemas.clear();
    for (const [table, schema] of this.schemas.entries()) internals.schemas.set(table, schema);
    internals.uniqueIndexes.clear();
    internals.uniqueGroupsCache.clear();
    internals.constraintCost.clear();
    internals.rowVersions.clear();
    internals.tableVersionObjects.clear();
    internals.indexVersionObjects.clear();
    internals.optimizerStatsVersionObjects.clear();

    return snapshotClient.query(sql);
  }

  async queryLatestCommitted(sql: string): Promise<QueryResult> {
    return this.queryByConfirmation(sql, "pending");
  }

  async queryByConfirmation(sql: string, visibility: "pending" | "confirmed" = "confirmed"): Promise<QueryResult> {
    const snapshot = this.buildLatestCommittedSnapshotTables(visibility);
    return this.queryAgainstSnapshotTables(sql, snapshot);
  }

  private buildTransactionRowKey(table: string, keySource: SqlRow): Record<string, SqlPrimitive> {
    const key: Record<string, SqlPrimitive> = {};
    const schema = this.schemas.get(table);
    const keyColumns = schema?.primaryKeyGroup
      ?? schema?.columns.filter((column) => column.primaryKey).map((column) => column.name)
      ?? [];

    if (keyColumns.length > 0) {
      for (const column of keyColumns) key[column] = keySource[column] ?? null;
    } else {
      const fallbackColumns = Object.keys(keySource).sort();
      for (const column of fallbackColumns) key[column] = keySource[column] ?? null;
    }
    return key;
  }

  private toWalWriteEntry(
    table: string,
    op: TransactionLogWriteOperation,
    keySource: SqlRow,
    preImage: SqlRow | null,
    postImage: SqlRow | null,
  ): TransactionLogWriteEntry {
    return {
      table,
      op,
      key: this.buildTransactionRowKey(table, keySource),
      preImage: preImage ? { ...preImage } : null,
      postImage: postImage ? { ...postImage } : null,
    };
  }

  private recordTransactionLogWrite(
    table: string,
    op: TransactionLogWriteOperation,
    keySource: SqlRow,
    preImage: SqlRow | null,
    postImage: SqlRow | null,
  ): void {
    if (!this.isDmlWriteStagingActive()) return;
    if (!this.transactionWriteSet) this.transactionWriteSet = this.createEmptyTransactionWriteSet();
    const entry = this.toWalWriteEntry(table, op, keySource, preImage, postImage);
    this.rememberObservedRowVersion(table, entry.key);
    this.transactionWriteSet.logEntries.push(entry);
  }

  private createCommitWalRecord(): TransactionLogRecord | null {
    const staged = this.transactionWriteSet;
    if (!staged || staged.logEntries.length === 0) return null;
    return createTransactionLogRecord({
      txnId: randomUUID(),
      at: Date.now(),
      writeSet: staged.logEntries.map((entry) => ({
        table: entry.table,
        op: entry.op,
        key: { ...entry.key },
        preImage: entry.preImage ? { ...entry.preImage } : null,
        postImage: entry.postImage ? { ...entry.postImage } : null,
      })),
    });
  }

  private buildTransactionCommitBatchPayload(record: TransactionLogRecord): TransactionCommitBatchPayload {
    return {
      txnId: record.txnId,
      at: record.at,
      checksum: record.checksum,
      writeSet: record.writeSet.map((entry) => ({
        table: entry.table,
        op: entry.op,
        key: { ...entry.key },
        preImage: entry.preImage ? { ...entry.preImage } : null,
        postImage: entry.postImage ? { ...entry.postImage } : null,
      })),
    };
  }

  private cloneTransactionLogWriteEntry(entry: TransactionLogWriteEntry): TransactionLogWriteEntry {
    return {
      table: entry.table,
      op: entry.op,
      key: { ...entry.key },
      preImage: entry.preImage ? { ...entry.preImage } : null,
      postImage: entry.postImage ? { ...entry.postImage } : null,
    };
  }

  private buildTransactionWriteSetFromLogRecord(record: TransactionLogRecord): TransactionWriteSet {
    const staged = this.createEmptyTransactionWriteSet();
    staged.logEntries = record.writeSet.map((entry) => this.cloneTransactionLogWriteEntry(entry));
    if (staged.logEntries.length === 0) return staged;

    const tableStats = new Map<string, TransactionTableWriteStats>();
    for (const entry of staged.logEntries) {
      if (!this.tables.has(entry.table) || !this.schemas.has(entry.table)) {
        throw sqlError("ERR_TABLE_NOT_FOUND", entry.table);
      }

      const stats = tableStats.get(entry.table) ?? { insertRows: 0, updateRows: 0, deleteRows: 0 };
      if (entry.op === "INSERT") stats.insertRows += 1;
      else if (entry.op === "UPDATE") stats.updateRows += 1;
      else stats.deleteRows += 1;
      tableStats.set(entry.table, stats);
    }

    const snapshotTables = this.buildConstraintRevalidationSnapshot(staged);
    for (const [table, stats] of tableStats.entries()) {
      const snapshotRows = snapshotTables.get(table) ?? [];
      const rows = this.deepCloneRows(snapshotRows);
      staged.tables.set(table, {
        rows,
        uniqueIndexes: this.buildUniqueIndexSnapshot(table, rows),
        stats,
      });
    }

    return staged;
  }

  private applyRecoveredPreparedTransactionRecord(record: TransactionLogRecord): void {
    const staged = this.buildTransactionWriteSetFromLogRecord(record);
    if (staged.tables.size === 0) return;
    this.assertCommitConstraintRevalidation(staged);
    this.applyTransactionWriteSetOnCommit(staged);
  }

  private async executeTransactionCommitBatch(payload: TransactionCommitBatchPayload): Promise<void> {
    if (!this.opts.transactionCommitExecutor) return;
    await this.opts.transactionCommitExecutor(payload);
  }

  private async processPreparedTransactionRecord(
    record: TransactionLogRecord,
    options?: { applyLocalWriteSet?: () => void },
  ): Promise<void> {
    const payload = this.buildTransactionCommitBatchPayload(record);
    await this.executeTransactionCommitBatch(payload);
    options?.applyLocalWriteSet?.();
    await this.appendTransactionWalEntry({
      phase: "COMMIT",
      txnId: record.txnId,
      at: Date.now(),
    });
  }

  async recoverPendingTransactionLogsFromWal(): Promise<TransactionLogRecord[]> {
    if (!this.getWalFilePath()) return [];
    const lines = await this.loadWalLines();
    return [...this.collectPendingWalRecords(lines).values()];
  }

  async replayPendingTransactionLogsFromWal(): Promise<{ replayedTxnIds: string[]; failedTxnIds: string[] }> {
    const pending = await this.recoverPendingTransactionLogsFromWal();
    const replayedTxnIds: string[] = [];
    const failedTxnIds: string[] = [];

    for (const record of pending) {
      try {
        await this.processPreparedTransactionRecord(record, {
          applyLocalWriteSet: () => this.applyRecoveredPreparedTransactionRecord(record),
        });
        replayedTxnIds.push(record.txnId);
      } catch (err) {
        this.logger.warn("WAL replay failed", {
          txnId: record.txnId,
          error: this.stringifyError(err),
        });
        failedTxnIds.push(record.txnId);
      }
    }

    return { replayedTxnIds, failedTxnIds };
  }

  async rollbackPendingTransactionLogsFromWal(): Promise<string[]> {
    const pending = await this.recoverPendingTransactionLogsFromWal();
    const rolledBackTxnIds: string[] = [];
    for (const record of pending) {
      await this.appendTransactionWalEntry({
        phase: "ROLLBACK",
        txnId: record.txnId,
        at: Date.now(),
      });
      rolledBackTxnIds.push(record.txnId);
    }
    return rolledBackTxnIds;
  }

  private buildRowLookupByEncodedKey(table: string, rows: SqlRow[]): Map<string, SqlRow> {
    const lookup = new Map<string, SqlRow>();
    for (const row of rows) {
      lookup.set(this.encodeIndexRowRefKey(table, row), row);
    }
    return lookup;
  }

  private restoreSecondaryIndexesFromVersionObjectsForTable(table: string, rows: SqlRow[]): void {
    const activeEntries = this.getActiveIndexEntriesForTable(table);
    if (activeEntries.length === 0) {
      this.hashIndexes.delete(table);
      this.hashIndexStats.delete(table);
      this.btreeIndexes.delete(table);
      this.btreeIndexStats.delete(table);
      return;
    }

    const rowLookup = this.buildRowLookupByEncodedKey(table, rows);
    const restoredHashIndexes = new Map<string, Map<string, Set<SqlRow>>>();
    const restoredBtreeIndexes: BtreeRuntimeIndexMap = new Map();

    for (const entry of activeEntries) {
      const indexName = this.normalizeIndexName(entry.name);
      const history = this.indexVersionObjects.get(indexName) ?? [];
      const latest = history[history.length - 1];
      if (!latest) {
        this.rebuildSecondaryIndexesForTable(table);
        return;
      }
      if (latest.indexType !== entry.type || latest.column.toUpperCase() !== entry.columns[0]!.toUpperCase()) {
        this.rebuildSecondaryIndexesForTable(table);
        return;
      }

      if (entry.type === "HASH") {
        if (latest.payload.indexType !== "HASH") {
          this.rebuildSecondaryIndexesForTable(table);
          return;
        }

        const buckets = new Map<string, Set<SqlRow>>();
        for (const bucket of latest.payload.buckets) {
          const restoredRows = bucket.rowKeys
            .map((rowKey) => rowLookup.get(rowKey))
            .filter((row): row is SqlRow => Boolean(row));
          if (restoredRows.length === 0) continue;
          buckets.set(bucket.encodedKey, new Set(restoredRows));
        }

        if (buckets.size > 0) restoredHashIndexes.set(indexName, buckets);
        continue;
      }

      if (latest.payload.indexType !== "BTREE") {
        this.rebuildSecondaryIndexesForTable(table);
        return;
      }

      const entries: BtreeIndexLeafEntry[] = [];
      for (const leaf of latest.payload.entries) {
        const restoredRows = leaf.rowKeys
          .map((rowKey) => rowLookup.get(rowKey))
          .filter((row): row is SqlRow => Boolean(row));
        if (restoredRows.length === 0) continue;
        entries.push({
          key: leaf.key,
          rows: new Set(restoredRows),
        });
      }

      if (entries.length > 0) {
        restoredBtreeIndexes.set(indexName, {
          column: latest.column,
          entries: entries.sort((a, b) => this.compareForOrder(a.key, b.key, "ASC")),
        });
      }
    }

    if (restoredHashIndexes.size > 0) {
      let keys = 0;
      let rowsIndexed = 0;
      for (const buckets of restoredHashIndexes.values()) {
        keys += buckets.size;
        for (const bucketRows of buckets.values()) rowsIndexed += bucketRows.size;
      }
      this.hashIndexes.set(table, restoredHashIndexes);
      this.hashIndexStats.set(table, { keys, rowsIndexed });
    } else {
      this.hashIndexes.delete(table);
      this.hashIndexStats.delete(table);
    }

    if (restoredBtreeIndexes.size > 0) {
      let keys = 0;
      let rowsIndexed = 0;
      for (const runtime of restoredBtreeIndexes.values()) {
        keys += runtime.entries.length;
        for (const leaf of runtime.entries) rowsIndexed += leaf.rows.size;
      }
      this.btreeIndexes.set(table, restoredBtreeIndexes);
      this.btreeIndexStats.set(table, { keys, rowsIndexed });
    } else {
      this.btreeIndexes.delete(table);
      this.btreeIndexStats.delete(table);
    }
  }

  async recoverConsistentStateFromWalAndVersionChain(
    options?: { pendingStrategy?: "rollback" | "replay" },
  ): Promise<DurabilityRecoverySummary> {
    const strategy = options?.pendingStrategy ?? "rollback";
    const restoredTables: string[] = [];

    for (const [table, history] of this.tableVersionObjects.entries()) {
      const latest = history[history.length - 1];
      if (!latest) continue;

      const restoredRows = latest.rows.map((row) => ({ ...row }));
      this.tables.set(table, restoredRows);
      this.uniqueIndexes.set(table, this.buildUniqueIndexSnapshot(table, restoredRows));
      this.restoreSecondaryIndexesFromVersionObjectsForTable(table, restoredRows);

      const versions = new Map<string, number>();
      for (const row of restoredRows) {
        const key = this.buildTransactionRowKey(table, row as SqlRow);
        versions.set(this.encodeRowVersionKey(key), latest.currentVersion);
      }
      this.rowVersions.set(table, versions);
      restoredTables.push(table);
    }

    this.clearTransactionWriteSet();
    this.transactionState = "idle";
    this.transactionStartedAt = null;
    this.dirtyTables.clear();
    this.queryCache.clear();
    this.writeVersion += 1;

    const pendingBeforeRecords = await this.recoverPendingTransactionLogsFromWal();
    const pendingBefore = pendingBeforeRecords.map((record) => record.txnId);

    if (strategy === "replay") await this.replayPendingTransactionLogsFromWal();
    else await this.rollbackPendingTransactionLogsFromWal();

    const pendingAfterRecords = await this.recoverPendingTransactionLogsFromWal();
    const pendingAfter = pendingAfterRecords.map((record) => record.txnId);

    return {
      strategy,
      restoredTables: restoredTables.sort(),
      pendingBefore,
      pendingAfter,
    };
  }

  private applyCommittedTableStage(table: string, tableStage: TransactionTableWriteSet): void {
    this.tables.set(table, tableStage.rows);
    this.uniqueIndexes.set(table, tableStage.uniqueIndexes);
  }

  private findCommittedRowByVersionKey(table: string, encodedVersionKey: string): SqlRow | null {
    const rows = this.tables.get(table);
    if (!rows || rows.length === 0) return null;
    for (const row of rows) {
      if (this.encodeIndexRowRefKey(table, row) === encodedVersionKey) return row;
    }
    return null;
  }

  private resolveCommittedPostImageRow(
    table: string,
    postImage: SqlRow | null,
    fallbackKey: Record<string, SqlPrimitive>,
  ): SqlRow | null {
    if (postImage) {
      const encodedByPost = this.encodeIndexRowRefKey(table, postImage);
      const byPost = this.findCommittedRowByVersionKey(table, encodedByPost);
      if (byPost) return byPost;
    }
    return this.findCommittedRowByVersionKey(table, this.encodeRowVersionKey(fallbackKey));
  }

  private applyCommittedSecondaryIndexDeltas(staged: TransactionWriteSet): void {
    const touchedTables = new Set<string>();

    for (const entry of staged.logEntries) {
      const table = entry.table;
      if (!this.tables.has(table)) continue;

      if (entry.op === "DELETE") {
        if (entry.preImage) this.removeRowFromSecondaryIndexes(table, entry.preImage, { recomputeStats: false });
        this.bumpIndexMaintenanceStats(table, "DELETE", 1);
        touchedTables.add(table);
        continue;
      }

      if (entry.op === "INSERT") {
        const row = this.resolveCommittedPostImageRow(table, entry.postImage, entry.key);
        if (row) this.addRowToSecondaryIndexes(table, row, { recomputeStats: false });
        this.bumpIndexMaintenanceStats(table, "INSERT", 1);
        touchedTables.add(table);
        continue;
      }

      if (entry.preImage) this.removeRowFromSecondaryIndexes(table, entry.preImage, { recomputeStats: false });
      const row = this.resolveCommittedPostImageRow(table, entry.postImage, entry.key);
      if (row) this.addRowToSecondaryIndexes(table, row, { recomputeStats: false });
      this.bumpIndexMaintenanceStats(table, "UPDATE", 1);
      touchedTables.add(table);
    }

    for (const table of touchedTables.values()) this.recomputeSecondaryIndexStatsForTable(table);
  }

  private takeTransactionCommitRuntimeSnapshot(staged: TransactionWriteSet): TransactionCommitRuntimeSnapshot {
    const tableSnapshots = new Map<string, TransactionTableCommitSnapshot>();
    for (const table of staged.tables.keys()) {
      tableSnapshots.set(table, {
        hadTableRows: this.tables.has(table),
        rows: this.tables.get(table),
        hadUniqueIndexes: this.uniqueIndexes.has(table),
        uniqueIndexes: this.uniqueIndexes.get(table),
        hadHashIndexes: this.hashIndexes.has(table),
        hashIndexes: this.hashIndexes.get(table),
        hadHashIndexStats: this.hashIndexStats.has(table),
        hashIndexStats: this.hashIndexStats.get(table),
        hadBtreeIndexes: this.btreeIndexes.has(table),
        btreeIndexes: this.btreeIndexes.get(table),
        hadBtreeIndexStats: this.btreeIndexStats.has(table),
        btreeIndexStats: this.btreeIndexStats.get(table),
      });
    }

    return {
      tableSnapshots,
      dirtyTables: new Set(this.dirtyTables),
      storageWriteLog: this.storageWriteLog.map((evt) => ({ ...evt })),
      rowVersions: new Map(
        [...this.rowVersions.entries()].map(([table, versions]) => [table, new Map(versions)] as const),
      ),
      tableVersionObjects: new Map(
        [...this.tableVersionObjects.entries()].map(([table, history]) => [table, [...history]] as const),
      ),
      indexVersionObjects: new Map(
        [...this.indexVersionObjects.entries()].map(([indexName, history]) => [indexName, [...history]] as const),
      ),
      optimizerStatsVersionObjects: new Map(
        [...this.optimizerStatsVersionObjects.entries()].map(([table, history]) => [table, [...history]] as const),
      ),
      indexObservability: new Map(
        [...this.indexObservability.entries()].map(([table, stats]) => [table, { ...stats }] as const),
      ),
      writeVersion: this.writeVersion,
      queryCache: new Map(this.queryCache),
    };
  }

  private restoreTransactionCommitRuntimeSnapshot(snapshot: TransactionCommitRuntimeSnapshot): void {
    for (const [table, tableSnapshot] of snapshot.tableSnapshots.entries()) {
      if (tableSnapshot.hadTableRows) this.tables.set(table, tableSnapshot.rows ?? []);
      else this.tables.delete(table);

      if (tableSnapshot.hadUniqueIndexes) {
        this.uniqueIndexes.set(table, tableSnapshot.uniqueIndexes ?? new Map<string, Map<string, SqlRow>>());
      }
      else this.uniqueIndexes.delete(table);

      if (tableSnapshot.hadHashIndexes) {
        this.hashIndexes.set(table, tableSnapshot.hashIndexes ?? new Map<string, Map<string, Set<SqlRow>>>());
      }
      else this.hashIndexes.delete(table);

      if (tableSnapshot.hadHashIndexStats) {
        this.hashIndexStats.set(table, tableSnapshot.hashIndexStats ?? { keys: 0, rowsIndexed: 0 });
      }
      else this.hashIndexStats.delete(table);

      if (tableSnapshot.hadBtreeIndexes) {
        this.btreeIndexes.set(
          table,
          tableSnapshot.btreeIndexes ?? new Map<string, BtreeRuntimeIndex>(),
        );
      }
      else this.btreeIndexes.delete(table);

      if (tableSnapshot.hadBtreeIndexStats) {
        this.btreeIndexStats.set(table, tableSnapshot.btreeIndexStats ?? { keys: 0, rowsIndexed: 0 });
      }
      else this.btreeIndexStats.delete(table);
    }

    this.dirtyTables.clear();
    for (const table of snapshot.dirtyTables.values()) this.dirtyTables.add(table);

    this.storageWriteLog.length = 0;
    this.storageWriteLog.push(...snapshot.storageWriteLog.map((evt) => ({ ...evt })));

    this.rowVersions.clear();
    for (const [table, versions] of snapshot.rowVersions.entries()) {
      this.rowVersions.set(table, new Map(versions));
    }

    this.tableVersionObjects.clear();
    for (const [table, history] of snapshot.tableVersionObjects.entries()) {
      this.tableVersionObjects.set(table, [...history]);
    }

    this.indexVersionObjects.clear();
    for (const [indexName, history] of snapshot.indexVersionObjects.entries()) {
      this.indexVersionObjects.set(indexName, [...history]);
    }

    this.optimizerStatsVersionObjects.clear();
    for (const [table, history] of snapshot.optimizerStatsVersionObjects.entries()) {
      this.optimizerStatsVersionObjects.set(table, [...history]);
    }

    this.indexObservability.clear();
    for (const [table, stats] of snapshot.indexObservability.entries()) {
      this.indexObservability.set(table, { ...stats });
    }

    this.writeVersion = snapshot.writeVersion;
    this.queryCache.clear();
    for (const [sql, entry] of snapshot.queryCache.entries()) this.queryCache.set(sql, entry);
  }

  private buildConstraintRevalidationSnapshot(staged: TransactionWriteSet): Map<string, SqlRow[]> {
    const snapshot = new Map<string, SqlRow[]>();
    for (const [table, rows] of this.tables.entries()) snapshot.set(table, this.deepCloneRows(rows));
    for (const entry of staged.logEntries) {
      const rows = snapshot.get(entry.table) ?? [];
      const encodedKey = this.encodeRowVersionKey(entry.key);
      const rowIndex = rows.findIndex(
        (row) => this.encodeRowVersionKey(this.buildTransactionRowKey(entry.table, row)) === encodedKey,
      );

      if (entry.op === "DELETE") {
        if (rowIndex >= 0) rows.splice(rowIndex, 1);
      } else {
        const postImage = entry.postImage ? { ...entry.postImage } : null;
        if (!postImage) continue;
        if (rowIndex >= 0) rows[rowIndex] = postImage;
        else rows.push(postImage);
      }

      snapshot.set(entry.table, rows);
    }
    return snapshot;
  }

  private enforceForeignKeyIntegrityInSnapshot(
    table: string,
    row: SqlRow,
    snapshotTables: Map<string, SqlRow[]>,
  ): void {
    const schema = this.schemas.get(table);
    if (!schema?.foreignKeys?.length) return;

    for (const fk of schema.foreignKeys) {
      const childValues = fk.columns.map((column) => (row[column] ?? null) as SqlPrimitive);
      const nullCount = childValues.filter((value) => value === null || value === undefined).length;
      if (nullCount === fk.columns.length) continue;
      if ((fk.matchRule === "SIMPLE" || fk.matchRule === "PARTIAL") && nullCount > 0) continue;
      if (fk.matchRule === "FULL" && nullCount > 0) {
        throw constraintError(
          "FOREIGN_KEY",
          `MATCH FULL requires all-or-none child key values: ${table}(${fk.columns.join(",")})`,
          {
            clause: "FOREIGN KEY",
            field: `${table}(${fk.columns.join(",")})`,
          },
        );
      }

      const parentSchema = this.schemas.get(fk.refTable);
      if (!parentSchema) {
        throw constraintError("FOREIGN_KEY", `referenced table not found: ${fk.refTable}`, {
          clause: "FOREIGN KEY",
          field: `${table}(${fk.columns.join(",")})`,
        });
      }

      for (const refColumn of fk.refColumns) {
        if (!parentSchema.columns.some((column) => column.name.toUpperCase() === refColumn.toUpperCase())) {
          throw constraintError(
            "FOREIGN_KEY",
            `referenced column not found: ${fk.refTable}.${refColumn}`,
            {
              clause: "FOREIGN KEY",
              field: `${table}(${fk.columns.join(",")})`,
            },
          );
        }
      }

      const parentRows = snapshotTables.get(fk.refTable) ?? [];
      const hasMatch = parentRows.some((parentRow) => fk.refColumns.every((refColumn, idx) => {
        const childValue = childValues[idx] ?? null;
        const parentValue = (parentRow[refColumn] ?? null) as SqlPrimitive;
        return this.areConstraintValuesEqual(parentValue, childValue, `constraint.fk.commit:${table}.${fk.columns[idx]}`);
      }));

      if (!hasMatch) {
        throw constraintError(
          "FOREIGN_KEY",
          `referential integrity failed: ${table}(${fk.columns.join(",")}) -> ${fk.refTable}(${fk.refColumns.join(",")})`,
          {
            clause: "FOREIGN KEY",
            field: `${table}(${fk.columns.join(",")})`,
          },
        );
      }
    }
  }

  private assertCommitConstraintRevalidation(staged: TransactionWriteSet): void {
    const snapshotTables = this.buildConstraintRevalidationSnapshot(staged);

    for (const [table] of staged.tables.entries()) {
      const schema = this.schemas.get(table);
      if (!schema) continue;

      const rows = snapshotTables.get(table) ?? [];
      const uniqueSeen = new Map<string, Map<string, number>>();
      for (const group of this.getUniqueGroups(table, schema)) uniqueSeen.set(this.uniqueGroupName(group), new Map<string, number>());

      for (const row of rows) {
        for (const column of schema.columns) {
          const value = row[column.name];
          if ((column.notNull || column.primaryKey) && (value === null || value === undefined)) {
            throw constraintError("NOT_NULL", `${table}.${column.name} is NOT NULL`, {
              clause: "COMMIT_REVALIDATE",
              field: `${table}.${column.name}`,
            });
          }
        }

        for (const group of this.getUniqueGroups(table, schema)) {
          const keyName = this.uniqueGroupName(group);
          const keyVal = this.uniqueGroupValue(row, group);
          if (keyVal === null) continue;
          const seen = uniqueSeen.get(keyName)!;
          const hit = seen.get(keyVal) ?? 0;
          if (hit > 0) {
            throw constraintError(
              "DUPLICATE_KEY",
              `Duplicate key value for ${table}(${group.join(",")}) during COMMIT revalidation`,
              {
                clause: "COMMIT_REVALIDATE",
                field: group.join(","),
              },
            );
          }
          seen.set(keyVal, hit + 1);
        }

        this.enforceForeignKeyIntegrityInSnapshot(table, row, snapshotTables);
      }
    }
  }

  private applyTransactionWriteSetOnCommit(stagedOverride?: TransactionWriteSet): void {
    const staged = stagedOverride ?? this.transactionWriteSet;
    if (!staged || staged.tables.size === 0) return;

    const snapshot = this.takeTransactionCommitRuntimeSnapshot(staged);
    let committedRows = 0;
    const sideEffects: TransactionTableCommitSideEffect[] = [];

    try {
      for (const [table, tableStage] of staged.tables.entries()) {
        this.applyCommittedTableStage(table, tableStage);

        const { insertRows, updateRows, deleteRows } = tableStage.stats;
        if (insertRows + updateRows + deleteRows > 0) {
          sideEffects.push({
            table,
            stats: { insertRows, updateRows, deleteRows },
          });
          committedRows += insertRows + updateRows + deleteRows;
        }
      }

      this.applyCommittedSecondaryIndexDeltas(staged);

      for (const effect of sideEffects) {
        const { table, stats } = effect;
        const committedRowsForTable = this.tables.get(table) ?? [];
        this.recordImmutableVersionObject(table, committedRowsForTable);
        this.recordImmutableIndexVersionObjectsForTable(table);
        this.recordImmutableOptimizerStatsVersionObject(table);
        this.dirtyTables.add(table);
        if (stats.insertRows > 0) this.recordStorageWrite(table, "INSERT_ROW", stats.insertRows, "simulator");
        if (stats.updateRows > 0) this.recordStorageWrite(table, "UPDATE_ROW", stats.updateRows, "simulator");
        if (stats.deleteRows > 0) this.recordStorageWrite(table, "DELETE_ROW", stats.deleteRows, "simulator");
      }

      this.applyCommittedRowVersions(staged);
      if (committedRows > 0) this.invalidateReadCacheOnWrite();
    } catch (err) {
      this.restoreTransactionCommitRuntimeSnapshot(snapshot);
      throw this.wrapAsyncError(
        err,
        ClientErrorCodeEnum.ExecutionFailed,
        "transaction commit apply failed; restored pre-commit state",
      );
    }
  }

  private async executeTransactionControl(sql: string, action: SqlTransactionAction): Promise<ExecuteResult> {
    if (action === "BEGIN") {
      this.transitionTransactionState("begin", sql);
      this.transactionStartedAt = Date.now();
      this.currentTransactionLockWaitMs = 0;
      this.transactionObservability.started += 1;
      if (this.isSimulatorMode()) this.transactionWriteSet = this.createEmptyTransactionWriteSet();
      return {
        txDigest: this.fakeDigest(sql),
        statementType: "BEGIN",
        affectedRows: 0,
      };
    }

    if (action === "ROLLBACK") {
      const previousState = this.transactionState;
      this.transitionTransactionState("rollback", sql);
      if (previousState === "active") this.recordTransactionOutcome("aborted");
      this.clearTransactionWriteSet();
      this.transactionStartedAt = null;
      return {
        txDigest: this.fakeDigest(sql),
        statementType: "ROLLBACK",
        affectedRows: 0,
      };
    }

    this.assertTransactionNotTimedOut(sql);
    this.transitionTransactionState("commit", sql);
    let walRecord: TransactionLogRecord | null = null;
    try {
      // Keep COMMIT transition observable as active -> committing -> idle.
      await this.waitTransactionCommitTurn();
      if (this.isSimulatorMode()) {
        if (this.transactionWriteSet) {
          this.assertNoWriteConflicts(this.transactionWriteSet);
          this.assertCommitConstraintRevalidation(this.transactionWriteSet);
        }
        walRecord = this.createCommitWalRecord();
        if (walRecord) {
          await this.appendTransactionWalEntry({
            phase: "PREPARE",
            txnId: walRecord.txnId,
            at: Date.now(),
            record: walRecord,
          });
        }
        if (walRecord) await this.processPreparedTransactionRecord(walRecord, { applyLocalWriteSet: () => this.applyTransactionWriteSetOnCommit() });
        else this.applyTransactionWriteSetOnCommit();
      }
      this.transitionTransactionState("commit_done", sql);
      this.recordTransactionOutcome("committed");
      this.clearTransactionWriteSet();
      this.transactionStartedAt = null;
      return {
        txDigest: this.fakeDigest(sql),
        statementType: "COMMIT",
        affectedRows: 0,
      };
    } catch (err) {
      this.transitionTransactionToAbortedOnError(sql);
      throw err;
    }
  }

  async execute(sql: string): Promise<ExecuteResult> {
    const normalized = normalizeSql(sql);
    this.logger.debug("execute start", {
      sql: normalized,
      mode: this.opts.mode ?? "simulator",
      transactionState: this.transactionState,
    });
    try {
      const txAction = this.tryParseTransactionAction(normalized);
      if (txAction) {
        const result = await this.executeTransactionControl(normalized, txAction);
        this.logger.debug("execute success", {
          sql: normalized,
          statementType: result.statementType,
          affectedRows: result.affectedRows ?? 0,
          transactionState: this.transactionState,
        });
        return result;
      }

      this.enterSubqueryRuntimeScope();
      try {
        this.assertTransactionNotTimedOut(normalized);
        this.assertStatementAllowedDuringTransaction(normalized);
        try {
          this.assertDdlTransactionPolicy(normalized);
        } catch (err) {
          this.transitionTransactionToAbortedOnError(normalized);
          throw err;
        }

        let result: ExecuteResult;
        if ((this.opts.mode ?? "simulator") === "onchain") {
          try {
            result = await this.executeOnchain(sql);
          } catch (err) {
            this.transitionTransactionToAbortedOnError(normalized);
            throw err;
          }
        } else {
          try {
            result = await this.executeSimulator(sql);
          } catch (err) {
            this.transitionTransactionToAbortedOnError(normalized);
            throw err;
          }
        }
        this.logger.debug("execute success", {
          sql: normalized,
          statementType: result.statementType,
          affectedRows: result.affectedRows ?? 0,
          transactionState: this.transactionState,
        });
        return result;
      } finally {
        this.leaveSubqueryRuntimeScope();
      }
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

  getIndexCatalog(table?: string): IndexCatalogEntry[] {
    const out = [...this.indexCatalog.values()]
      .filter((entry) => (table ? entry.table.toUpperCase() === table.toUpperCase() : true))
      .map((entry) => ({ ...entry, columns: [...entry.columns] }));

    out.sort((a, b) => {
      const byTable = a.table.localeCompare(b.table);
      if (byTable !== 0) return byTable;
      return a.name.localeCompare(b.name);
    });

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

  private emptyIndexObservabilityStats(): IndexObservabilityStats {
    return {
      lookupCount: 0,
      lookupHits: 0,
      lookupMisses: 0,
      maintenanceInsertOps: 0,
      maintenanceUpdateOps: 0,
      maintenanceDeleteOps: 0,
      maintenanceRebuildOps: 0,
      maintenanceRows: 0,
    };
  }

  private getOrCreateIndexObservabilityStats(table: string): IndexObservabilityStats {
    const existing = this.indexObservability.get(table);
    if (existing) return existing;
    const created = this.emptyIndexObservabilityStats();
    this.indexObservability.set(table, created);
    return created;
  }

  private bumpIndexLookupStats(table: string, hit: boolean): void {
    if (!this.getActiveIndexEntriesForTable(table).length) return;
    const stats = this.getOrCreateIndexObservabilityStats(table);
    stats.lookupCount += 1;
    if (hit) stats.lookupHits += 1;
    else stats.lookupMisses += 1;
  }

  private bumpIndexMaintenanceStats(table: string, op: "INSERT" | "UPDATE" | "DELETE" | "REBUILD", rows: number): void {
    if (!this.getActiveIndexEntriesForTable(table).length) return;
    const stats = this.getOrCreateIndexObservabilityStats(table);
    if (op === "INSERT") stats.maintenanceInsertOps += 1;
    else if (op === "UPDATE") stats.maintenanceUpdateOps += 1;
    else if (op === "DELETE") stats.maintenanceDeleteOps += 1;
    else stats.maintenanceRebuildOps += 1;
    stats.maintenanceRows += Math.max(0, rows);
  }

  getIndexObservability(table?: string): Array<{
    table: string;
    lookupCount: number;
    lookupHits: number;
    lookupMisses: number;
    hitRate: number;
    failureRate: number;
    maintenanceInsertOps: number;
    maintenanceUpdateOps: number;
    maintenanceDeleteOps: number;
    maintenanceRebuildOps: number;
    maintenanceRows: number;
  }> {
    const out: Array<{
      table: string;
      lookupCount: number;
      lookupHits: number;
      lookupMisses: number;
      hitRate: number;
      failureRate: number;
      maintenanceInsertOps: number;
      maintenanceUpdateOps: number;
      maintenanceDeleteOps: number;
      maintenanceRebuildOps: number;
      maintenanceRows: number;
    }> = [];
    for (const [tableName, stats] of this.indexObservability.entries()) {
      if (table && tableName.toUpperCase() !== table.toUpperCase()) continue;
      const hitRate = stats.lookupCount > 0 ? stats.lookupHits / stats.lookupCount : 0;
      const failureRate = stats.lookupCount > 0 ? stats.lookupMisses / stats.lookupCount : 0;
      out.push({
        table: tableName,
        lookupCount: stats.lookupCount,
        lookupHits: stats.lookupHits,
        lookupMisses: stats.lookupMisses,
        hitRate,
        failureRate,
        maintenanceInsertOps: stats.maintenanceInsertOps,
        maintenanceUpdateOps: stats.maintenanceUpdateOps,
        maintenanceDeleteOps: stats.maintenanceDeleteOps,
        maintenanceRebuildOps: stats.maintenanceRebuildOps,
        maintenanceRows: stats.maintenanceRows,
      });
    }
    out.sort((a, b) => a.table.localeCompare(b.table));
    return out;
  }

  getViewCatalog(viewName?: string): ViewCatalogEntry[] {
    const out = [...this.viewCatalog.values()]
      .filter((entry) => (viewName ? entry.name.toUpperCase() === viewName.toUpperCase() : true))
      .map((entry) => ({
        ...entry,
        dependencies: entry.dependencies.map((dependency) => ({
          source: dependency.source,
          columns: [...dependency.columns],
        })),
      }));
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  private getSelectJoinSteps(parsed: ParsedSelect): SelectJoinStep[] {
    if (parsed.joins?.length) return parsed.joins;
    return parsed.join ? [parsed.join] : [];
  }

  private collectSelectSourceTables(parsed: ParsedSelect): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (tableName: string): void => {
      const normalized = tableName.trim();
      if (!normalized) return;
      const key = normalized.toUpperCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(normalized);
    };

    push(parsed.table);
    for (const join of this.getSelectJoinSteps(parsed)) {
      push(join.table);
    }
    return out;
  }

  private async materializeViewRows(viewEntry: ViewCatalogEntry): Promise<SqlRow[]> {
    const viewName = this.normalizeViewName(viewEntry.name);
    this.assertViewPermission("SELECT", viewName);
    if (viewEntry.status !== "ACTIVE") {
      const detail = viewEntry.invalidReason
        ? `view is invalid: ${viewEntry.name} (${viewEntry.invalidReason})`
        : `view is invalid: ${viewEntry.name}`;
      throw sqlError("ERR_UNSUPPORTED_SELECT", detail);
    }
    const cycleStart = this.activeViewResolutionStack.indexOf(viewName);
    if (cycleStart >= 0) {
      const cyclePath = [...this.activeViewResolutionStack.slice(cycleStart), viewName].join(" -> ");
      throw sqlError("ERR_UNSUPPORTED_SELECT", `cyclic view reference detected: ${cyclePath}`);
    }

    this.activeViewResolutionStack.push(viewName);
    try {
      const result = await this.query(viewEntry.querySql);
      return this.deepCloneRows(result.rows);
    } finally {
      this.activeViewResolutionStack.pop();
    }
  }

  private async materializeSelectViewSources(parsed: ParsedSelect): Promise<string[]> {
    const materialized: string[] = [];
    for (const sourceTable of this.collectSelectSourceTables(parsed)) {
      if (this.tables.has(sourceTable)) continue;
      const viewEntry = this.viewCatalog.get(this.normalizeViewName(sourceTable));
      if (!viewEntry) continue;
      const rows = await this.materializeViewRows(viewEntry);
      this.tables.set(sourceTable, rows);
      materialized.push(sourceTable);
    }
    return materialized;
  }

  private cleanupMaterializedSelectViewSources(materializedTableNames: string[]): void {
    for (let i = materializedTableNames.length - 1; i >= 0; i--) {
      this.tables.delete(materializedTableNames[i]!);
    }
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

  private recordIndexMaintenance(table: string, op: "INDEX_REBUILD", affectedRows: number): void {
    this.storageWriteLog.push({
      table,
      op,
      affectedRows,
      mode: "simulator",
      at: Date.now(),
    });
    this.bumpIndexMaintenanceStats(table, "REBUILD", affectedRows);
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

  private enterSubqueryRuntimeScope(): void {
    if (!this.subqueryRuntime) {
      this.subqueryRuntime = {
        depth: 0,
        costUnits: 0,
        costBudget: CORRELATED_SUBQUERY_COST_BUDGET,
        planCache: new Map<string, ParsedSubqueryPlan>(),
        resultCache: new Map<string, SqlRow[]>(),
      };
    }
    this.subqueryRuntime.depth += 1;
  }

  private leaveSubqueryRuntimeScope(): void {
    if (!this.subqueryRuntime) return;
    this.subqueryRuntime.depth = Math.max(0, this.subqueryRuntime.depth - 1);
    if (this.subqueryRuntime.depth === 0) {
      this.subqueryRuntime = null;
    }
  }

  private getOrCreateSubqueryStats(normalizedSubquerySql: string): SubqueryExecutionStats {
    let stats = this.subqueryExecutionStats.get(normalizedSubquerySql);
    if (!stats) {
      stats = {
        executions: 0,
        correlatedExecutions: 0,
        cacheHits: 0,
        cacheMisses: 0,
        rowsScanned: 0,
        rowsReturned: 0,
        budgetExceededCount: 0,
      };
      this.subqueryExecutionStats.set(normalizedSubquerySql, stats);
    }
    return stats;
  }

  private collectOuterReferences(expr: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const re = /\bouter\.([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\b/gi;

    let m: RegExpExecArray | null;
    while ((m = re.exec(expr)) !== null) {
      const ref = m[1]!;
      const key = ref.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ref);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }

  private getParsedSubqueryPlan(normalizedSubquerySql: string): ParsedSubqueryPlan {
    const cached = this.subqueryRuntime?.planCache.get(normalizedSubquerySql);
    if (cached) return cached;

    const m = normalizedSubquerySql.match(
      /^SELECT\s+(.+?)\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?(?:\s+WHERE\s+(.+))?$/i,
    );
    if (!m) throw sqlError("ERR_UNSUPPORTED_SUBQUERY", normalizedSubquerySql);

    const fieldExpr = m[1]!.trim();
    const table = m[2]!.trim();
    const tableAlias = m[3]?.trim();
    const where = m[4]?.trim();
    const outerRefs = this.collectOuterReferences(`${fieldExpr} ${where ?? ""}`);

    const plan: ParsedSubqueryPlan = {
      normalizedSql: normalizedSubquerySql,
      fieldExpr,
      table,
      tableAlias,
      where,
      whereTree: where ? this.parseWhereTree(where) : undefined,
      outerRefs,
    };
    this.subqueryRuntime?.planCache.set(normalizedSubquerySql, plan);
    return plan;
  }

  private buildSubqueryResultCacheKey(plan: ParsedSubqueryPlan, outerRow?: SqlRow): string {
    if (!plan.outerRefs.length || !outerRow) return `${plan.normalizedSql}::GLOBAL`;

    const bindings = plan.outerRefs.map((ref) => {
      const value = resolveIdentifierValue(outerRow, ref, "strict");
      const encoded = this.encodeTypedKey((value ?? null) as SqlPrimitive, `subquery.outerRef:${ref}`);
      return `${ref}=${encoded}`;
    });
    return `${plan.normalizedSql}::${bindings.join("|")}`;
  }

  private storeSubqueryResultCache(cacheKey: string, rows: SqlRow[]): void {
    if (!this.subqueryRuntime) return;
    if (this.subqueryRuntime.resultCache.has(cacheKey)) {
      this.subqueryRuntime.resultCache.delete(cacheKey);
    }
    this.subqueryRuntime.resultCache.set(cacheKey, this.deepCloneRows(rows));

    while (this.subqueryRuntime.resultCache.size > CORRELATED_SUBQUERY_RESULT_CACHE_LIMIT) {
      const oldest = this.subqueryRuntime.resultCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.subqueryRuntime.resultCache.delete(oldest);
    }
  }

  private consumeSubqueryCost(stats: SubqueryExecutionStats, correlated: boolean, subquerySql: string): void {
    stats.rowsScanned += 1;
    if (!correlated || !this.subqueryRuntime) return;
    this.subqueryRuntime.costUnits += 1;
    if (this.subqueryRuntime.costUnits <= this.subqueryRuntime.costBudget) return;
    stats.budgetExceededCount += 1;
    throw sqlError("ERR_UNSUPPORTED_SUBQUERY", `Correlated subquery cost budget exceeded: ${subquerySql}`);
  }

  private buildSubqueryEvalRow(innerRow: SqlRow, table: string, tableAlias?: string, outerRow?: SqlRow): SqlRow {
    const evalRow: SqlRow = {};
    for (const [k, v] of Object.entries(innerRow)) {
      evalRow[k] = v;
      evalRow[`${table}.${k}`] = v;
      if (tableAlias) evalRow[`${tableAlias}.${k}`] = v;
    }

    if (!outerRow) return evalRow;
    for (const [k, v] of Object.entries(outerRow)) {
      evalRow[`outer.${k}`] = v;
    }
    return evalRow;
  }

  private getCachedQuery(sql: string): SqlRow[] | null {
    const cfg = this.getReadCacheConfig();
    if (!cfg.enabled) return null;
    if (this.transactionState !== "idle") return null;

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
    if (this.transactionState !== "idle") return;

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
      if (this.viewCatalog.has(this.normalizeViewName(schema.name))) {
        throw sqlError("ERR_UNSUPPORTED_DDL", `name conflict with existing view: ${schema.name}`);
      }
      if (this.tables.has(schema.name) || this.schemas.has(schema.name)) {
        throw sqlError("ERR_UNSUPPORTED_DDL", `table already exists: ${schema.name}`);
      }
      this.assertNoCascadeCycle(schema);
      this.tables.set(schema.name, []);
      this.schemas.set(schema.name, schema);
      this.indexCatalog.forEach((entry, indexName) => {
        if (entry.table.toUpperCase() === schema.name.toUpperCase()) this.indexCatalog.delete(indexName);
      });
      this.hashIndexes.delete(schema.name);
      this.hashIndexStats.delete(schema.name);
      this.btreeIndexes.delete(schema.name);
      this.btreeIndexStats.delete(schema.name);
      this.uniqueIndexes.delete(schema.name);
      this.uniqueGroupsCache.set(schema.name, this.collectUniqueGroups(schema));
      this.ensureUniqueIndexMaps(schema.name);
      this.syncConstraintIndexesToCatalog(schema.name);
      this.constraintCost.set(schema.name, emptyConstraintCostStats());
      this.rowVersions.delete(schema.name);
      this.tableVersionObjects.delete(schema.name);
      this.optimizerStatsVersionObjects.delete(schema.name);
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

    if (upper.startsWith("CREATE INDEX") || upper.startsWith("CREATE UNIQUE INDEX")) {
      const ast = parseSqlToAst(normalized, { dialect: this.opts.dialect ?? "ansi" });
      if (ast.kind !== "create_index") throw sqlError("ERR_UNSUPPORTED_DDL", normalized);
      const table = this.executeCreateIndexStatement(ast);
      this.recordStorageWrite(table, "ALTER_TABLE", 0, "simulator");
      this.invalidateReadCacheOnWrite();
      return {
        txDigest: this.fakeDigest(normalized),
        statementType: "CREATE",
        affectedRows: 0,
      };
    }

    if (upper.startsWith("CREATE VIEW")) {
      const ast = parseSqlToAst(normalized, { dialect: this.opts.dialect ?? "ansi" });
      if (ast.kind !== "create_view") throw sqlError("ERR_UNSUPPORTED_DDL", normalized);
      this.executeCreateViewStatement(ast);
      this.invalidateReadCacheOnWrite();
      return {
        txDigest: this.fakeDigest(normalized),
        statementType: "CREATE",
        affectedRows: 0,
      };
    }

    if (upper.startsWith("DROP INDEX")) {
      const ast = parseSqlToAst(normalized, { dialect: this.opts.dialect ?? "ansi" });
      if (ast.kind !== "drop_index") throw sqlError("ERR_UNSUPPORTED_DDL", normalized);
      const table = this.executeDropIndexStatement(ast);
      if (table) {
        this.recordStorageWrite(table, "ALTER_TABLE", 0, "simulator");
        this.invalidateReadCacheOnWrite();
      }
      return {
        txDigest: this.fakeDigest(normalized),
        statementType: "DELETE",
        affectedRows: table ? 1 : 0,
      };
    }

    if (upper.startsWith("DROP VIEW")) {
      const ast = parseSqlToAst(normalized, { dialect: this.opts.dialect ?? "ansi" });
      if (ast.kind !== "drop_view") throw sqlError("ERR_UNSUPPORTED_DDL", normalized);
      const viewName = this.executeDropViewStatement(ast);
      if (viewName) this.invalidateReadCacheOnWrite();
      return {
        txDigest: this.fakeDigest(normalized),
        statementType: "DELETE",
        affectedRows: viewName ? 1 : 0,
      };
    }

    if (upper.startsWith("DROP TABLE")) {
      const table = this.extractTableName(normalized, /DROP TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
      if (!this.tables.has(table) || !this.schemas.has(table)) {
        throw sqlError("ERR_TABLE_NOT_FOUND", table);
      }
      const dropDependents = this.collectDropDependents(table);
      if (dropDependents.length > 0) {
        throw constraintError(
          "DDL_DEPENDENCY",
          `cannot DROP TABLE ${table}: referenced by ${dropDependents.join(", ")}`,
          { token: table, clause: "DROP TABLE" },
        );
      }
      this.invalidateViewsForDroppedTable(table);
      this.tables.delete(table);
      this.schemas.delete(table);
      this.indexCatalog.forEach((entry, indexName) => {
        if (entry.table.toUpperCase() === table.toUpperCase()) this.indexCatalog.delete(indexName);
      });
      this.hashIndexes.delete(table);
      this.hashIndexStats.delete(table);
      this.btreeIndexes.delete(table);
      this.btreeIndexStats.delete(table);
      this.uniqueIndexes.delete(table);
      this.uniqueGroupsCache.delete(table);
      this.constraintCost.delete(table);
      this.indexObservability.delete(table);
      this.rowVersions.delete(table);
      this.tableVersionObjects.delete(table);
      this.optimizerStatsVersionObjects.delete(table);
      for (const [indexName, history] of [...this.indexVersionObjects.entries()]) {
        if (!history.length) continue;
        if (history[0]!.table.toUpperCase() !== table.toUpperCase()) continue;
        this.indexVersionObjects.delete(indexName);
      }
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
      this.recordImmutableOptimizerStatsVersionObject(table, { confirmationStatus: "confirmed" });
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
      const parsedInsert = this.parseInsert(normalized);
      const bucket = this.requireWritableTableForDml(table);
      const coerced = this.applySchemaOnWrite(table, parsedInsert.row, undefined, parsedInsert.bindings);
      bucket.push(coerced);
      this.addRowToUniqueIndexes(table, coerced);
      if (this.isDmlWriteStagingActive()) {
        this.recordTransactionLogWrite(table, "INSERT", coerced, null, coerced);
        this.bumpTableWriteStats(table, { insertRows: 1 });
      } else {
        this.addRowToSecondaryIndexes(table, coerced);
        this.bumpIndexMaintenanceStats(table, "INSERT", 1);
        this.dirtyTables.add(table);
        this.applyImmediateRowVersion(table, "INSERT", coerced);
        this.recordImmutableOptimizerStatsVersionObject(table, { confirmationStatus: "confirmed" });
        this.recordStorageWrite(table, "INSERT_ROW", 1, "simulator");
        this.invalidateReadCacheOnWrite();
      }
      return {
        txDigest: this.fakeDigest(normalized),
        statementType: "INSERT",
        affectedRows: 1,
      };
    }

    if (upper.startsWith("UPDATE")) {
      const plan = this.planUpdate(normalized);
      const bucket = this.requireWritableTableForDml(plan.table);

      const joinedRows = plan.join
        ? (() => {
            const rightRows = this.requireTable(plan.join.table);
            const { leftField, rightField } = this.normalizeJoinOnFields(plan, "update");
            this.assertJoinOnFieldsExist(plan, leftField, rightField, "update");
            const leftAlias = plan.join.leftAlias ?? plan.table;
            const rightAlias = plan.join.rightAlias ?? plan.join.table;
            const includeUnmatchedLeft = plan.join.type === "LEFT" || plan.join.type === "FULL";
            const rightColumns = this.schemas.get(plan.join.table)?.columns.map((c) => c.name)
              ?? (rightRows[0] ? Object.keys(rightRows[0]) : []);

            const out = new Map<SqlRow, SqlRow[]>();
            for (const l of bucket) {
              let matched = false;
              for (const r of rightRows) {
                const leftVal = l[leftField];
                const rightVal = r[rightField];
                if (!this.joinKeyEqual(leftVal, rightVal)) continue;
                matched = true;
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

              if (!matched && includeUnmatchedLeft) {
                const merged: SqlRow = {};
                for (const [k, v] of Object.entries(l)) {
                  merged[k] = v;
                  merged[`${leftAlias}.${k}`] = v;
                  merged[`${plan.table}.${k}`] = v;
                }
                for (const k of rightColumns) {
                  merged[`${rightAlias}.${k}`] = null;
                  merged[`${plan.join!.table}.${k}`] = null;
                }
                out.set(l, [merged]);
              }
            }
            return out;
          })()
        : new Map(bucket.map((row) => [row, [row]] as const));

      const whereTree = this.parseWhereTree(plan.whereExpr);
      const targetSetField = this.resolveUpdateSetField(plan);
      const updateCounts = new Map<string, number>();
      for (const row of bucket) {
        const mergedHits = joinedRows.get(row);
        if (!mergedHits || mergedHits.length === 0) continue;
        const matched = mergedHits.some((merged) => this.evaluateWhereTree(merged, whereTree) === "TRUE");
        if (!matched) continue;

        // Validate/coerce and enforce constraints before mutating row or indexes.
        const rawSetValue = this.castValue(plan.setValue);
        let boundSetValue: SqlTypedValue | undefined;
        try {
          boundSetValue = fromLiteral(
            rawSetValue,
            undefined,
            {},
            `dml.update.set:${plan.table}.${targetSetField}`,
          );
        } catch {
          // Invalid literal shape will be re-validated against column type in applySchemaOnWrite.
        }
        const next = this.applySchemaOnWrite(
          plan.table,
          { ...row, [targetSetField]: (boundSetValue?.value ?? rawSetValue) as SqlPrimitive },
          row,
          boundSetValue ? { [targetSetField]: boundSetValue } : {},
        );
        const beforeImage = { ...row };
        this.assertOnUpdateActionAllowed(plan.table, beforeImage, next);
        this.commitRowUpdate(plan.table, row, next);
        updateCounts.set(plan.table, (updateCounts.get(plan.table) ?? 0) + 1);

        const cascaded = this.applyOnUpdateCascade(plan.table, beforeImage, row);
        for (const [table, count] of cascaded.entries()) {
          updateCounts.set(table, (updateCounts.get(table) ?? 0) + count);
        }
      }
      const touched = [...updateCounts.values()].reduce((sum, count) => sum + count, 0);
      if (this.isDmlWriteStagingActive()) {
        for (const [table, count] of updateCounts.entries()) {
          if (count > 0) this.bumpTableWriteStats(table, { updateRows: count });
        }
      } else {
        for (const [table, count] of updateCounts.entries()) {
          if (count > 0) this.dirtyTables.add(table);
          if (count > 0) this.recordImmutableOptimizerStatsVersionObject(table, { confirmationStatus: "confirmed" });
          if (count > 0) this.recordStorageWrite(table, "UPDATE_ROW", count, "simulator");
        }
        if (touched > 0) this.invalidateReadCacheOnWrite();
      }
      return {
        txDigest: this.fakeDigest(normalized),
        statementType: "UPDATE",
        affectedRows: touched,
      };
    }

    if (upper.startsWith("DELETE")) {
      const plan = this.planDelete(normalized);
      const bucket = this.requireWritableTableForDml(plan.table);

      const joinedRows = plan.join
        ? (() => {
            const rightRows = this.requireTable(plan.join.table);
            const { leftField, rightField } = this.normalizeJoinOnFields(plan, "delete");
            this.assertJoinOnFieldsExist(plan, leftField, rightField, "delete");
            const leftAlias = plan.join.leftAlias ?? plan.table;
            const rightAlias = plan.join.rightAlias ?? plan.join.table;
            const includeUnmatchedLeft = plan.join.type === "LEFT" || plan.join.type === "FULL";
            const rightColumns = this.schemas.get(plan.join.table)?.columns.map((c) => c.name)
              ?? (rightRows[0] ? Object.keys(rightRows[0]) : []);

            const out = new Map<SqlRow, SqlRow[]>();
            for (const l of bucket) {
              let matched = false;
              for (const r of rightRows) {
                const leftVal = l[leftField];
                const rightVal = r[rightField];
                if (!this.joinKeyEqual(leftVal, rightVal)) continue;
                matched = true;

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

              if (!matched && includeUnmatchedLeft) {
                const merged: SqlRow = {};
                for (const [k, v] of Object.entries(l)) {
                  merged[k] = v;
                  merged[`${leftAlias}.${k}`] = v;
                  merged[`${plan.table}.${k}`] = v;
                }
                for (const k of rightColumns) {
                  merged[`${rightAlias}.${k}`] = null;
                  merged[`${plan.join!.table}.${k}`] = null;
                }
                out.set(l, [merged]);
              }
            }
            return out;
          })()
        : new Map(bucket.map((row) => [row, [row]] as const));

      const whereTree = this.parseWhereTree(plan.whereExpr);
      const matchedRows: SqlRow[] = [];
      for (const row of bucket) {
        const mergedHits = joinedRows.get(row);
        const matched = mergedHits ? mergedHits.some((merged) => this.evaluateWhereTree(merged, whereTree) === "TRUE") : false;
        if (matched) matchedRows.push(row);
      }

      const deleteTargets = this.collectDeleteTargetsWithCascade(plan.table, matchedRows);
      const deleteCounts = this.applyDeleteTargets(deleteTargets);
      const touched = [...deleteCounts.values()].reduce((sum, count) => sum + count, 0);

      if (this.isDmlWriteStagingActive()) {
        for (const [table, count] of deleteCounts.entries()) {
          if (count > 0) this.bumpTableWriteStats(table, { deleteRows: count });
        }
      } else {
        for (const [table, count] of deleteCounts.entries()) {
          if (count > 0) this.dirtyTables.add(table);
          if (count > 0) this.recordImmutableOptimizerStatsVersionObject(table, { confirmationStatus: "confirmed" });
          if (count > 0) this.recordStorageWrite(table, "DELETE_ROW", count, "simulator");
        }
        if (touched > 0) this.invalidateReadCacheOnWrite();
      }
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

  private resolveJoinReorderFieldRef(
    field: string,
    knownTables: Map<string, string>,
  ): { table: string; column: string } | null {
    const trimmed = field.trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_\.]*$/.test(trimmed)) return null;
    const parts = trimmed.split(".");
    if (parts.length < 2) return null;
    const tableToken = parts[0]!;
    const column = parts.at(-1)!;
    const table = knownTables.get(tableToken.toUpperCase());
    if (!table) return null;
    return { table, column };
  }

  private estimateJoinReorderTableSelectivity(
    parsed: Pick<ParsedSelect, "table" | "whereClauses">,
    table: string,
    tableRowCount: number,
    stats: OptimizerTableStatistics | undefined,
  ): number {
    if (parsed.whereClauses.length === 0) return 1;
    const target = table.toUpperCase();
    const base = parsed.table.toUpperCase();

    const relevantClauses: WhereClause[] = [];
    for (const clause of parsed.whereClauses) {
      const field = clause.field?.trim();
      if (!field) continue;
      const parts = field.split(".");
      const hasQualifier = parts.length >= 2;
      if (hasQualifier) {
        const qualifier = parts[0]!.toUpperCase();
        if (qualifier !== target) continue;
      } else if (target !== base) {
        // Unqualified columns are assumed to belong to the base table in join planning.
        continue;
      }
      relevantClauses.push(clause);
    }

    if (relevantClauses.length === 0) return 1;
    return this.estimateWhereClausesSelectivity(relevantClauses, tableRowCount, stats);
  }

  private pickJoinReorderColumnStats(
    stats: OptimizerTableStatistics | undefined,
    column: string,
  ): OptimizerColumnStatistics | undefined {
    if (!stats) return undefined;
    return stats.columns.find((entry) => entry.column.toUpperCase() === column.toUpperCase());
  }

  private estimateJoinReorderSelectivity(
    leftStats: OptimizerTableStatistics | undefined,
    leftColumn: string,
    rightStats: OptimizerTableStatistics | undefined,
    rightColumn: string,
  ): number {
    const leftColumnStats = this.pickJoinReorderColumnStats(leftStats, leftColumn);
    const rightColumnStats = this.pickJoinReorderColumnStats(rightStats, rightColumn);

    const leftNonNull = this.clampSelectivity(1 - (leftColumnStats?.nullRatio ?? 0));
    const rightNonNull = this.clampSelectivity(1 - (rightColumnStats?.nullRatio ?? 0));
    const ndvLeft = leftColumnStats?.ndv ?? 0;
    const ndvRight = rightColumnStats?.ndv ?? 0;
    const denom = Math.max(ndvLeft, ndvRight);

    if (denom <= 0) {
      return this.clampSelectivity(leftNonNull * rightNonNull * DEFAULT_JOIN_SELECTIVITY);
    }
    return this.clampSelectivity((leftNonNull * rightNonNull) / denom);
  }

  private tryCostBasedJoinReorder(
    baseTable: string,
    joins: SelectJoinStep[],
    parsed: Pick<ParsedSelect, "table" | "whereClauses">,
  ): { joins: SelectJoinStep[]; joinReorder: LogicalJoinReorderInfo } {
    const originalJoinOrder = joins.map((join) => join.table);
    const baseJoinReorder: LogicalJoinReorderInfo = {
      applied: false,
      algorithm: "NONE",
      estimatedCost: null,
      originalJoinOrder,
      finalJoinOrder: originalJoinOrder,
    };

    if (joins.length < 2) return { joins, joinReorder: baseJoinReorder };
    if (joins.some((join) => join.type !== "INNER")) return { joins, joinReorder: baseJoinReorder };

    const tableByUpper = new Map<string, string>();
    const allTables = [baseTable, ...joins.map((join) => join.table)];
    for (const table of allTables) {
      const upper = table.toUpperCase();
      if (tableByUpper.has(upper)) return { joins, joinReorder: baseJoinReorder };
      tableByUpper.set(upper, table);
    }

    type JoinEdge = {
      id: number;
      leftTable: string;
      leftColumn: string;
      rightTable: string;
      rightColumn: string;
    };

    const edges: JoinEdge[] = [];
    for (let i = 0; i < joins.length; i++) {
      const join = joins[i]!;
      const leftRef = this.resolveJoinReorderFieldRef(join.leftField, tableByUpper);
      const rightRef = this.resolveJoinReorderFieldRef(join.rightField, tableByUpper);
      if (!leftRef || !rightRef) return { joins, joinReorder: baseJoinReorder };
      if (leftRef.table.toUpperCase() === rightRef.table.toUpperCase()) return { joins, joinReorder: baseJoinReorder };

      const joinTableUpper = join.table.toUpperCase();
      if (joinTableUpper !== leftRef.table.toUpperCase() && joinTableUpper !== rightRef.table.toUpperCase()) {
        return { joins, joinReorder: baseJoinReorder };
      }

      edges.push({
        id: i,
        leftTable: leftRef.table,
        leftColumn: leftRef.column,
        rightTable: rightRef.table,
        rightColumn: rightRef.column,
      });
    }

    const tableRuntime = new Map<string, {
      rows: number;
      filteredRows: number;
      stats: OptimizerTableStatistics | undefined;
    }>();
    for (const table of tableByUpper.values()) {
      const stats = this.getOptimizerStatistics(table)[0];
      const rowCount = Math.max(0, stats?.rowCount ?? this.tables.get(table)?.length ?? 0);
      const selectivity = this.estimateJoinReorderTableSelectivity(parsed, table, rowCount, stats);
      const filteredRows = Math.max(0, Math.ceil(rowCount * selectivity));
      tableRuntime.set(table, { rows: rowCount, filteredRows, stats });
    }

    const visitedTables = new Set<string>([baseTable.toUpperCase()]);
    const usedEdges = new Set<number>();
    const reorderedJoins: SelectJoinStep[] = [];

    let runningRows = tableRuntime.get(baseTable)?.filteredRows ?? 0;
    let totalCost = Math.max(1, runningRows);

    while (reorderedJoins.length < joins.length) {
      let bestCandidate: {
        edgeId: number;
        leftTable: string;
        leftColumn: string;
        rightTable: string;
        rightColumn: string;
        outputRows: number;
        stepCost: number;
      } | null = null;

      for (const edge of edges) {
        if (usedEdges.has(edge.id)) continue;
        const leftVisited = visitedTables.has(edge.leftTable.toUpperCase());
        const rightVisited = visitedTables.has(edge.rightTable.toUpperCase());
        if (leftVisited === rightVisited) continue;

        const leftTable = leftVisited ? edge.leftTable : edge.rightTable;
        const rightTable = leftVisited ? edge.rightTable : edge.leftTable;
        const leftColumn = leftVisited ? edge.leftColumn : edge.rightColumn;
        const rightColumn = leftVisited ? edge.rightColumn : edge.leftColumn;

        const rightRows = tableRuntime.get(rightTable)?.filteredRows ?? 0;
        const joinSelectivity = this.estimateJoinReorderSelectivity(
          tableRuntime.get(leftTable)?.stats,
          leftColumn,
          tableRuntime.get(rightTable)?.stats,
          rightColumn,
        );

        const outputRows = Math.max(0, Math.ceil(runningRows * rightRows * joinSelectivity));
        const stepCost = runningRows + rightRows + outputRows;

        if (!bestCandidate) {
          bestCandidate = { edgeId: edge.id, leftTable, leftColumn, rightTable, rightColumn, outputRows, stepCost };
          continue;
        }
        if (stepCost < bestCandidate.stepCost) {
          bestCandidate = { edgeId: edge.id, leftTable, leftColumn, rightTable, rightColumn, outputRows, stepCost };
          continue;
        }
        if (stepCost > bestCandidate.stepCost) continue;
        if (outputRows < bestCandidate.outputRows) {
          bestCandidate = { edgeId: edge.id, leftTable, leftColumn, rightTable, rightColumn, outputRows, stepCost };
          continue;
        }
        if (outputRows > bestCandidate.outputRows) continue;
        if (rightTable.localeCompare(bestCandidate.rightTable) < 0) {
          bestCandidate = { edgeId: edge.id, leftTable, leftColumn, rightTable, rightColumn, outputRows, stepCost };
        }
      }

      if (!bestCandidate) {
        return { joins, joinReorder: baseJoinReorder };
      }

      usedEdges.add(bestCandidate.edgeId);
      visitedTables.add(bestCandidate.rightTable.toUpperCase());
      runningRows = bestCandidate.outputRows;
      totalCost += bestCandidate.stepCost;

      reorderedJoins.push({
        type: "INNER",
        table: bestCandidate.rightTable,
        leftField: `${bestCandidate.leftTable}.${bestCandidate.leftColumn}`,
        rightField: `${bestCandidate.rightTable}.${bestCandidate.rightColumn}`,
      });
    }

    const finalJoinOrder = reorderedJoins.map((join) => join.table);
    const applied = finalJoinOrder.some(
      (table, idx) => table.toUpperCase() !== (originalJoinOrder[idx] ?? "").toUpperCase(),
    );
    if (!applied) {
      return {
        joins,
        joinReorder: {
          ...baseJoinReorder,
          estimatedCost: Math.max(1, Math.ceil(totalCost)),
        },
      };
    }

    return {
      joins: reorderedJoins,
      joinReorder: {
        applied: true,
        algorithm: "GREEDY_CBO",
        estimatedCost: Math.max(1, Math.ceil(totalCost)),
        originalJoinOrder,
        finalJoinOrder,
      },
    };
  }

  private buildLogicalSelectPlan(parsed: ParsedSelect): LogicalSelectPlan {
    const rewriteRules: LogicalRewriteRule[] = [];

    const rawJoins = parsed.joins?.length
      ? parsed.joins.map((j) => ({
          type: j.type,
          table: j.table,
          leftField: j.leftField,
          rightField: j.rightField,
        }))
      : parsed.join
      ? [{
          type: parsed.join.type,
          table: parsed.join.table,
          leftField: parsed.join.leftField,
          rightField: parsed.join.rightField,
        }]
      : [];
    if (rawJoins.length > 0) rewriteRules.push("RULE_CANONICALIZE_JOIN_CHAIN");

    const reorderedJoinPlan = this.tryCostBasedJoinReorder(parsed.table, rawJoins, {
      table: parsed.table,
      whereClauses: parsed.whereClauses,
    });
    const joins = reorderedJoinPlan.joins;
    const joinReorder = reorderedJoinPlan.joinReorder;
    if (joinReorder.applied) rewriteRules.push("RULE_COST_BASED_JOIN_REORDER");

    const orderByList = parsed.orderByList?.map((order) => ({
      field: order.field.trim(),
      direction: (order.direction === "DESC" ? "DESC" : "ASC") as "ASC" | "DESC",
    }));
    const orderChanged = Boolean(
      orderByList?.some((order, idx) => {
        const source = parsed.orderByList?.[idx];
        if (!source) return false;
        return source.field !== order.field || source.direction !== order.direction;
      }),
    );
    if (orderChanged) rewriteRules.push("RULE_NORMALIZE_ORDER_BY_DIRECTION");

    const predicateSource: LogicalPredicateSource = parsed.whereAst
      ? "AST"
      : parsed.whereTree
      ? "TREE"
      : parsed.whereClauses.length
      ? "CLAUSES"
      : "NONE";
    if (predicateSource === "AST" && (parsed.whereTree || parsed.whereClauses.length > 0)) {
      rewriteRules.push("RULE_PREFER_AST_PREDICATE");
    }

    return {
      table: parsed.table,
      fields: parsed.fields,
      joins,
      joinReorder,
      predicateSource,
      where: parsed.where,
      having: parsed.having,
      groupBy: parsed.groupBy,
      aggregate: parsed.aggregate,
      aggregateField: parsed.aggregateField,
      orderByList,
      limit: parsed.limit,
      offset: parsed.offset,
      rowNumberAlias: parsed.rowNumberAlias,
      rowNumberSpec: parsed.rowNumberSpec,
      rewriteRules,
    };
  }

  private estimateSortWork(rows: number, orderByCount: number): number {
    if (rows <= 1 || orderByCount <= 0) return 0;
    const logFactor = Math.max(1, Math.ceil(Math.log2(rows + 1)));
    return rows * logFactor * orderByCount;
  }

  private estimateJoinSortWork(rows: number): number {
    if (rows <= 1) return rows;
    return Math.max(1, Math.ceil(this.estimateSortWork(rows, 1) * SORT_MERGE_SORT_WORK_FACTOR));
  }

  private estimateJoinStepSelectivity(join: SelectJoinStep): number {
    const parseRef = (field: string): { table: string; column: string } | null => {
      const trimmed = field.trim();
      if (!/^[a-zA-Z_][a-zA-Z0-9_\.]*$/.test(trimmed)) return null;
      const parts = trimmed.split(".");
      if (parts.length < 2) return null;
      return { table: parts[0]!, column: parts.at(-1)! };
    };

    const leftRef = parseRef(join.leftField);
    const rightRef = parseRef(join.rightField);
    if (!leftRef || !rightRef) return DEFAULT_JOIN_SELECTIVITY;

    const leftStats = this.getOptimizerStatistics(leftRef.table)[0];
    const rightStats = this.getOptimizerStatistics(rightRef.table)[0];
    if (!leftStats || !rightStats) return DEFAULT_JOIN_SELECTIVITY;

    return this.estimateJoinReorderSelectivity(leftStats, leftRef.column, rightStats, rightRef.column);
  }

  private estimateJoinOutputRows(
    leftRows: number,
    rightRows: number,
    join: SelectJoinStep,
  ): number {
    const left = Math.max(0, leftRows);
    const right = Math.max(0, rightRows);
    const selectivity = this.clampSelectivity(this.estimateJoinStepSelectivity(join));
    const matchedRows = Math.max(0, Math.ceil(left * right * selectivity));

    if (join.type === "LEFT") return Math.max(left, matchedRows);
    if (join.type === "RIGHT") return Math.max(right, matchedRows);
    if (join.type === "FULL") return Math.max(Math.max(left, right), matchedRows);
    return matchedRows;
  }

  private chooseJoinExecutionAlgorithm(leftRows: number, rightRows: number): {
    algorithm: JoinExecutionAlgorithm;
    estimatedCost: number;
  } {
    const left = Math.max(0, leftRows);
    const right = Math.max(0, rightRows);
    const buildRows = Math.min(left, right);
    const probeRows = Math.max(left, right);
    const hashSpillPenalty = buildRows > HASH_JOIN_BUILD_ROW_THRESHOLD
      ? Math.ceil(buildRows * HASH_JOIN_SPILL_PENALTY_FACTOR)
      : 0;

    const costs: Record<JoinExecutionAlgorithm, number> = {
      NESTED_LOOP: Math.max(1, left * right),
      HASH_JOIN: Math.max(1, buildRows + probeRows + HASH_JOIN_STARTUP_COST + hashSpillPenalty),
      SORT_MERGE_JOIN: Math.max(
        1,
        this.estimateJoinSortWork(left) + this.estimateJoinSortWork(right) + left + right + SORT_MERGE_JOIN_STARTUP_COST,
      ),
    };

    const rank: Record<JoinExecutionAlgorithm, number> = {
      NESTED_LOOP: 0,
      HASH_JOIN: 1,
      SORT_MERGE_JOIN: 2,
    };

    let bestAlgorithm: JoinExecutionAlgorithm = "NESTED_LOOP";
    for (const candidate of (["HASH_JOIN", "SORT_MERGE_JOIN"] as JoinExecutionAlgorithm[])) {
      const candidateCost = costs[candidate];
      const bestCost = costs[bestAlgorithm];
      if (candidateCost < bestCost || (candidateCost === bestCost && rank[candidate] < rank[bestAlgorithm])) {
        bestAlgorithm = candidate;
      }
    }

    return {
      algorithm: bestAlgorithm,
      estimatedCost: costs[bestAlgorithm],
    };
  }

  private buildPhysicalJoinPlan(baseRows: number, joins: SelectJoinStep[]): PhysicalJoinPlanStep[] {
    const out: PhysicalJoinPlanStep[] = [];
    let runningRows = Math.max(0, baseRows);

    for (const join of joins) {
      const rightRows = Math.max(0, this.requireTable(join.table).length);
      const chosen = this.chooseJoinExecutionAlgorithm(runningRows, rightRows);
      const estimatedOutputRows = this.estimateJoinOutputRows(runningRows, rightRows, join);

      out.push({
        algorithm: chosen.algorithm,
        estimatedCost: chosen.estimatedCost,
        estimatedOutputRows,
        leftRows: runningRows,
        rightRows,
      });
      runningRows = estimatedOutputRows;
    }

    return out;
  }

  private toUnqualifiedColumnName(field: string): string | null {
    const trimmed = field.trim();
    if (!trimmed) return null;
    if (!/^[a-zA-Z_][a-zA-Z0-9_\.]*$/.test(trimmed)) return null;
    return trimmed.includes(".") ? (trimmed.split(".").at(-1) ?? null) : trimmed;
  }

  private isCoveringIndexAccess(parsed: ParsedSelect, indexColumn: string): boolean {
    if (parsed.joins?.length) return false;
    if (parsed.aggregate || parsed.groupBy?.length || parsed.having || parsed.rowNumberAlias || parsed.rowNumberSpec) {
      return false;
    }
    if (parsed.fields.length === 1 && parsed.fields[0] === "*") return false;

    const requiredColumns = new Set<string>();
    for (const field of parsed.fields) {
      const column = this.toUnqualifiedColumnName(field);
      if (!column) return false;
      requiredColumns.add(column.toUpperCase());
    }

    for (const clause of parsed.whereClauses) {
      if (!clause.field) continue;
      const column = this.toUnqualifiedColumnName(clause.field);
      if (!column) return false;
      requiredColumns.add(column.toUpperCase());
    }

    for (const order of parsed.orderByList ?? []) {
      const column = this.toUnqualifiedColumnName(order.field);
      if (!column) return false;
      requiredColumns.add(column.toUpperCase());
    }

    if (requiredColumns.size === 0) return false;
    const targetColumn = indexColumn.toUpperCase();
    for (const column of requiredColumns) {
      if (column !== targetColumn) return false;
    }
    return true;
  }

  private resolvePhysicalIndexAccessStrategy(
    parsed: ParsedSelect,
    method: PhysicalAccessPathMethod,
    indexColumn?: string,
  ): PhysicalIndexAccessStrategy {
    if (method === "TABLE_SCAN") return "FULL_TABLE_SCAN";
    if (!indexColumn) return "INDEX_BACK_TABLE";
    return this.isCoveringIndexAccess(parsed, indexColumn) ? "INDEX_SCAN" : "INDEX_BACK_TABLE";
  }

  private estimatePhysicalAccessPathCost(
    parsed: ParsedSelect,
    tableRows: number,
    method: PhysicalAccessPathMethod,
    scannedRows: number,
    estimatedRows: number,
    orderSatisfied: boolean,
    indexStrategy: PhysicalIndexAccessStrategy,
  ): number {
    let cost = Math.max(1, scannedRows);
    const hasPredicate = Boolean(parsed.whereAst || parsed.whereTree || parsed.whereClauses.length > 0);
    const hasOrder = Boolean(parsed.orderByList?.length);

    if (hasPredicate) {
      cost += Math.max(1, Math.ceil(scannedRows * 0.15));
    }
    if (!orderSatisfied) {
      cost += this.estimateSortWork(Math.max(1, estimatedRows), parsed.orderByList?.length ?? 0);
    }
    if (parsed.groupBy?.length || parsed.aggregate || parsed.having || parsed.rowNumberAlias) {
      cost += Math.max(1, Math.ceil(Math.max(1, estimatedRows) * 0.5));
    }

    switch (method) {
      case "TABLE_SCAN":
        cost += Math.max(1, Math.ceil(tableRows * 0.25));
        if (hasPredicate) cost += Math.max(2, Math.ceil(tableRows * 0.75));
        if (hasOrder) cost += Math.max(1, Math.ceil(tableRows * 0.25));
        break;
      case "HASH_INDEX_LOOKUP":
        cost += 3;
        if (indexStrategy === "INDEX_BACK_TABLE") {
          cost += Math.max(1, Math.ceil(scannedRows * INDEX_BACK_TABLE_FETCH_RATIO));
        }
        break;
      case "BTREE_INDEX_LOOKUP":
        cost += 4;
        if (indexStrategy === "INDEX_BACK_TABLE") {
          cost += Math.max(1, Math.ceil(scannedRows * INDEX_BACK_TABLE_FETCH_RATIO));
        }
        break;
      case "BTREE_ORDERED_SCAN":
        cost += 2;
        if (indexStrategy === "INDEX_BACK_TABLE") {
          cost += Math.max(1, Math.ceil(scannedRows * INDEX_BACK_TABLE_FETCH_RATIO));
        }
        break;
      default:
        break;
    }

    return cost;
  }

  private physicalMethodRank(method: PhysicalAccessPathMethod): number {
    switch (method) {
      case "BTREE_ORDERED_SCAN":
        return 0;
      case "HASH_INDEX_LOOKUP":
        return 1;
      case "BTREE_INDEX_LOOKUP":
        return 2;
      case "TABLE_SCAN":
      default:
        return 3;
    }
  }

  private pickBestPhysicalAccessPath(candidates: PhysicalSelectRuntimePath[]): PhysicalSelectRuntimePath {
    let best = candidates[0]!;
    for (let i = 1; i < candidates.length; i++) {
      const candidate = candidates[i]!;
      if (candidate.estimatedCost < best.estimatedCost) {
        best = candidate;
        continue;
      }
      if (candidate.estimatedCost > best.estimatedCost) continue;

      if (candidate.orderSatisfied && !best.orderSatisfied) {
        best = candidate;
        continue;
      }
      if (!candidate.orderSatisfied && best.orderSatisfied) continue;

      if (candidate.estimatedRows < best.estimatedRows) {
        best = candidate;
        continue;
      }
      if (candidate.estimatedRows > best.estimatedRows) continue;

      if (this.physicalMethodRank(candidate.method) < this.physicalMethodRank(best.method)) {
        best = candidate;
      }
    }
    return best;
  }

  private samePhysicalAccessPath(
    left: Pick<PhysicalSelectAccessPath, "method" | "indexName" | "indexColumn">,
    right: Pick<PhysicalSelectAccessPath, "method" | "indexName" | "indexColumn">,
  ): boolean {
    return (
      left.method === right.method
      && (left.indexName ?? null) === (right.indexName ?? null)
      && (left.indexColumn ?? null) === (right.indexColumn ?? null)
    );
  }

  private findPreferredRuntimePath(
    candidates: PhysicalSelectRuntimePath[],
    state: SelectPlanStabilityState,
  ): PhysicalSelectRuntimePath | null {
    const preferredIndexName = state.preferredIndexName?.toUpperCase();
    const preferredIndexColumn = state.preferredIndexColumn?.toUpperCase();
    for (const candidate of candidates) {
      if (candidate.method !== state.preferredMethod) continue;
      if (preferredIndexName && candidate.indexName?.toUpperCase() !== preferredIndexName) continue;
      if (preferredIndexColumn && candidate.indexColumn?.toUpperCase() !== preferredIndexColumn) continue;
      return candidate;
    }
    return candidates.find((candidate) => candidate.method === state.preferredMethod) ?? null;
  }

  private applySelectPlanStabilityPolicy(
    stabilityKey: string | undefined,
    optimizerChoice: PhysicalSelectRuntimePath,
    candidates: PhysicalSelectRuntimePath[],
  ): { chosen: PhysicalSelectRuntimePath; reason: PlanStabilityReason } {
    if (!stabilityKey) return { chosen: optimizerChoice, reason: "NONE" };
    const state = this.selectPlanStability.get(stabilityKey);
    if (!state) return { chosen: optimizerChoice, reason: "NONE" };

    const tableScan = candidates.find((candidate) => candidate.method === "TABLE_SCAN");
    if (state.badPlanFallbackRemaining > 0 && tableScan) {
      return { chosen: tableScan, reason: "BAD_PLAN_FALLBACK_PIN" };
    }

    const preferred = this.findPreferredRuntimePath(candidates, state);
    if (!preferred) return { chosen: optimizerChoice, reason: "NONE" };
    if (this.samePhysicalAccessPath(preferred, optimizerChoice)) {
      return { chosen: optimizerChoice, reason: "NONE" };
    }

    if (optimizerChoice.estimatedCost <= preferred.estimatedCost * SELECT_PLAN_STABILITY_SWITCH_RATIO) {
      return { chosen: optimizerChoice, reason: "NONE" };
    }

    return { chosen: preferred, reason: "PLAN_STABILITY_PIN" };
  }

  private shouldTriggerBadPlanFallback(
    parsed: ParsedSelect,
    chosen: PhysicalSelectAccessPath,
    scannedRows: number,
    tableRows: number,
    resultRows: number,
  ): boolean {
    if (chosen.method !== "HASH_INDEX_LOOKUP" && chosen.method !== "BTREE_INDEX_LOOKUP") return false;
    if (chosen.indexStrategy !== "INDEX_BACK_TABLE") return false;
    if (tableRows < BAD_PLAN_FALLBACK_MIN_TABLE_ROWS) return false;
    if (chosen.orderSatisfied) return false;

    const hasPredicate = Boolean(parsed.whereAst || parsed.whereTree || parsed.whereClauses.length > 0);
    if (!hasPredicate) return false;

    const normalizedScannedRows = Math.max(1, scannedRows);
    const scanRatio = normalizedScannedRows / Math.max(1, tableRows);
    if (scanRatio < BAD_PLAN_FALLBACK_SCAN_RATIO) return false;

    const rowRetention = resultRows / normalizedScannedRows;
    if (rowRetention < BAD_PLAN_FALLBACK_RESULT_RATIO) return false;
    return true;
  }

  private recordSelectPlanFeedback(
    stabilityKey: string | undefined,
    parsed: ParsedSelect,
    plan: SelectExecutionPlan,
    resultRows: number,
    tableRows: number,
  ): void {
    if (!stabilityKey) return;

    const chosen = plan.physical.chosen;
    const state: SelectPlanStabilityState = this.selectPlanStability.get(stabilityKey) ?? {
      preferredMethod: chosen.method,
      preferredIndexName: chosen.indexName,
      preferredIndexColumn: chosen.indexColumn,
      badPlanFallbackRemaining: 0,
      badPlanFallbackCount: 0,
      stablePinCount: 0,
      planSwitchCount: 0,
      executions: 0,
      lastReason: "NONE",
    };

    state.executions += 1;
    if (plan.physical.stabilityReason === "PLAN_STABILITY_PIN") state.stablePinCount += 1;
    if (plan.physical.stabilityReason === "BAD_PLAN_FALLBACK_PIN" && state.badPlanFallbackRemaining > 0) {
      state.badPlanFallbackRemaining = Math.max(0, state.badPlanFallbackRemaining - 1);
    }

    if (this.shouldTriggerBadPlanFallback(parsed, chosen, plan.scannedRows.length, tableRows, resultRows)) {
      state.badPlanFallbackCount += 1;
      state.badPlanFallbackRemaining = Math.max(state.badPlanFallbackRemaining, BAD_PLAN_FALLBACK_COOLDOWN);
      state.preferredMethod = "TABLE_SCAN";
      state.preferredIndexName = undefined;
      state.preferredIndexColumn = undefined;
      state.lastReason = "BAD_PLAN_TRIGGER";
      this.selectPlanStability.set(stabilityKey, state);
      return;
    }

    if (
      state.preferredMethod !== chosen.method
      || (state.preferredIndexName ?? null) !== (chosen.indexName ?? null)
      || (state.preferredIndexColumn ?? null) !== (chosen.indexColumn ?? null)
    ) {
      state.planSwitchCount += 1;
      state.preferredMethod = chosen.method;
      state.preferredIndexName = chosen.indexName;
      state.preferredIndexColumn = chosen.indexColumn;
    }

    state.lastReason = plan.physical.stabilityReason;
    this.selectPlanStability.set(stabilityKey, state);
  }

  private resolveCanonicalTableName(table: string): string | null {
    const target = table.trim().toUpperCase();
    if (!target) return null;
    for (const tableName of this.schemas.keys()) {
      if (tableName.toUpperCase() === target) return tableName;
    }
    return null;
  }

  private buildOptimizerHistogram(values: SqlPrimitive[]): OptimizerHistogramBucket[] {
    if (values.length === 0) return [];

    const frequencies = new Map<string, { value: SqlPrimitive; rowCount: number }>();
    for (const value of values) {
      const key = this.encodeTypedKey(value, "optimizer.stats.histogram");
      const existing = frequencies.get(key);
      if (existing) existing.rowCount += 1;
      else frequencies.set(key, { value, rowCount: 1 });
    }

    const sorted = [...frequencies.values()].sort((a, b) => this.compareForOrder(a.value, b.value, "ASC"));
    if (sorted.length === 0) return [];

    const bucketCap = Math.min(OPTIMIZER_HISTOGRAM_MAX_BUCKETS, sorted.length);
    const targetRowsPerBucket = Math.max(1, Math.ceil(values.length / bucketCap));
    const out: OptimizerHistogramBucket[] = [];

    let lowerBound = sorted[0]!.value;
    let upperBound = sorted[0]!.value;
    let rowCount = 0;
    let ndv = 0;

    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i]!;
      if (ndv === 0) lowerBound = entry.value;
      upperBound = entry.value;
      rowCount += entry.rowCount;
      ndv += 1;

      const isLastEntry = i === sorted.length - 1;
      const remainingEntries = sorted.length - i - 1;
      const remainingBuckets = bucketCap - out.length - 1;
      const reachedTarget = rowCount >= targetRowsPerBucket;
      const atBucketCapacity = out.length + 1 >= bucketCap;
      const shouldClose = isLastEntry || (!atBucketCapacity && reachedTarget && remainingEntries >= remainingBuckets);

      if (!shouldClose) continue;
      out.push({ lowerBound, upperBound, rowCount, ndv });
      rowCount = 0;
      ndv = 0;
    }

    return out;
  }

  private collectOptimizerStatisticsForTable(table: string): OptimizerTableStatistics | null {
    const schema = this.schemas.get(table);
    const rows = this.tables.get(table);
    if (!schema || !rows) return null;

    const rowCount = rows.length;
    const columns: OptimizerColumnStatistics[] = schema.columns.map((column) => {
      let nullCount = 0;
      const distinct = new Set<string>();
      const nonNullValues: SqlPrimitive[] = [];

      for (const row of rows) {
        const rawValue = this.resolveRowValue(row, column.name);
        if (rawValue === null || rawValue === undefined) {
          nullCount += 1;
          continue;
        }

        const value = rawValue as SqlPrimitive;
        distinct.add(this.encodeTypedKey(value, `optimizer.stats.ndv:${table}.${column.name}`));
        nonNullValues.push(value);
      }

      return {
        column: column.name,
        rowCount,
        ndv: distinct.size,
        nullCount,
        nullRatio: rowCount > 0 ? nullCount / rowCount : 0,
        histogram: this.buildOptimizerHistogram(nonNullValues),
      };
    });

    return {
      table,
      rowCount,
      analyzedAt: Date.now(),
      columns,
    };
  }

  private pickPredicateColumnStats(
    stats: OptimizerTableStatistics | undefined,
    whereClauses: WhereClause[],
  ): OptimizerColumnStatistics | undefined {
    if (!stats || whereClauses.length === 0) return undefined;
    for (const clause of whereClauses) {
      const field = clause.field?.trim();
      if (!field) continue;
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) continue;
      const hit = stats.columns.find((columnStats) => columnStats.column.toUpperCase() === field.toUpperCase());
      if (hit) return hit;
    }
    return undefined;
  }

  private clampSelectivity(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
  }

  private parseSelectivityLiteral(
    rawExpr: string,
  ): { parsed: false; value: undefined } | { parsed: true; value: SqlPrimitive } {
    const trimmed = rawExpr.trim();
    if (!trimmed) return { parsed: false, value: undefined };
    if (/^[a-zA-Z_][a-zA-Z0-9_\.]*$/.test(trimmed)) return { parsed: false, value: undefined };

    const isQuoted = (trimmed.startsWith("'") && trimmed.endsWith("'"))
      || (trimmed.startsWith("\"") && trimmed.endsWith("\""));
    const isSimpleNumber = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed);
    const isSimpleBooleanOrNull = /^(TRUE|FALSE|NULL)$/i.test(trimmed);
    if (!isQuoted && !isSimpleNumber && !isSimpleBooleanOrNull) {
      return { parsed: false, value: undefined };
    }

    return { parsed: true, value: this.castValue(trimmed) as SqlPrimitive };
  }

  private resolveSelectivityColumnStats(
    stats: OptimizerTableStatistics | undefined,
    clause: WhereClause,
  ): OptimizerColumnStatistics | undefined {
    if (!stats) return undefined;

    if (clause.valueExpr && !/^[a-zA-Z_][a-zA-Z0-9_\.]*$/.test(clause.valueExpr.trim())) {
      return undefined;
    }

    const rawField = clause.field?.trim();
    if (!rawField || !/^[a-zA-Z_][a-zA-Z0-9_\.]*$/.test(rawField)) return undefined;
    const normalized = rawField.includes(".") ? rawField.split(".").at(-1) ?? rawField : rawField;
    return stats.columns.find((columnStats) => columnStats.column.toUpperCase() === normalized.toUpperCase());
  }

  private estimateEqualitySelectivity(
    tableRowCount: number,
    columnStats: OptimizerColumnStatistics | undefined,
    literal: SqlPrimitive,
  ): number {
    if (literal === null || literal === undefined) return 0;

    const nullRatio = this.clampSelectivity(columnStats?.nullRatio ?? 0);
    const nonNullRatio = this.clampSelectivity(1 - nullRatio);
    if (!columnStats) return this.clampSelectivity(nonNullRatio * DEFAULT_EQUALITY_SELECTIVITY);

    if (tableRowCount > 0 && columnStats.histogram.length > 0) {
      for (const bucket of columnStats.histogram) {
        const geLower = this.compareByOp(literal, bucket.lowerBound, ">=");
        const leUpper = this.compareByOp(literal, bucket.upperBound, "<=");
        if (geLower !== "TRUE" || leUpper !== "TRUE") continue;

        const bucketRatio = this.clampSelectivity(bucket.rowCount / tableRowCount);
        if (bucket.ndv > 0) return this.clampSelectivity(bucketRatio / bucket.ndv);
        break;
      }
    }

    if (columnStats.ndv > 0) return this.clampSelectivity(nonNullRatio / columnStats.ndv);
    return this.clampSelectivity(nonNullRatio * DEFAULT_EQUALITY_SELECTIVITY);
  }

  private estimateLessThanSelectivity(
    tableRowCount: number,
    columnStats: OptimizerColumnStatistics | undefined,
    literal: SqlPrimitive,
    inclusive: boolean,
  ): number {
    if (literal === null || literal === undefined) return 0;

    const nullRatio = this.clampSelectivity(columnStats?.nullRatio ?? 0);
    const nonNullRatio = this.clampSelectivity(1 - nullRatio);
    if (!columnStats) return this.clampSelectivity(nonNullRatio * DEFAULT_RANGE_SELECTIVITY);
    if (tableRowCount <= 0 || columnStats.histogram.length === 0) {
      return this.clampSelectivity(nonNullRatio * DEFAULT_RANGE_SELECTIVITY);
    }

    let matchedRatio = 0;
    for (const bucket of columnStats.histogram) {
      const bucketRatio = this.clampSelectivity(bucket.rowCount / tableRowCount);
      const fullyMatched = this.compareByOp(bucket.upperBound, literal, inclusive ? "<=" : "<");
      if (fullyMatched === "TRUE") {
        matchedRatio += bucketRatio;
        continue;
      }

      const noMatch = this.compareByOp(bucket.lowerBound, literal, inclusive ? ">" : ">=");
      if (noMatch === "TRUE") continue;

      matchedRatio += bucketRatio * 0.5;
    }
    return this.clampSelectivity(Math.min(nonNullRatio, matchedRatio));
  }

  private estimateComparisonSelectivity(
    tableRowCount: number,
    columnStats: OptimizerColumnStatistics | undefined,
    op: ComparePredicate,
    literal: SqlPrimitive,
  ): number {
    const nullRatio = this.clampSelectivity(columnStats?.nullRatio ?? 0);
    const nonNullRatio = this.clampSelectivity(1 - nullRatio);

    if (literal === null || literal === undefined) return 0;

    switch (op) {
      case "=":
        return this.estimateEqualitySelectivity(tableRowCount, columnStats, literal);
      case "!=":
      case "<>": {
        const eq = this.estimateEqualitySelectivity(tableRowCount, columnStats, literal);
        return this.clampSelectivity(nonNullRatio - eq);
      }
      case "<":
        return this.estimateLessThanSelectivity(tableRowCount, columnStats, literal, false);
      case "<=":
        return this.estimateLessThanSelectivity(tableRowCount, columnStats, literal, true);
      case ">": {
        const le = this.estimateLessThanSelectivity(tableRowCount, columnStats, literal, true);
        return this.clampSelectivity(nonNullRatio - le);
      }
      case ">=": {
        const lt = this.estimateLessThanSelectivity(tableRowCount, columnStats, literal, false);
        return this.clampSelectivity(nonNullRatio - lt);
      }
      default:
        return this.clampSelectivity(DEFAULT_PREDICATE_SELECTIVITY);
    }
  }

  private estimateInListSelectivity(
    tableRowCount: number,
    columnStats: OptimizerColumnStatistics | undefined,
    literals: SqlPrimitive[],
    unresolvedValueCount = 0,
  ): number {
    const nullRatio = this.clampSelectivity(columnStats?.nullRatio ?? 0);
    const nonNullRatio = this.clampSelectivity(1 - nullRatio);
    if (literals.length === 0 && unresolvedValueCount <= 0) return 0;

    const unique = new Set<string>();
    let matched = 0;
    for (const literal of literals) {
      if (literal === null || literal === undefined) continue;
      const key = this.encodeTypedKey(literal, "optimizer.selectivity.in");
      if (unique.has(key)) continue;
      unique.add(key);
      matched += this.estimateEqualitySelectivity(tableRowCount, columnStats, literal);
    }
    if (unresolvedValueCount > 0) {
      matched += nonNullRatio * DEFAULT_EQUALITY_SELECTIVITY * unresolvedValueCount;
    }
    return this.clampSelectivity(Math.min(nonNullRatio, matched));
  }

  private estimateLikeSelectivity(
    tableRowCount: number,
    columnStats: OptimizerColumnStatistics | undefined,
    rawPattern: SqlPrimitive,
  ): number {
    if (rawPattern === null || rawPattern === undefined) return 0;

    const nullRatio = this.clampSelectivity(columnStats?.nullRatio ?? 0);
    const nonNullRatio = this.clampSelectivity(1 - nullRatio);
    const pattern = String(rawPattern);

    if (!pattern.includes("%") && !pattern.includes("_")) {
      return this.estimateEqualitySelectivity(tableRowCount, columnStats, pattern);
    }

    if (/^[^%_]+%$/.test(pattern)) return this.clampSelectivity(nonNullRatio * 0.1);
    if (/^%[^%_]+$/.test(pattern)) return this.clampSelectivity(nonNullRatio * 0.12);
    if (/^%[^%_]+%$/.test(pattern)) return this.clampSelectivity(nonNullRatio * 0.25);
    if (pattern.includes("_")) return this.clampSelectivity(nonNullRatio * 0.2);
    return this.clampSelectivity(nonNullRatio * DEFAULT_LIKE_SELECTIVITY);
  }

  private estimateClauseSelectivity(
    clause: WhereClause,
    tableRowCount: number,
    stats: OptimizerTableStatistics | undefined,
  ): number {
    const columnStats = this.resolveSelectivityColumnStats(stats, clause);
    const nullRatio = this.clampSelectivity(columnStats?.nullRatio ?? 0);
    const nonNullRatio = this.clampSelectivity(1 - nullRatio);

    switch (clause.op) {
      case "IS_NULL":
        return columnStats ? this.clampSelectivity(columnStats.nullRatio) : 0.1;
      case "IS_NOT_NULL":
        return columnStats ? nonNullRatio : 0.9;
      case "=":
      case "!=":
      case "<>":
      case ">":
      case "<":
      case ">=":
      case "<=": {
        const raw = clause.valueExprs?.[0];
        if (!raw) return this.clampSelectivity(DEFAULT_PREDICATE_SELECTIVITY);
        const parsedLiteral = this.parseSelectivityLiteral(raw);
        if (!parsedLiteral.parsed) return this.clampSelectivity(DEFAULT_PREDICATE_SELECTIVITY);
        return this.estimateComparisonSelectivity(
          tableRowCount,
          columnStats,
          clause.op as ComparePredicate,
          parsedLiteral.value as SqlPrimitive,
        );
      }
      case "BETWEEN":
      case "NOT_BETWEEN": {
        const lowerRaw = clause.valueExprs?.[0];
        const upperRaw = clause.valueExprs?.[1];
        if (!lowerRaw || !upperRaw) return this.clampSelectivity(DEFAULT_RANGE_SELECTIVITY * nonNullRatio);

        const lower = this.parseSelectivityLiteral(lowerRaw);
        const upper = this.parseSelectivityLiteral(upperRaw);
        if (!lower.parsed || !upper.parsed) return this.clampSelectivity(DEFAULT_RANGE_SELECTIVITY * nonNullRatio);
        if (lower.value === null || upper.value === null) return 0;
        const lowerValue = lower.value;
        const upperValue = upper.value;

        const invalidRange = this.compareByOp(lowerValue, upperValue, ">") === "TRUE";
        const between = invalidRange
          ? 0
          : this.clampSelectivity(
            this.estimateLessThanSelectivity(tableRowCount, columnStats, upperValue, true)
            - this.estimateLessThanSelectivity(tableRowCount, columnStats, lowerValue, false),
          );

        if (clause.op === "BETWEEN") return between;
        return this.clampSelectivity(nonNullRatio - between);
      }
      case "IN":
      case "NOT_IN": {
        const literals: SqlPrimitive[] = [];
        let unresolvedValueCount = 0;
        let hasNullLiteral = false;

        if (clause.valueExprs?.length) {
          for (const expr of clause.valueExprs) {
            const parsedLiteral = this.parseSelectivityLiteral(expr);
            if (!parsedLiteral.parsed) {
              unresolvedValueCount += 1;
              continue;
            }
            const literal = parsedLiteral.value as SqlPrimitive;
            literals.push(literal);
            if (literal === null) hasNullLiteral = true;
          }
        } else if (clause.values?.length) {
          for (const literal of clause.values) {
            const v = literal as SqlPrimitive;
            literals.push(v);
            if (v === null) hasNullLiteral = true;
          }
        }

        const inSelectivity = this.estimateInListSelectivity(tableRowCount, columnStats, literals, unresolvedValueCount);
        if (clause.op === "IN") return inSelectivity;
        if (hasNullLiteral) return 0;
        const base = this.clampSelectivity(nonNullRatio - inSelectivity);
        return unresolvedValueCount > 0 ? this.clampSelectivity(base * 0.5) : base;
      }
      case "LIKE":
      case "NOT_LIKE": {
        const patternRaw = clause.valueExprs?.[0];
        if (!patternRaw) return this.clampSelectivity(nonNullRatio * DEFAULT_LIKE_SELECTIVITY);
        const parsedPattern = this.parseSelectivityLiteral(patternRaw);
        if (!parsedPattern.parsed) return this.clampSelectivity(nonNullRatio * DEFAULT_LIKE_SELECTIVITY);
        const like = this.estimateLikeSelectivity(tableRowCount, columnStats, parsedPattern.value as SqlPrimitive);
        if (clause.op === "LIKE") return like;
        return this.clampSelectivity(nonNullRatio - like);
      }
      case "IS_DISTINCT_FROM":
      case "IS_NOT_DISTINCT_FROM": {
        const rightRaw = clause.valueExprs?.[0];
        if (!rightRaw) return this.clampSelectivity(DEFAULT_PREDICATE_SELECTIVITY);
        const parsedLiteral = this.parseSelectivityLiteral(rightRaw);
        if (!parsedLiteral.parsed) return this.clampSelectivity(DEFAULT_PREDICATE_SELECTIVITY);

        let isNotDistinct = 0;
        if (parsedLiteral.value === null || parsedLiteral.value === undefined) {
          isNotDistinct = columnStats ? this.clampSelectivity(columnStats.nullRatio) : 0.1;
        } else {
          isNotDistinct = this.estimateEqualitySelectivity(tableRowCount, columnStats, parsedLiteral.value as SqlPrimitive);
        }
        if (clause.op === "IS_NOT_DISTINCT_FROM") return isNotDistinct;
        return this.clampSelectivity(1 - isNotDistinct);
      }
      default:
        return this.clampSelectivity(DEFAULT_PREDICATE_SELECTIVITY);
    }
  }

  private estimateWhereTreeSelectivity(
    node: WhereExprNode,
    tableRowCount: number,
    stats: OptimizerTableStatistics | undefined,
  ): number {
    if (node.type === "clause") return this.estimateClauseSelectivity(node.clause, tableRowCount, stats);
    if (node.type === "not") return this.clampSelectivity(1 - this.estimateWhereTreeSelectivity(node.node, tableRowCount, stats));

    const left = this.estimateWhereTreeSelectivity(node.left, tableRowCount, stats);
    const right = this.estimateWhereTreeSelectivity(node.right, tableRowCount, stats);
    if (node.type === "and") return this.clampSelectivity(left * right);
    return this.clampSelectivity(left + right - left * right);
  }

  private estimateWhereClausesSelectivity(
    whereClauses: WhereClause[],
    tableRowCount: number,
    stats: OptimizerTableStatistics | undefined,
  ): number {
    let acc: number | null = null;
    for (const clause of whereClauses) {
      const clauseSelectivity = this.estimateClauseSelectivity(clause, tableRowCount, stats);
      if (acc === null) {
        acc = clauseSelectivity;
        continue;
      }
      if (clause.logic === "OR") {
        acc = this.clampSelectivity(acc + clauseSelectivity - acc * clauseSelectivity);
      } else {
        acc = this.clampSelectivity(acc * clauseSelectivity);
      }
    }
    return this.clampSelectivity(acc ?? 1);
  }

  private estimatePredicateSelectivity(
    parsed: Pick<ParsedSelect, "whereAst" | "whereTree" | "whereClauses">,
    stats: OptimizerTableStatistics | undefined,
    tableRowCount: number,
  ): number {
    const hasPredicate = Boolean(parsed.whereAst || parsed.whereTree || parsed.whereClauses.length > 0);
    if (!hasPredicate) return 1;
    if (parsed.whereTree) return this.estimateWhereTreeSelectivity(parsed.whereTree, tableRowCount, stats);
    if (parsed.whereClauses.length > 0) return this.estimateWhereClausesSelectivity(parsed.whereClauses, tableRowCount, stats);
    return this.clampSelectivity(DEFAULT_PREDICATE_SELECTIVITY);
  }

  private getPersistedOptimizerStatistics(table?: string, options?: OptimizerStatisticsReadOptions): OptimizerTableStatistics[] {
    const out: OptimizerTableStatistics[] = [];
    const resolvedTable = table ? this.resolveCanonicalOptimizerStatsTableName(table) : null;
    if (table && !resolvedTable) return out;
    if (options?.version !== undefined && !resolvedTable) return out;

    const tables = resolvedTable
      ? [resolvedTable]
      : [...this.optimizerStatsVersionObjects.keys()].sort((a, b) => a.localeCompare(b));

    for (const tableName of tables) {
      const picked = this.pickOptimizerStatsVersionObject(tableName, {
        visibility: options?.visibility,
        version: options?.version,
      });
      if (!picked) continue;
      out.push(this.cloneOptimizerTableStatistics(picked.statistics));
    }
    return out;
  }

  getOptimizerStatistics(table?: string, options?: OptimizerStatisticsReadOptions): OptimizerTableStatistics[] {
    const source = options?.source ?? "live";
    if (source === "versioned") return this.getPersistedOptimizerStatistics(table, options);

    const out: OptimizerTableStatistics[] = [];
    const resolvedTable = table ? this.resolveCanonicalTableName(table) : null;
    if (table && !resolvedTable) return out;

    const tables = resolvedTable ? [resolvedTable] : [...this.schemas.keys()].sort((a, b) => a.localeCompare(b));
    for (const tableName of tables) {
      const stats = this.collectOptimizerStatisticsForTable(tableName);
      if (stats) out.push(stats);
    }
    return out;
  }

  replayOptimizerStatistics(
    table: string,
    options?: { visibility?: "pending" | "confirmed"; version?: number },
  ): OptimizerTableStatistics | null {
    return this.getOptimizerStatistics(table, {
      source: "versioned",
      visibility: options?.visibility,
      version: options?.version,
    })[0] ?? null;
  }

  compareOptimizerStatisticsVersions(
    table: string,
    fromVersion: number,
    toVersion: number,
  ): OptimizerStatisticsVersionDiff | null {
    if (!Number.isInteger(fromVersion) || !Number.isInteger(toVersion)) return null;
    if (fromVersion <= 0 || toVersion <= 0) return null;

    const canonical = this.resolveCanonicalOptimizerStatsTableName(table);
    if (!canonical) return null;

    const history = this.optimizerStatsVersionObjects.get(canonical) ?? [];
    const from = history.find((object) => object.currentVersion === fromVersion);
    const to = history.find((object) => object.currentVersion === toVersion);
    if (!from || !to) return null;

    const fromColumns = new Map<string, OptimizerColumnStatistics>();
    const toColumns = new Map<string, OptimizerColumnStatistics>();
    for (const column of from.statistics.columns) fromColumns.set(column.column.toUpperCase(), column);
    for (const column of to.statistics.columns) toColumns.set(column.column.toUpperCase(), column);

    const allColumnNames = [...new Set([...fromColumns.keys(), ...toColumns.keys()])].sort((a, b) => a.localeCompare(b));
    const addedColumns: string[] = [];
    const removedColumns: string[] = [];
    const changedColumns: OptimizerStatisticsVersionDiffColumn[] = [];

    for (const name of allColumnNames) {
      const fromColumn = fromColumns.get(name);
      const toColumn = toColumns.get(name);

      if (!fromColumn && toColumn) {
        addedColumns.push(toColumn.column);
        continue;
      }
      if (fromColumn && !toColumn) {
        removedColumns.push(fromColumn.column);
        continue;
      }
      if (!fromColumn || !toColumn) continue;

      const fromHistogramRowCount = fromColumn.histogram.reduce((sum, bucket) => sum + bucket.rowCount, 0);
      const toHistogramRowCount = toColumn.histogram.reduce((sum, bucket) => sum + bucket.rowCount, 0);
      const fromHistogramNdv = fromColumn.histogram.reduce((sum, bucket) => sum + bucket.ndv, 0);
      const toHistogramNdv = toColumn.histogram.reduce((sum, bucket) => sum + bucket.ndv, 0);

      const change: OptimizerStatisticsVersionDiffColumn = {
        column: toColumn.column,
        rowCountDelta: toColumn.rowCount - fromColumn.rowCount,
        ndvDelta: toColumn.ndv - fromColumn.ndv,
        nullCountDelta: toColumn.nullCount - fromColumn.nullCount,
        nullRatioDelta: toColumn.nullRatio - fromColumn.nullRatio,
        histogramBucketDelta: toColumn.histogram.length - fromColumn.histogram.length,
        histogramRowCountDelta: toHistogramRowCount - fromHistogramRowCount,
        histogramNdvDelta: toHistogramNdv - fromHistogramNdv,
      };

      if (
        change.rowCountDelta !== 0
        || change.ndvDelta !== 0
        || change.nullCountDelta !== 0
        || change.nullRatioDelta !== 0
        || change.histogramBucketDelta !== 0
        || change.histogramRowCountDelta !== 0
        || change.histogramNdvDelta !== 0
      ) {
        changedColumns.push(change);
      }
    }

    addedColumns.sort((a, b) => a.localeCompare(b));
    removedColumns.sort((a, b) => a.localeCompare(b));
    changedColumns.sort((a, b) => a.column.localeCompare(b.column));

    return {
      table: canonical,
      fromVersion,
      toVersion,
      rowCountDelta: to.statistics.rowCount - from.statistics.rowCount,
      analyzedAtDeltaMs: to.analyzedAt - from.analyzedAt,
      addedColumns,
      removedColumns,
      changedColumns,
    };
  }

  getSelectPlanStability(sql?: string): Array<{
    key: string;
    preferredMethod: PhysicalAccessPathMethod;
    preferredIndexName?: string;
    preferredIndexColumn?: string;
    badPlanFallbackRemaining: number;
    badPlanFallbackCount: number;
    stablePinCount: number;
    planSwitchCount: number;
    executions: number;
    lastReason: PlanStabilityReason | "BAD_PLAN_TRIGGER";
  }> {
    const target = sql ? sql.trim().replace(/\s+/g, " ") : undefined;
    const out: Array<{
      key: string;
      preferredMethod: PhysicalAccessPathMethod;
      preferredIndexName?: string;
      preferredIndexColumn?: string;
      badPlanFallbackRemaining: number;
      badPlanFallbackCount: number;
      stablePinCount: number;
      planSwitchCount: number;
      executions: number;
      lastReason: PlanStabilityReason | "BAD_PLAN_TRIGGER";
    }> = [];

    for (const [key, state] of this.selectPlanStability.entries()) {
      if (target && key !== target) continue;
      out.push({
        key,
        preferredMethod: state.preferredMethod,
        preferredIndexName: state.preferredIndexName,
        preferredIndexColumn: state.preferredIndexColumn,
        badPlanFallbackRemaining: state.badPlanFallbackRemaining,
        badPlanFallbackCount: state.badPlanFallbackCount,
        stablePinCount: state.stablePinCount,
        planSwitchCount: state.planSwitchCount,
        executions: state.executions,
        lastReason: state.lastReason,
      });
    }
    out.sort((a, b) => a.key.localeCompare(b.key));
    return out;
  }

  getSubqueryExecutionStats(subquerySql?: string): Array<{
    key: string;
    executions: number;
    correlatedExecutions: number;
    cacheHits: number;
    cacheMisses: number;
    rowsScanned: number;
    rowsReturned: number;
    budgetExceededCount: number;
  }> {
    const target = subquerySql?.trim().replace(/\s+/g, " ");
    const out: Array<{
      key: string;
      executions: number;
      correlatedExecutions: number;
      cacheHits: number;
      cacheMisses: number;
      rowsScanned: number;
      rowsReturned: number;
      budgetExceededCount: number;
    }> = [];

    for (const [key, stats] of this.subqueryExecutionStats.entries()) {
      if (target && key !== target) continue;
      out.push({
        key,
        executions: stats.executions,
        correlatedExecutions: stats.correlatedExecutions,
        cacheHits: stats.cacheHits,
        cacheMisses: stats.cacheMisses,
        rowsScanned: stats.rowsScanned,
        rowsReturned: stats.rowsReturned,
        budgetExceededCount: stats.budgetExceededCount,
      });
    }
    out.sort((a, b) => a.key.localeCompare(b.key));
    return out;
  }

  private buildSelectExecutionPlan(
    parsed: ParsedSelect,
    bucket: SqlRow[],
    opts?: { refreshIndexes?: boolean; trackLookupStats?: boolean; stabilityKey?: string },
  ): SelectExecutionPlan {
    const logicalPlan = this.buildLogicalSelectPlan(parsed);
    const canUseSingleTableIndexes = logicalPlan.joins.length === 0;
    const optimizerStats = this.getOptimizerStatistics(parsed.table)[0];
    const tableRowCount = optimizerStats?.rowCount ?? bucket.length;
    const hasPredicate = Boolean(parsed.whereAst || parsed.whereTree || parsed.whereClauses.length > 0);
    const predicateSelectivity = this.estimatePredicateSelectivity(parsed, optimizerStats, tableRowCount);
    const estimatedFilteredRows = hasPredicate
      ? Math.max(0, Math.min(tableRowCount, Math.ceil(tableRowCount * predicateSelectivity)))
      : tableRowCount;

    if (canUseSingleTableIndexes && (opts?.refreshIndexes ?? true)) {
      this.rebuildSecondaryIndexesForTable(parsed.table);
    }

    const candidates: PhysicalSelectRuntimePath[] = [];
    const addCandidate = (
      method: PhysicalAccessPathMethod,
      rows: SqlRow[],
      orderSatisfied: boolean,
      indexName?: string,
      indexColumn?: string,
      indexStrategy?: PhysicalIndexAccessStrategy,
    ): void => {
      const resolvedIndexStrategy = indexStrategy ?? this.resolvePhysicalIndexAccessStrategy(parsed, method, indexColumn);
      const scannedRows = method === "TABLE_SCAN" ? tableRowCount : rows.length;
      const estimatedRows = hasPredicate ? Math.min(scannedRows, estimatedFilteredRows) : scannedRows;
      const estimatedCost = this.estimatePhysicalAccessPathCost(
        parsed,
        tableRowCount,
        method,
        scannedRows,
        estimatedRows,
        orderSatisfied,
        resolvedIndexStrategy,
      );
      candidates.push({
        method,
        indexStrategy: resolvedIndexStrategy,
        rows,
        orderSatisfied,
        indexName,
        indexColumn,
        estimatedRows,
        estimatedCost,
      });
    };

    addCandidate("TABLE_SCAN", bucket, false, undefined, undefined, "FULL_TABLE_SCAN");

    if (canUseSingleTableIndexes) {
      const ordered = this.getBtreeOrderedScanCandidates(
        parsed.table,
        bucket,
        {
          orderByList: logicalPlan.orderByList,
          whereClauses: parsed.whereClauses,
          groupBy: logicalPlan.groupBy,
          aggregate: logicalPlan.aggregate,
          rowNumberAlias: logicalPlan.rowNumberAlias,
          having: logicalPlan.having,
        },
        false,
      );
      if (ordered) {
        addCandidate("BTREE_ORDERED_SCAN", ordered.rows, ordered.orderSatisfied, ordered.indexName, ordered.column);
      }

      if (parsed.whereClauses.length > 0) {
        const hash = this.getHashIndexedCandidates(parsed.table, parsed.whereClauses, false);
        if (hash) addCandidate("HASH_INDEX_LOOKUP", hash.rows, false, hash.indexName, hash.column);

        const btree = this.getBtreeIndexedCandidates(parsed.table, parsed.whereClauses, false);
        if (btree) addCandidate("BTREE_INDEX_LOOKUP", btree.rows, false, btree.indexName, btree.column);
      }
    }

    const optimizerChosen = this.pickBestPhysicalAccessPath(candidates);
    const stabilized = this.applySelectPlanStabilityPolicy(opts?.stabilityKey, optimizerChosen, candidates);
    const chosenRuntime = stabilized.chosen;
    if ((opts?.trackLookupStats ?? true) && chosenRuntime.method !== "TABLE_SCAN") {
      this.bumpIndexLookupStats(parsed.table, chosenRuntime.rows.length > 0);
    }

    const toPhysicalPath = (candidate: PhysicalSelectRuntimePath): PhysicalSelectAccessPath => ({
      method: candidate.method,
      indexStrategy: candidate.indexStrategy,
      estimatedCost: candidate.estimatedCost,
      estimatedRows: candidate.estimatedRows,
      orderSatisfied: candidate.orderSatisfied,
      indexName: candidate.indexName,
      indexColumn: candidate.indexColumn,
    });

    const joinAlgorithms = this.buildPhysicalJoinPlan(chosenRuntime.rows.length, logicalPlan.joins);

    return {
      logical: logicalPlan,
      physical: {
        optimizerChosen: toPhysicalPath(optimizerChosen),
        chosen: toPhysicalPath(chosenRuntime),
        candidates: candidates.map((candidate) => toPhysicalPath(candidate)),
        joinAlgorithms,
        stabilityReason: stabilized.reason,
        stabilityPinned: stabilized.reason !== "NONE",
      },
      scannedRows: chosenRuntime.rows,
      orderSatisfied: chosenRuntime.orderSatisfied,
    };
  }

  private formatPhysicalCandidates(candidates: PhysicalSelectAccessPath[]): string {
    return candidates
      .map((candidate) => {
        const parts = [
          `cost=${candidate.estimatedCost}`,
          `rows=${candidate.estimatedRows}`,
          `order=${candidate.orderSatisfied ? "Y" : "N"}`,
          `access=${candidate.indexStrategy}`,
        ];
        if (candidate.indexName) parts.push(`index=${candidate.indexName}`);
        if (candidate.indexColumn) parts.push(`column=${candidate.indexColumn}`);
        return `${candidate.method}[${parts.join(",")}]`;
      })
      .join(" ; ");
  }

  async query(sql: string): Promise<QueryResult> {
    const normalized = normalizeSql(sql);
    this.logger.debug("query start", {
      sql: normalized,
      mode: this.opts.mode ?? "simulator",
      transactionState: this.transactionState,
    });
    try {
      this.assertTransactionNotTimedOut(normalized);
      this.assertStatementAllowedDuringTransaction(normalized);
      const normalizedSql = sql.trim().replace(/\s+/g, " ");
      const cachedRows = this.getCachedQuery(normalizedSql);
      if (cachedRows) return { rows: cachedRows };

      this.enterSubqueryRuntimeScope();
      try {
        const ast = parseSqlToAst(sql, { dialect: this.opts.dialect ?? "ansi" });

        if (ast.kind === "union" || ast.kind === "intersect" || ast.kind === "except") {
          const setOpToken = ast.kind === "union" ? "UNION" : ast.kind === "intersect" ? "INTERSECT" : "EXCEPT";
          const rightPlan = this.splitSelectTail(ast.rightSql, setOpToken);

          const left = await this.query(ast.leftSql);
          const right = await this.query(rightPlan.baseSql);

          const leftStaticArity = this.inferSetOpArity(ast.leftSql);
          const rightStaticArity = this.inferSetOpArity(rightPlan.baseSql);
          const leftRuntimeColumns = this.inferRuntimeProjectionColumns(left.rows);
          const rightRuntimeColumns = this.inferRuntimeProjectionColumns(right.rows);
          const leftArity = leftRuntimeColumns?.length ?? leftStaticArity;
          const rightArity = rightRuntimeColumns?.length ?? rightStaticArity;
          this.assertSetOpArityCompatible(leftArity, rightArity, setOpToken);

          const leftColumns =
            leftRuntimeColumns
            ?? this.inferSetOpColumns(ast.leftSql)
            ?? rightRuntimeColumns
            ?? this.inferSetOpColumns(rightPlan.baseSql);

          const normalizedLeft =
            leftColumns ? left.rows.map((row) => this.normalizeSetOpRow(row, leftColumns, setOpToken)) : left.rows;
          const normalizedRight =
            leftColumns ? right.rows.map((row) => this.normalizeSetOpRow(row, leftColumns, setOpToken)) : right.rows;

          const merged = ast.kind === "union"
            ? this.combineUnionRows(normalizedLeft, normalizedRight, ast.all)
            : ast.kind === "intersect"
              ? this.combineIntersectRows(normalizedLeft, normalizedRight, ast.all)
              : this.combineExceptRows(normalizedLeft, normalizedRight, ast.all);

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

    const parsed = this.parseSelect(normalizedSql, sql);
    const planStabilityKey = parsed.explain ? normalizedSql.replace(/^EXPLAIN\s+/i, "").trim() : normalizedSql;
    const materializedViewSources = await this.materializeSelectViewSources(parsed);
    try {
      if (parsed.explain) {
        const explainBucket = this.tables.get(parsed.table) ?? [];
        const explainPlan = this.buildSelectExecutionPlan(parsed, explainBucket, {
          refreshIndexes: false,
          trackLookupStats: false,
          stabilityKey: planStabilityKey,
        });
        const explainStability = this.getSelectPlanStability(planStabilityKey)[0];
        const explainStats = this.getOptimizerStatistics(parsed.table)[0];
        const predicateStats = this.pickPredicateColumnStats(explainStats, parsed.whereClauses);
        const hasPredicate = Boolean(parsed.whereAst || parsed.whereTree || parsed.whereClauses.length > 0);
        const explainTableRows = explainStats?.rowCount ?? explainBucket.length;
        const predicateSelectivity = hasPredicate
          ? this.estimatePredicateSelectivity(parsed, explainStats, explainTableRows)
          : 1;
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
            logicalRewriteRules: explainPlan.logical.rewriteRules.length ? explainPlan.logical.rewriteRules.join(",") : null,
            logicalPredicateSource: explainPlan.logical.predicateSource,
            logicalJoinCount: explainPlan.logical.joins.length,
            logicalJoinReorderApplied: explainPlan.logical.joinReorder.applied,
            logicalJoinReorderAlgorithm: explainPlan.logical.joinReorder.algorithm,
            logicalJoinReorderCost: explainPlan.logical.joinReorder.estimatedCost,
            logicalJoinOrderOriginal: explainPlan.logical.joinReorder.originalJoinOrder.length
              ? explainPlan.logical.joinReorder.originalJoinOrder.join(" -> ")
              : null,
            logicalJoinOrderFinal: explainPlan.logical.joinReorder.finalJoinOrder.length
              ? explainPlan.logical.joinReorder.finalJoinOrder.join(" -> ")
              : null,
            physicalJoinCount: explainPlan.physical.joinAlgorithms.length,
            physicalJoinAlgorithms: explainPlan.physical.joinAlgorithms.length
              ? explainPlan.physical.joinAlgorithms.map((step) => step.algorithm).join(" -> ")
              : null,
            physicalJoinPlan: explainPlan.physical.joinAlgorithms.length
              ? explainPlan.physical.joinAlgorithms
                .map((step, idx) =>
                  `#${idx + 1}:${step.algorithm}[left=${step.leftRows},right=${step.rightRows},out=${step.estimatedOutputRows},cost=${step.estimatedCost}]`)
                .join(" ; ")
              : null,
            physicalOptimizerAccessPath: explainPlan.physical.optimizerChosen.method,
            physicalOptimizerIndexStrategy: explainPlan.physical.optimizerChosen.indexStrategy,
            physicalOptimizerCost: explainPlan.physical.optimizerChosen.estimatedCost,
            physicalOptimizerEstimatedRows: explainPlan.physical.optimizerChosen.estimatedRows,
            physicalAccessPath: explainPlan.physical.chosen.method,
            physicalIndexStrategy: explainPlan.physical.chosen.indexStrategy,
            physicalCost: explainPlan.physical.chosen.estimatedCost,
            physicalEstimatedRows: explainPlan.physical.chosen.estimatedRows,
            physicalOrderSatisfied: explainPlan.physical.chosen.orderSatisfied,
            physicalStabilityReason: explainPlan.physical.stabilityReason,
            physicalStabilityPinned: explainPlan.physical.stabilityPinned,
            physicalBadPlanFallbackRemaining: explainStability?.badPlanFallbackRemaining ?? 0,
            physicalBadPlanFallbackCount: explainStability?.badPlanFallbackCount ?? 0,
            physicalStablePinCount: explainStability?.stablePinCount ?? 0,
            physicalPlanSwitchCount: explainStability?.planSwitchCount ?? 0,
            physicalPlanExecutions: explainStability?.executions ?? 0,
            physicalCandidates: this.formatPhysicalCandidates(explainPlan.physical.candidates),
            statsAnalyzedAt: explainStats?.analyzedAt ?? null,
            statsTableRowCount: explainTableRows,
            statsColumnCount: explainStats?.columns.length ?? 0,
            statsPredicateColumn: predicateStats?.column ?? null,
            statsPredicateNdv: predicateStats?.ndv ?? null,
            statsPredicateNullRatio: predicateStats?.nullRatio ?? null,
            statsPredicateHistogramBuckets: predicateStats?.histogram.length ?? null,
            statsPredicateSelectivity: hasPredicate ? predicateSelectivity : null,
            statsPredicateEstimatedRows: hasPredicate ? Math.ceil(explainTableRows * predicateSelectivity) : null,
          },
        ]);
      }

      if ((this.opts.mode ?? "simulator") === "onchain" && this.opts.onchainQueryExecutor && materializedViewSources.length === 0) {
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
      const selectPlan = this.buildSelectExecutionPlan(parsed, bucket, {
        refreshIndexes: true,
        trackLookupStats: true,
        stabilityKey: planStabilityKey,
      });

      const logicalPlan = selectPlan.logical;
      const baseRows = logicalPlan.joins.length
        ? logicalPlan.joins.reduce(
            (acc, joinStep, idx) => this.applyJoin(
              idx === 0 ? logicalPlan.table : logicalPlan.joins[idx - 1]!.table,
              acc,
              joinStep,
              selectPlan.physical.joinAlgorithms[idx]?.algorithm ?? "NESTED_LOOP",
            ),
            selectPlan.scannedRows,
          )
        : selectPlan.scannedRows;

      const filtered = logicalPlan.predicateSource === "AST" && parsed.whereAst
        ? baseRows.filter((row) => this.evaluateWhereAst(row, parsed.whereAst!, parsed.where) === "TRUE")
        : logicalPlan.predicateSource === "TREE" && parsed.whereTree
        ? baseRows.filter((row) => this.evaluateWhereTree(row, parsed.whereTree!) === "TRUE")
        : logicalPlan.predicateSource === "CLAUSES" && parsed.whereClauses.length
        ? this.applyWhereClauses(baseRows, parsed.whereClauses)
        : baseRows;

      if (logicalPlan.groupBy?.length) {
        const grouped = this.groupRows(filtered, logicalPlan.groupBy, logicalPlan.aggregate, logicalPlan.aggregateField);
        const havingRows = parsed.havingAst
          ? grouped.filter((row) => this.evaluateWhereAst(row, parsed.havingAst!, parsed.having) === "TRUE")
          : logicalPlan.having
          ? grouped.filter((row) => this.evaluateWhereTree(row, this.parseWhereTree(logicalPlan.having!)) === "TRUE")
          : grouped;
        const orderedGrouped = this.applyOrder(havingRows, logicalPlan.orderByList);
        const pagedGrouped = this.applyPage(orderedGrouped, logicalPlan.offset, logicalPlan.limit);
        const groupedResult = this.buildQueryResult(
          normalizedSql,
          pagedGrouped.map((row) => this.pickFields(row, logicalPlan.fields)),
        );
        this.recordSelectPlanFeedback(planStabilityKey, parsed, selectPlan, groupedResult.rows.length, bucket.length);
        return groupedResult;
      }

      if (logicalPlan.aggregate) {
        const aggregateResult = this.buildQueryResult(normalizedSql, [
          this.computeAggregateRow(filtered, logicalPlan.aggregate, logicalPlan.aggregateField),
        ]);
        this.recordSelectPlanFeedback(planStabilityKey, parsed, selectPlan, aggregateResult.rows.length, bucket.length);
        return aggregateResult;
      }

      const withWindow = logicalPlan.rowNumberAlias
        ? this.applyRowNumber(filtered, logicalPlan.rowNumberAlias, logicalPlan.rowNumberSpec)
        : filtered;
      const ordered = selectPlan.orderSatisfied ? withWindow : this.applyOrder(withWindow, logicalPlan.orderByList);
      const paged = this.applyPage(ordered, logicalPlan.offset, logicalPlan.limit);

      const result = this.buildQueryResult(
        normalizedSql,
        paged.map((row) => this.pickFields(row, logicalPlan.fields)),
      );
      this.recordSelectPlanFeedback(planStabilityKey, parsed, selectPlan, result.rows.length, bucket.length);
      const successMeta: Record<string, unknown> = {
        sql: normalized,
        rows: result.rows.length,
      };
      if (this.logger.level === "debug" && result.rows[0]) {
        successMeta.firstRowTyped = this.toTypedLogRow(result.rows[0], "debug.query.firstRow");
      }
      this.logger.debug("query success", successMeta);
      return result;
    } finally {
      this.cleanupMaterializedSelectViewSources(materializedViewSources);
    }
      } finally {
        this.leaveSubqueryRuntimeScope();
      }
    } catch (err) {
      this.transitionTransactionToAbortedOnError(normalized);
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

  private getStagedTableWriteSet(table: string): TransactionTableWriteSet | null {
    return this.transactionWriteSet?.tables.get(table) ?? null;
  }

  private getOrCreateTableWriteSet(table: string): TransactionTableWriteSet {
    const staged = this.getStagedTableWriteSet(table);
    if (staged) return staged;
    const source = this.tables.get(table);
    if (!source) throw sqlError("ERR_TABLE_NOT_FOUND", table);

    const rows = this.deepCloneRows(source);
    const uniqueIndexes = this.buildUniqueIndexSnapshot(table, rows);
    const created: TransactionTableWriteSet = {
      rows,
      uniqueIndexes,
      stats: { insertRows: 0, updateRows: 0, deleteRows: 0 },
    };
    if (!this.transactionWriteSet) this.transactionWriteSet = this.createEmptyTransactionWriteSet();
    this.transactionWriteSet.tables.set(table, created);
    return created;
  }

  private bumpTableWriteStats(table: string, patch: Partial<TransactionTableWriteStats>): void {
    const staged = this.getStagedTableWriteSet(table);
    if (!staged) return;
    staged.stats.insertRows += patch.insertRows ?? 0;
    staged.stats.updateRows += patch.updateRows ?? 0;
    staged.stats.deleteRows += patch.deleteRows ?? 0;
  }

  private isDmlWriteStagingActive(): boolean {
    return this.isSimulatorMode() && this.transactionState === "active";
  }

  private requireWritableTableForDml(name: string): SqlRow[] {
    if (!this.isDmlWriteStagingActive()) return this.requireTable(name);
    return this.getOrCreateTableWriteSet(name).rows;
  }

  private setTableRows(table: string, rows: SqlRow[]): void {
    const staged = this.getStagedTableWriteSet(table);
    if (staged) {
      staged.rows = rows;
      return;
    }
    this.tables.set(table, rows);
  }

  private getUniqueIndexesForTable(table: string): Map<string, Map<string, SqlRow>> | undefined {
    const staged = this.getStagedTableWriteSet(table);
    if (staged) return staged.uniqueIndexes;
    return this.uniqueIndexes.get(table);
  }

  private setUniqueIndexesForTable(table: string, indexes: Map<string, Map<string, SqlRow>>): void {
    const staged = this.getStagedTableWriteSet(table);
    if (staged) {
      staged.uniqueIndexes = indexes;
      return;
    }
    this.uniqueIndexes.set(table, indexes);
  }

  private buildUniqueIndexSnapshot(table: string, rows: SqlRow[]): Map<string, Map<string, SqlRow>> {
    const schema = this.schemas.get(table);
    const out = new Map<string, Map<string, SqlRow>>();
    if (!schema) return out;

    for (const group of this.getUniqueGroups(table, schema)) {
      const keyName = this.uniqueGroupName(group);
      const groupIndex = new Map<string, SqlRow>();
      for (const row of rows) {
        const keyVal = this.uniqueGroupValue(row, group);
        if (keyVal === null) continue;
        groupIndex.set(keyVal, row);
      }
      out.set(keyName, groupIndex);
    }
    return out;
  }

  private createReadCommittedView(): ReadCommittedView {
    return {
      isolationLevel: this.isolationLevel,
      getTableRows: (name: string) => {
        const staged = this.getStagedTableWriteSet(name);
        if (staged) return staged.rows;
        const table = this.tables.get(name);
        if (!table) throw sqlError("ERR_TABLE_NOT_FOUND", name);
        return table;
      },
    };
  }

  private requireTable(name: string): SqlRow[] {
    return this.createReadCommittedView().getTableRows(name);
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

  private parseDefaultLiteral(rawConstraints: string, sourceContext: string): { hasDefault: boolean; typedValue?: SqlTypedValue } {
    const m = /\bDEFAULT\b/i.exec(rawConstraints);
    if (!m) return { hasDefault: false };

    let i = m.index + m[0].length;
    while (i < rawConstraints.length && /\s/.test(rawConstraints[i]!)) i++;
    if (i >= rawConstraints.length) {
      throw sqlError("ERR_UNSUPPORTED_DDL", `DEFAULT requires a literal: ${rawConstraints}`);
    }

    let literal = "";
    const first = rawConstraints[i]!;
    if (first === "'" || first === "\"") {
      const quote = first;
      literal += quote;
      i++;
      let closed = false;
      while (i < rawConstraints.length) {
        const ch = rawConstraints[i]!;
        literal += ch;
        i++;
        if (ch === quote) {
          closed = true;
          break;
        }
      }
      if (!closed) {
        throw sqlError("ERR_UNSUPPORTED_DDL", `unterminated DEFAULT literal: ${rawConstraints}`);
      }
    } else {
      while (i < rawConstraints.length && !/\s/.test(rawConstraints[i]!)) {
        literal += rawConstraints[i]!;
        i++;
      }
    }

    const tail = rawConstraints.slice(i).trim();
    if (tail.length > 0) {
      const normalizedTail = tail.toUpperCase();
      const stripped = normalizedTail
        .replace(/\bNOT\s+NULL\b/g, "")
        .replace(/\bPRIMARY\s+KEY\b/g, "")
        .replace(/\bUNIQUE\b/g, "")
        .trim();
      if (stripped.length > 0) {
        throw sqlError("ERR_UNSUPPORTED_DDL", `unsupported DEFAULT clause tail: ${rawConstraints}`);
      }
    }

    return {
      hasDefault: true,
      typedValue: fromLiteral(this.castValue(literal), undefined, {}, sourceContext),
    };
  }

  private parseSqlTypeSpec(rawType: string): ColumnTypeSpec {
    const t = rawType.trim().toUpperCase();
    const m = t.match(/^([A-Z]+)(?:\((.+)\))?$/);
    if (!m) throw sqlError("ERR_UNSUPPORTED_TYPE", rawType);

    const normalizedName = normalizeRuntimeTypeName(m[1]!);
    if (!normalizedName || normalizedName === "NULL") throw sqlError("ERR_UNSUPPORTED_TYPE", rawType);
    const name = normalizedName as SqlTypeName;

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

  private parseForeignKeyReferenceClause(
    referenceClause: string,
    sourceDefinition: string,
  ): Pick<ForeignKeySpec, "refTable" | "refColumns" | "matchRule" | "onDelete" | "onUpdate"> {
    const refMatch = referenceClause.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\((.+)\)\s*(.*)$/i);
    if (!refMatch) throw sqlError("ERR_UNSUPPORTED_DDL", `invalid FOREIGN KEY definition: ${sourceDefinition}`);

    const refTable = refMatch[1]!.trim();
    const refColumns = this.splitTopLevelComma(refMatch[2]!).map((x) => x.trim()).filter((x) => x.length > 0);
    if (!refColumns.length) throw sqlError("ERR_UNSUPPORTED_DDL", `invalid FOREIGN KEY definition: ${sourceDefinition}`);

    let tail = refMatch[3]!.trim();
    let matchRule: ForeignKeySpec["matchRule"] = "SIMPLE";
    let onDelete: ForeignKeySpec["onDelete"] = "NO ACTION";
    let onUpdate: ForeignKeySpec["onUpdate"] = "NO ACTION";
    const seen = new Set<"MATCH" | "ON_DELETE" | "ON_UPDATE">();

    while (tail.length > 0) {
      const matchRuleMatch = tail.match(/^MATCH\s+(SIMPLE|FULL|PARTIAL)\b(.*)$/i);
      if (matchRuleMatch) {
        if (seen.has("MATCH")) throw sqlError("ERR_UNSUPPORTED_DDL", `duplicate MATCH clause: ${sourceDefinition}`);
        seen.add("MATCH");
        matchRule = matchRuleMatch[1]!.trim().toUpperCase() as ForeignKeySpec["matchRule"];
        tail = matchRuleMatch[2]!.trim();
        continue;
      }

      const deleteMatch = tail.match(/^ON\s+DELETE\s+(NO\s+ACTION|RESTRICT|CASCADE|SET\s+NULL|SET\s+DEFAULT)\b(.*)$/i);
      if (deleteMatch) {
        if (seen.has("ON_DELETE")) throw sqlError("ERR_UNSUPPORTED_DDL", `duplicate ON DELETE clause: ${sourceDefinition}`);
        seen.add("ON_DELETE");
        onDelete = deleteMatch[1]!.trim().toUpperCase().replace(/\s+/g, " ") as ForeignKeySpec["onDelete"];
        tail = deleteMatch[2]!.trim();
        continue;
      }

      const updateMatch = tail.match(/^ON\s+UPDATE\s+(NO\s+ACTION|RESTRICT|CASCADE|SET\s+NULL|SET\s+DEFAULT)\b(.*)$/i);
      if (updateMatch) {
        if (seen.has("ON_UPDATE")) throw sqlError("ERR_UNSUPPORTED_DDL", `duplicate ON UPDATE clause: ${sourceDefinition}`);
        seen.add("ON_UPDATE");
        onUpdate = updateMatch[1]!.trim().toUpperCase().replace(/\s+/g, " ") as ForeignKeySpec["onUpdate"];
        tail = updateMatch[2]!.trim();
        continue;
      }

      throw sqlError("ERR_UNSUPPORTED_DDL", `invalid FOREIGN KEY definition: ${sourceDefinition}`);
    }

    return { refTable, refColumns, matchRule, onDelete, onUpdate };
  }

  private assertNoCascadeCycle(newSchema: TableSchema): void {
    const graph = new Map<string, Set<string>>();
    const ensureNode = (table: string): Set<string> => {
      let targets = graph.get(table);
      if (!targets) {
        targets = new Set<string>();
        graph.set(table, targets);
      }
      return targets;
    };
    const attachSchema = (schema: TableSchema): void => {
      ensureNode(schema.name);
      for (const fk of schema.foreignKeys ?? []) {
        if (fk.onDelete !== "CASCADE" && fk.onUpdate !== "CASCADE") continue;
        ensureNode(fk.refTable).add(schema.name);
      }
    };

    for (const schema of this.schemas.values()) attachSchema(schema);
    attachSchema(newSchema);

    const visited = new Set<string>();
    const inPath = new Set<string>();
    const visit = (table: string): boolean => {
      if (inPath.has(table)) return true;
      if (visited.has(table)) return false;
      visited.add(table);
      inPath.add(table);
      for (const next of graph.get(table) ?? []) {
        if (visit(next)) return true;
      }
      inPath.delete(table);
      return false;
    };

    for (const table of graph.keys()) {
      if (visit(table)) {
        throw constraintError(
          "FOREIGN_KEY",
          `cascade cycle detected in FK graph while creating ${newSchema.name}`,
          {
            clause: "FOREIGN KEY",
            field: newSchema.name,
          },
        );
      }
    }
  }

  private parseCreateTableSchema(sql: string): TableSchema {
    const m = sql.match(/^CREATE TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\((.+)\)\s*$/i);
    if (!m) throw sqlError("ERR_UNSUPPORTED_DDL", sql);
    const table = m[1]!;
    const defs = this.splitTopLevelComma(m[2]!);
    if (defs.length === 0) throw sqlError("ERR_UNSUPPORTED_DDL", `CREATE TABLE has no columns: ${sql}`);

    const columns: ColumnSchema[] = [];
    const tableUniqueGroups: string[][] = [];
    const foreignKeys: ForeignKeySpec[] = [];
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

      const fkMatch = d.match(/^FOREIGN\s+KEY\s*\((.+)\)\s+REFERENCES\s+(.+)$/i);
      if (fkMatch) {
        const cols = this.splitTopLevelComma(fkMatch[1]!).map((x) => x.trim());
        const refSpec = this.parseForeignKeyReferenceClause(fkMatch[2]!, d);
        const refCols = refSpec.refColumns;
        if (!cols.length || !refCols.length || cols.length !== refCols.length) {
          throw sqlError("ERR_UNSUPPORTED_DDL", `invalid FOREIGN KEY definition: ${d}`);
        }
        foreignKeys.push({
          columns: cols,
          ...refSpec,
        });
        continue;
      }

      const dm = d.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+([a-zA-Z]+(?:\s*\([^\)]*\))?)\s*(.*)$/i);
      if (!dm) throw sqlError("ERR_UNSUPPORTED_DDL", `invalid column definition: ${d}`);
      const colName = dm[1]!.trim();
      const type = this.parseSqlTypeSpec(dm[2]!);
      const consRaw = dm[3]!.trim();
      const cons = consRaw.toUpperCase();
      const primaryKey = /\bPRIMARY\s+KEY\b/.test(cons);
      const notNull = primaryKey || /\bNOT\s+NULL\b/.test(cons);
      const unique = primaryKey || /\bUNIQUE\b/.test(cons);
      const defaultParsed = this.parseDefaultLiteral(consRaw, `ddl.default.create:${table}.${colName}`);
      const defaultValue = defaultParsed.hasDefault
        ? this.coerceByType(type, defaultParsed.typedValue ?? fromLiteral(null), `ddl.default.create:${table}.${colName}`)
        : undefined;
      if (notNull && defaultParsed.hasDefault && (defaultValue === null || defaultValue === undefined)) {
        throw sqlError("ERR_UNSUPPORTED_DDL", `DEFAULT NULL conflicts with NOT NULL: ${colName}`);
      }
      columns.push({ name: colName, type, notNull, primaryKey, unique, defaultValue });

      const colRefMatch = consRaw.match(/\bREFERENCES\s+(.+)$/i);
      if (colRefMatch) {
        const refSpec = this.parseForeignKeyReferenceClause(colRefMatch[1]!, d);
        if (refSpec.refColumns.length !== 1) {
          throw sqlError("ERR_UNSUPPORTED_DDL", `invalid FOREIGN KEY definition: ${d}`);
        }
        foreignKeys.push({
          columns: [colName],
          ...refSpec,
        });
      }
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

    for (const fk of foreignKeys) {
      for (const k of fk.columns) {
        if (!colByUpper.has(k.toUpperCase())) {
          throw sqlError("ERR_UNSUPPORTED_DDL", `FOREIGN KEY column not found: ${k}`);
        }
      }
    }

    return { name: table, columns, uniqueGroups: tableUniqueGroups, primaryKeyGroup, foreignKeys };
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
      const consRaw = add[4]!.trim();
      const cons = consRaw.toUpperCase();
      const primaryKey = /\bPRIMARY\s+KEY\b/.test(cons);
      const notNull = primaryKey || /\bNOT\s+NULL\b/.test(cons);
      const unique = primaryKey || /\bUNIQUE\b/.test(cons);
      const defaultParsed = this.parseDefaultLiteral(consRaw, `ddl.default.alter:${table}.${column}`);
      const defaultValue = defaultParsed.hasDefault
        ? this.coerceByType(type, defaultParsed.typedValue ?? fromLiteral(null), `ddl.default.alter:${table}.${column}`)
        : undefined;
      const col: ColumnSchema = { name: column, type, notNull, primaryKey, unique, defaultValue };

      const rows = this.requireTable(table);
      if (notNull && rows.length > 0 && !defaultParsed.hasDefault) {
        throw constraintError("NOT_NULL_ADD_COLUMN", `cannot ADD COLUMN ${column} NOT NULL on non-empty table`, {
          token: column,
          clause: "ALTER TABLE ADD COLUMN",
          field: column,
        });
      }
      if (notNull && rows.length > 0 && (defaultValue === null || defaultValue === undefined)) {
        throw constraintError("NOT_NULL_ADD_COLUMN", `cannot ADD COLUMN ${column} NOT NULL with NULL DEFAULT`, {
          token: column,
          clause: "ALTER TABLE ADD COLUMN",
          field: column,
        });
      }

      const seededTyped = defaultParsed.hasDefault
        ? (defaultParsed.typedValue ?? fromLiteral(null, undefined, {}, `ddl.default.alter:${table}.${column}`))
        : fromLiteral(null, undefined, {}, `ddl.backfill.null:${table}.${column}`);
      const seeded = this.coerceByType(type, seededTyped, `ddl.backfill:${table}.${column}`);
      for (const r of rows) r[column] = seeded;
      schema.columns.push(col);
      this.uniqueGroupsCache.delete(table);
      this.rebuildUniqueIndexes(table);
      this.syncConstraintIndexesToCatalog(table);
      this.pruneInvalidIndexesForTable(table);
      this.pruneIndexVersionObjectsForTable(table);
      this.rebuildSecondaryIndexesForTable(table);
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
        throw constraintError("PK_DROP", `cannot DROP primary key column: ${column}`, {
          token: column,
          clause: "ALTER TABLE DROP COLUMN",
          field: column,
        });
      }
      if (schema.columns[idx]!.unique) {
        throw constraintError("UNIQUE_DROP", `cannot DROP UNIQUE column: ${column}`, {
          token: column,
          clause: "ALTER TABLE DROP COLUMN",
          field: column,
        });
      }
      const uniqueGroup = (schema.uniqueGroups ?? []).find((g) => g.some((c) => c.toUpperCase() === column.toUpperCase()));
      if (uniqueGroup) {
        throw constraintError("UNIQUE_DROP", `cannot DROP column referenced by UNIQUE constraint: ${column}`, {
          token: column,
          clause: "ALTER TABLE DROP COLUMN",
          field: column,
        });
      }

      this.invalidateViewsForDroppedColumn(table, column);
      schema.columns.splice(idx, 1);
      schema.foreignKeys = (schema.foreignKeys ?? []).filter(
        (fk) => !fk.columns.some((c) => c.toUpperCase() === column.toUpperCase()),
      );
      this.uniqueGroupsCache.delete(table);
      const rows = this.requireTable(table);
      for (const r of rows) delete r[column];
      this.rebuildUniqueIndexes(table);
      this.syncConstraintIndexesToCatalog(table);
      this.pruneInvalidIndexesForTable(table);
      this.pruneIndexVersionObjectsForTable(table);
      this.rebuildSecondaryIndexesForTable(table);
      this.dirtyTables.add(table);
      return;
    }

    throw sqlError("ERR_UNSUPPORTED_DDL", sql);
  }

  private collectDropDependents(table: string): string[] {
    const target = table.toUpperCase();
    const out = new Set<string>();
    for (const [schemaName, schema] of this.schemas.entries()) {
      if (schemaName.toUpperCase() === target) continue;
      for (const fk of schema.foreignKeys ?? []) {
        if (fk.refTable.toUpperCase() !== target) continue;
        out.add(`${schemaName}(${fk.columns.join(",")})`);
      }
    }
    return [...out.values()];
  }

  private isBoundTypedValue(value: SqlPrimitive | SqlTypedValue): value is SqlTypedValue {
    if (typeof value !== "object" || value === null) return false;
    return "type" in value && "value" in value && "metadata" in value;
  }

  private bindTypedValue(
    value: SqlPrimitive,
    source: "js" | "literal" | "storage",
    sourceContext: string,
  ): SqlTypedValue {
    if (source === "literal") return fromLiteral(value, undefined, {}, sourceContext);
    if (source === "storage") return fromStorage(value, undefined, {}, sourceContext);
    return fromJs(value, undefined, {}, sourceContext);
  }

  private formatTypedValueSnapshot(value: SqlTypedValue): string {
    const valueText = typeof value.value === "string" ? JSON.stringify(value.value) : String(value.value);
    const context = value.metadata.sourceContext ? `,context=${value.metadata.sourceContext}` : "";
    return `typedValue={type=${value.type},value=${valueText},source=${value.metadata.source}${context}}`;
  }

  private toTypedLogRow(row: SqlRow, sourceContext: string): Record<string, SqlTypedValue> {
    const out: Record<string, SqlTypedValue> = {};
    for (const [column, raw] of Object.entries(row)) {
      out[column] = fromStorage((raw ?? null) as SqlPrimitive, undefined, {}, `${sourceContext}.${column}`);
    }
    return out;
  }

  private runtimeTypeMetadataFromColumnType(type: ColumnTypeSpec): Partial<SqlRuntimeTypeMetadata> {
    if (type.name === "DECIMAL") {
      return {
        precision: type.precision,
        scale: type.scale,
      };
    }
    if (type.name === "CHAR" || type.name === "VARCHAR") {
      return {
        length: type.length,
      };
    }
    return {};
  }

  private coerceByType(type: ColumnTypeSpec, boundInput: SqlTypedValue, sourceContext = "dml.bind"): SqlPrimitive {
    if (!this.isBoundTypedValue(boundInput)) {
      throw sqlError("ERR_TYPE_CONSTRAINT", "write binding must be TypedValue");
    }
    const typedInput = boundInput;
    const value = typedInput.value;
    if (value === null) return null;

    const targetType = type.name as SqlRuntimeTypeName;
    const targetMetadata = this.runtimeTypeMetadataFromColumnType(type);
    const typedSnapshot = this.formatTypedValueSnapshot(typedInput);
    const withSnapshot = (message: string): string => `${message}; ${typedSnapshot}`;
    try {
      convertTypedValue(typedInput, targetType, {
        mode: "implicit",
        targetMetadata,
        sourceContext,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const invalidLiteral = msg.match(/^invalid (FLOAT|DOUBLE) literal:\s*(.+)$/i);
      if (invalidLiteral) {
        const coercedType = invalidLiteral[1]!.toUpperCase();
        const raw = invalidLiteral[2]!.trim();
        throw sqlError("ERR_TYPE_CONSTRAINT", withSnapshot(`expected numeric for ${coercedType}, got ${raw}`));
      }
      const finiteOnly = msg.match(/^(FLOAT|DOUBLE) value must be a finite number$/i);
      if (finiteOnly) {
        const coercedType = finiteOnly[1]!.toUpperCase();
        throw sqlError("ERR_TYPE_CONSTRAINT", withSnapshot(`expected numeric for ${coercedType}, got ${String(value)}`));
      }
      if (targetType === "BLOB" && /blob/i.test(msg)) {
        throw sqlError("ERR_TYPE_CONSTRAINT", withSnapshot(`invalid BLOB: ${String(value)}`));
      }
      throw sqlError("ERR_TYPE_CONSTRAINT", withSnapshot(msg));
    }

    const convert = (): SqlPrimitive => {
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
    if (type.name === "TEXT" || type.name === "STRING") {
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
      try {
        if (typeof value === "string") return encodeBlob(value);
        return encodeBlob(String(value));
      } catch {
        throw sqlError("ERR_TYPE_CONSTRAINT", `invalid BLOB: ${String(value)}`);
      }
    }

    throw sqlError("ERR_UNSUPPORTED_TYPE", type.name);
    };

    try {
      return convert();
    } catch (err) {
      if (err instanceof Error && /^ERR_TYPE_CONSTRAINT:/.test(err.message)) {
        if (err.message.includes("typedValue={")) throw err;
        const base = err.message.replace(/^ERR_TYPE_CONSTRAINT:\s*/, "");
        throw sqlError("ERR_TYPE_CONSTRAINT", withSnapshot(base));
      }
      throw err;
    }
  }

  private applySchemaOnWrite(
    table: string,
    candidate: SqlRow,
    previous?: SqlRow,
    boundInputs: BoundColumnValues = {},
  ): SqlRow {
    const schema = this.schemas.get(table);
    if (!schema) return candidate;

    for (const k of Object.keys(candidate)) {
      if (!schema.columns.some((c) => c.name === k)) {
        throw sqlError("ERR_TYPE_CONSTRAINT", `unknown column: ${k}`);
      }
    }

    const out: SqlRow = {};
    for (const c of schema.columns) {
      const hasCandidate = Object.prototype.hasOwnProperty.call(candidate, c.name);
      const raw = hasCandidate ? candidate[c.name] : (c.defaultValue ?? null);

      let bound: SqlTypedValue;
      try {
        bound =
          boundInputs[c.name]
          ?? (hasCandidate
            ? this.bindTypedValue(
                (raw ?? null) as SqlPrimitive,
                previous && Object.prototype.hasOwnProperty.call(previous, c.name) ? "storage" : "js",
                `dml.bind:${table}.${c.name}`,
              )
            : this.bindTypedValue((raw ?? null) as SqlPrimitive, "literal", `dml.default:${table}.${c.name}`));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if ((c.type.name === "FLOAT" || c.type.name === "DOUBLE") && /finite number/i.test(msg)) {
          throw sqlError("ERR_TYPE_CONSTRAINT", `expected numeric for ${c.type.name}, got ${String(raw)}`);
        }
        if (err instanceof Error && /^ERR_[A-Z_]+:/.test(err.message)) throw err;
        throw sqlError("ERR_TYPE_CONSTRAINT", msg);
      }

      const coerced = this.coerceByType(c.type, bound, `dml.coerce:${table}.${c.name}`);
      const coercedTyped = fromStorage((coerced ?? null) as SqlPrimitive, undefined, {}, `constraint.value:${table}.${c.name}`);
      if (this.logger.level === "debug") {
        this.logger.debug("write coercion", {
          table,
          column: c.name,
          inputTyped: bound,
          outputTyped: coercedTyped,
        });
      }
      if ((c.notNull || c.primaryKey) && (coercedTyped.value === null || coercedTyped.value === undefined)) {
        const snapshot = this.formatTypedValueSnapshot(coercedTyped);
        throw constraintError("NOT_NULL", `${table}.${c.name} is NOT NULL (${snapshot})`, {
          clause: "NOT NULL",
          field: `${table}.${c.name}`,
        });
      }
      out[c.name] = coercedTyped.value;
    }

    this.requireTable(table);
    this.ensureUniqueIndexMaps(table);
    const indexByKey = this.getUniqueIndexesForTable(table) ?? new Map<string, Map<string, SqlRow>>();

    for (const group of this.getUniqueGroups(table, schema)) {
      const keyName = this.uniqueGroupName(group);
      const keyVal = this.uniqueGroupValue(out, group);
      if (keyVal === null) continue;

      const hitRow = indexByKey.get(keyName)?.get(keyVal);
      this.bumpConstraintCost(table, { conflictChecks: 1 });
      if (hitRow !== undefined) {
        if (!previous || hitRow !== previous) {
          const snapshots = group
            .map((column) => {
              const typed = fromStorage((out[column] ?? null) as SqlPrimitive, undefined, {}, `constraint.unique:${table}.${column}`);
              return this.formatTypedValueSnapshot(typed);
            })
            .join(", ");
          throw constraintError(
            "DUPLICATE_KEY",
            `Duplicate key value for ${table}(${group.join(",")}): ${snapshots}`,
            {
            clause: "UNIQUE",
            field: group.join(","),
            },
          );
        }
      }
    }

    this.enforceForeignKeyIntegrity(table, out);
    return out;
  }

  private areConstraintValuesEqual(left: SqlPrimitive, right: SqlPrimitive, context: string): boolean {
    if ((left === null || left === undefined) && (right === null || right === undefined)) return true;
    if (left === null || left === undefined || right === null || right === undefined) return false;
    return this.encodeTypedKey(left, `${context}:left`) === this.encodeTypedKey(right, `${context}:right`);
  }

  private enforceForeignKeyIntegrity(table: string, row: SqlRow): void {
    const schema = this.schemas.get(table);
    if (!schema?.foreignKeys?.length) return;

    for (const fk of schema.foreignKeys) {
      const childValues = fk.columns.map((column) => (row[column] ?? null) as SqlPrimitive);
      const nullCount = childValues.filter((value) => value === null || value === undefined).length;
      if (nullCount === fk.columns.length) continue;
      if (fk.matchRule === "SIMPLE" || fk.matchRule === "PARTIAL") {
        if (nullCount > 0) continue;
      } else if (fk.matchRule === "FULL" && nullCount > 0) {
        throw constraintError(
          "FOREIGN_KEY",
          `MATCH FULL requires all-or-none child key values: ${table}(${fk.columns.join(",")})`,
          {
            clause: "FOREIGN KEY",
            field: `${table}(${fk.columns.join(",")})`,
          },
        );
      }

      const parentSchema = this.schemas.get(fk.refTable);
      if (!parentSchema) {
        throw constraintError("FOREIGN_KEY", `referenced table not found: ${fk.refTable}`, {
          clause: "FOREIGN KEY",
          field: `${table}(${fk.columns.join(",")})`,
        });
      }

      for (const refColumn of fk.refColumns) {
        if (!parentSchema.columns.some((column) => column.name.toUpperCase() === refColumn.toUpperCase())) {
          throw constraintError(
            "FOREIGN_KEY",
            `referenced column not found: ${fk.refTable}.${refColumn}`,
            {
              clause: "FOREIGN KEY",
              field: `${table}(${fk.columns.join(",")})`,
            },
          );
        }
      }

      const parentRows = this.requireTable(fk.refTable);
      const hasMatch = parentRows.some((parentRow) => fk.refColumns.every((refColumn, idx) => {
        const childValue = childValues[idx] ?? null;
        const parentValue = (parentRow[refColumn] ?? null) as SqlPrimitive;
        return this.areConstraintValuesEqual(parentValue, childValue, `constraint.fk:${table}.${fk.columns[idx]}`);
      }));

      if (!hasMatch) {
        throw constraintError(
          "FOREIGN_KEY",
          `referential integrity failed: ${table}(${fk.columns.join(",")}) -> ${fk.refTable}(${fk.refColumns.join(",")})`,
          {
            clause: "FOREIGN KEY",
            field: `${table}(${fk.columns.join(",")})`,
          },
        );
      }
    }
  }

  private getReferencingForeignKeys(parentTable: string): Array<{ table: string; fk: ForeignKeySpec }> {
    const out: Array<{ table: string; fk: ForeignKeySpec }> = [];
    for (const [table, schema] of this.schemas.entries()) {
      for (const fk of schema.foreignKeys ?? []) {
        if (fk.refTable.toUpperCase() === parentTable.toUpperCase()) out.push({ table, fk });
      }
    }
    return out;
  }

  private doesChildRowReferenceParent(parentRow: SqlRow, childRow: SqlRow, fk: ForeignKeySpec): boolean {
    for (let i = 0; i < fk.columns.length; i++) {
      const childValue = (childRow[fk.columns[i]!] ?? null) as SqlPrimitive;
      const parentValue = (parentRow[fk.refColumns[i]!] ?? null) as SqlPrimitive;
      if (childValue === null || childValue === undefined) return false;
      if (!this.areConstraintValuesEqual(parentValue, childValue, `constraint.fk.match:${fk.columns[i]}`)) return false;
    }
    return true;
  }

  private collectDeleteTargetsWithCascade(seedTable: string, seedRows: SqlRow[]): Map<string, Set<SqlRow>> {
    const targets = new Map<string, Set<SqlRow>>();
    const queue: Array<{ table: string; row: SqlRow; depth: number }> = [];

    const addTarget = (table: string, row: SqlRow, depth: number): void => {
      if (depth > MAX_FK_CASCADE_DEPTH) {
        throw constraintError(
          "FOREIGN_KEY",
          `cascade depth exceeded max=${MAX_FK_CASCADE_DEPTH} at ${table}`,
          {
            clause: "ON DELETE CASCADE",
            field: table,
          },
        );
      }
      let rows = targets.get(table);
      if (!rows) {
        rows = new Set<SqlRow>();
        targets.set(table, rows);
      }
      if (rows.has(row)) return;
      rows.add(row);
      queue.push({ table, row, depth });
    };

    for (const row of seedRows) addTarget(seedTable, row, 0);

    while (queue.length > 0) {
      const head = queue.shift()!;
      const refs = this.getReferencingForeignKeys(head.table);
      for (const ref of refs) {
        const childRows = this.requireWritableTableForDml(ref.table);
        const matchedChildren = childRows.filter((childRow) => this.doesChildRowReferenceParent(head.row, childRow, ref.fk));
        if (matchedChildren.length === 0) continue;

        if (ref.fk.onDelete === "CASCADE") {
          for (const childRow of matchedChildren) addTarget(ref.table, childRow, head.depth + 1);
          continue;
        }

        if (ref.fk.onDelete === "RESTRICT" || ref.fk.onDelete === "NO ACTION") {
          throw constraintError(
            "FOREIGN_KEY",
            `cannot delete ${head.table}: referenced by ${ref.table}(${ref.fk.columns.join(",")})`,
            {
              clause: `ON DELETE ${ref.fk.onDelete}`,
              field: `${head.table} -> ${ref.table}`,
            },
          );
        }

        throw constraintError(
          "FOREIGN_KEY",
          `ON DELETE ${ref.fk.onDelete} is not supported in delete path yet`,
          {
            clause: `ON DELETE ${ref.fk.onDelete}`,
            field: `${head.table} -> ${ref.table}`,
          },
        );
      }
    }

    return targets;
  }

  private applyDeleteTargets(targets: Map<string, Set<SqlRow>>): Map<string, number> {
    const counts = new Map<string, number>();

    for (const [table, toDelete] of targets.entries()) {
      if (toDelete.size === 0) continue;

      const rows = this.requireWritableTableForDml(table);
      const keep: SqlRow[] = [];
      let touched = 0;
      for (const row of rows) {
        if (!toDelete.has(row)) {
          keep.push(row);
          continue;
        }
        const beforeImage = { ...row };
        this.removeRowFromUniqueIndexes(table, row);
        this.recordTransactionLogWrite(table, "DELETE", beforeImage, beforeImage, null);
        if (!this.isDmlWriteStagingActive()) {
          this.removeRowFromSecondaryIndexes(table, beforeImage);
          this.bumpIndexMaintenanceStats(table, "DELETE", 1);
          this.applyImmediateRowVersion(table, "DELETE", beforeImage);
        }
        touched++;
      }

      this.setTableRows(table, keep);
      if (touched > 0) counts.set(table, touched);
    }

    return counts;
  }

  private findRowReferenceInSetByKey(table: string, rows: Set<SqlRow>, rowLike: SqlRow): SqlRow | null {
    const target = this.encodeIndexRowRefKey(table, rowLike);
    for (const candidate of rows.values()) {
      if (this.encodeIndexRowRefKey(table, candidate) === target) return candidate;
    }
    return null;
  }

  private recomputeHashIndexStatsForTable(table: string): void {
    const tableIndexes = this.hashIndexes.get(table);
    if (!tableIndexes || tableIndexes.size === 0) {
      this.hashIndexStats.delete(table);
      return;
    }

    let keys = 0;
    let rowsIndexed = 0;
    for (const buckets of tableIndexes.values()) {
      keys += buckets.size;
      for (const rows of buckets.values()) rowsIndexed += rows.size;
    }
    this.hashIndexStats.set(table, { keys, rowsIndexed });
  }

  private recomputeBtreeIndexStatsForTable(table: string): void {
    const tableIndexes = this.btreeIndexes.get(table);
    if (!tableIndexes || tableIndexes.size === 0) {
      this.btreeIndexStats.delete(table);
      return;
    }

    let keys = 0;
    let rowsIndexed = 0;
    for (const runtime of tableIndexes.values()) {
      keys += runtime.entries.length;
      for (const leaf of runtime.entries) rowsIndexed += leaf.rows.size;
    }
    this.btreeIndexStats.set(table, { keys, rowsIndexed });
  }

  private recomputeSecondaryIndexStatsForTable(table: string): void {
    this.recomputeHashIndexStatsForTable(table);
    this.recomputeBtreeIndexStatsForTable(table);
  }

  private addRowToSecondaryIndexes(table: string, row: SqlRow, options?: { recomputeStats?: boolean }): void {
    let changed = false;

    for (const entry of this.getActiveIndexEntriesForTable(table)) {
      const indexName = this.normalizeIndexName(entry.name);
      const column = entry.columns[0]!;
      const value = this.resolveRowValue(row, column);
      if (value === null || value === undefined) continue;

      if (entry.type === "HASH") {
        const tableIndexes = this.hashIndexes.get(table) ?? new Map<string, Map<string, Set<SqlRow>>>();
        const buckets = tableIndexes.get(indexName) ?? new Map<string, Set<SqlRow>>();
        const encodedKey = this.encodeTypedKey(value, `hash.index.dml.insert:${table}.${indexName}.${column}`);
        const bucketRows = buckets.get(encodedKey) ?? new Set<SqlRow>();
        if (!this.findRowReferenceInSetByKey(table, bucketRows, row)) {
          bucketRows.add(row);
          changed = true;
        }
        buckets.set(encodedKey, bucketRows);
        tableIndexes.set(indexName, buckets);
        this.hashIndexes.set(table, tableIndexes);
        continue;
      }

      const tableIndexes = this.btreeIndexes.get(table) ?? new Map<string, BtreeRuntimeIndex>();
      const runtime = tableIndexes.get(indexName) ?? { column, entries: [] };
      let leaf = runtime.entries.find((entryLeaf) => this.compareBtreeKey(entryLeaf.key, value) === 0);
      if (!leaf) {
        leaf = { key: value, rows: new Set<SqlRow>() };
        runtime.entries.push(leaf);
        runtime.entries.sort((a, b) => this.compareForOrder(a.key, b.key, "ASC"));
      }
      if (!this.findRowReferenceInSetByKey(table, leaf.rows, row)) {
        leaf.rows.add(row);
        changed = true;
      }
      tableIndexes.set(indexName, runtime);
      this.btreeIndexes.set(table, tableIndexes);
    }

    if (changed && (options?.recomputeStats ?? true)) this.recomputeSecondaryIndexStatsForTable(table);
  }

  private removeRowFromSecondaryIndexes(table: string, row: SqlRow, options?: { recomputeStats?: boolean }): void {
    let changed = false;

    const hashIndexesForTable = this.hashIndexes.get(table);
    if (hashIndexesForTable) {
      for (const [indexName, buckets] of [...hashIndexesForTable.entries()]) {
        const entry = this.indexCatalog.get(indexName);
        if (!entry || entry.type !== "HASH" || entry.status !== "ACTIVE" || entry.columns.length !== 1) continue;

        const column = entry.columns[0]!;
        const value = this.resolveRowValue(row, column);
        if (value === null || value === undefined) continue;
        const encodedKey = this.encodeTypedKey(value, `hash.index.dml.delete:${table}.${indexName}.${column}`);
        const bucketRows = buckets.get(encodedKey);
        if (!bucketRows) continue;

        const existing = this.findRowReferenceInSetByKey(table, bucketRows, row);
        if (!existing) continue;
        bucketRows.delete(existing);
        changed = true;
        if (bucketRows.size === 0) buckets.delete(encodedKey);
        if (buckets.size === 0) hashIndexesForTable.delete(indexName);
      }

      if (hashIndexesForTable.size === 0) this.hashIndexes.delete(table);
    }

    const btreeIndexesForTable = this.btreeIndexes.get(table);
    if (btreeIndexesForTable) {
      for (const [indexName, runtime] of [...btreeIndexesForTable.entries()]) {
        const entry = this.indexCatalog.get(indexName);
        if (!entry || entry.type !== "BTREE" || entry.status !== "ACTIVE" || entry.columns.length !== 1) continue;

        const column = runtime.column;
        const value = this.resolveRowValue(row, column);
        if (value === null || value === undefined) continue;

        const leaf = runtime.entries.find((entryLeaf) => this.compareBtreeKey(entryLeaf.key, value) === 0);
        if (!leaf) continue;
        const existing = this.findRowReferenceInSetByKey(table, leaf.rows, row);
        if (!existing) continue;

        leaf.rows.delete(existing);
        changed = true;
        if (leaf.rows.size === 0) runtime.entries = runtime.entries.filter((entryLeaf) => entryLeaf !== leaf);
        if (runtime.entries.length === 0) btreeIndexesForTable.delete(indexName);
      }

      if (btreeIndexesForTable.size === 0) this.btreeIndexes.delete(table);
    }

    if (changed && (options?.recomputeStats ?? true)) this.recomputeSecondaryIndexStatsForTable(table);
  }

  private commitRowUpdate(table: string, row: SqlRow, next: SqlRow): void {
    const beforeImage = { ...row };
    this.removeRowFromUniqueIndexes(table, row);
    if (!this.isDmlWriteStagingActive()) this.removeRowFromSecondaryIndexes(table, beforeImage);
    Object.keys(row).forEach((k) => delete row[k]);
    Object.assign(row, next);
    this.addRowToUniqueIndexes(table, row);
    if (!this.isDmlWriteStagingActive()) this.addRowToSecondaryIndexes(table, row);
    this.recordTransactionLogWrite(table, "UPDATE", beforeImage, beforeImage, { ...row });
    this.bumpConstraintCost(table, { updateOps: 1 });
    if (!this.isDmlWriteStagingActive()) {
      this.bumpIndexMaintenanceStats(table, "UPDATE", 1);
      this.applyImmediateRowVersion(table, "UPDATE", row);
    }
  }

  private didForeignKeyReferenceChange(fk: ForeignKeySpec, before: SqlRow, after: SqlRow): boolean {
    return fk.refColumns.some((refColumn) =>
      !this.areConstraintValuesEqual(
        (before[refColumn] ?? null) as SqlPrimitive,
        (after[refColumn] ?? null) as SqlPrimitive,
        `constraint.fk.ref-change:${refColumn}`,
      ));
  }

  private assertOnUpdateActionAllowed(parentTable: string, before: SqlRow, after: SqlRow): void {
    for (const ref of this.getReferencingForeignKeys(parentTable)) {
      if (!this.didForeignKeyReferenceChange(ref.fk, before, after)) continue;

      const childRows = this.requireWritableTableForDml(ref.table);
      const hasReference = childRows.some((childRow) => this.doesChildRowReferenceParent(before, childRow, ref.fk));
      if (!hasReference) continue;

      if (ref.fk.onUpdate === "RESTRICT" || ref.fk.onUpdate === "NO ACTION") {
        throw constraintError(
          "FOREIGN_KEY",
          `cannot update ${parentTable}: referenced by ${ref.table}(${ref.fk.columns.join(",")})`,
          {
            clause: `ON UPDATE ${ref.fk.onUpdate}`,
            field: `${parentTable} -> ${ref.table}`,
          },
        );
      }

      if (ref.fk.onUpdate !== "CASCADE") {
        throw constraintError(
          "FOREIGN_KEY",
          `ON UPDATE ${ref.fk.onUpdate} is not supported in update path yet`,
          {
            clause: `ON UPDATE ${ref.fk.onUpdate}`,
            field: `${parentTable} -> ${ref.table}`,
          },
        );
      }
    }
  }

  private applyOnUpdateCascade(parentTable: string, before: SqlRow, after: SqlRow): Map<string, number> {
    const counts = new Map<string, number>();

    for (const ref of this.getReferencingForeignKeys(parentTable)) {
      if (ref.fk.onUpdate !== "CASCADE") continue;
      if (!this.didForeignKeyReferenceChange(ref.fk, before, after)) continue;

      const childRows = this.requireWritableTableForDml(ref.table);
      for (const childRow of childRows) {
        if (!this.doesChildRowReferenceParent(before, childRow, ref.fk)) continue;
        const candidate = { ...childRow };
        for (let i = 0; i < ref.fk.columns.length; i++) {
          const childColumn = ref.fk.columns[i]!;
          const parentColumn = ref.fk.refColumns[i]!;
          candidate[childColumn] = (after[parentColumn] ?? null) as SqlPrimitive;
        }
        const next = this.applySchemaOnWrite(ref.table, candidate, childRow);
        this.commitRowUpdate(ref.table, childRow, next);
        counts.set(ref.table, (counts.get(ref.table) ?? 0) + 1);
      }
    }

    return counts;
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

  private normalizeIndexName(name: string): string {
    return name.trim().toUpperCase();
  }

  private normalizeViewName(name: string): string {
    return name.trim().toUpperCase();
  }

  private hasTableNameConflict(name: string): boolean {
    const key = name.trim().toUpperCase();
    if (!key) return false;
    for (const tableName of this.tables.keys()) {
      if (tableName.toUpperCase() === key) return true;
    }
    for (const schemaName of this.schemas.keys()) {
      if (schemaName.toUpperCase() === key) return true;
    }
    return false;
  }

  private isViewAllowedByNameList(viewName: string): boolean {
    const allowed = this.opts.viewPolicy?.allowedViewNames;
    if (!allowed?.length) return true;
    const key = this.normalizeViewName(viewName);
    return allowed.some((candidate) => this.normalizeViewName(candidate) === key);
  }

  private assertViewPermission(action: ViewPolicyAction, viewName: string): void {
    const policy = this.opts.viewPolicy;
    if (!policy) return;

    const allowedByAction = action === "CREATE"
      ? policy.allowCreate !== false
      : action === "DROP"
        ? policy.allowDrop !== false
        : policy.allowSelect !== false;
    const viewKey = this.normalizeViewName(viewName);
    if (!allowedByAction) {
      const code = action === "SELECT" ? "ERR_UNSUPPORTED_SELECT" : "ERR_UNSUPPORTED_DDL";
      throw sqlError(code, `${action} VIEW denied by view policy: ${viewKey}`);
    }
    if (!this.isViewAllowedByNameList(viewKey)) {
      const code = action === "SELECT" ? "ERR_UNSUPPORTED_SELECT" : "ERR_UNSUPPORTED_DDL";
      throw sqlError(code, `${action} VIEW denied by allowed view list: ${viewKey}`);
    }
  }

  private resolveViewDependencySource(
    sourceToken: string,
    sourceNames: Set<string>,
    sourceAliases: Map<string, string>,
  ): string | null {
    const key = sourceToken.trim().toUpperCase();
    if (!key) return null;
    const fromAlias = sourceAliases.get(key);
    if (fromAlias) return fromAlias;
    if (sourceNames.has(key)) return key;
    return null;
  }

  private markViewDependencyColumn(
    dependencyMap: Map<string, Set<string>>,
    source: string,
    column: string,
  ): void {
    const sourceKey = source.trim().toUpperCase();
    if (!sourceKey) return;
    const columnKey = column.trim().toUpperCase();
    if (!columnKey) return;

    const bucket = dependencyMap.get(sourceKey) ?? new Set<string>();
    bucket.add(columnKey);
    dependencyMap.set(sourceKey, bucket);
  }

  private collectViewDependencyColumnsFromIdentifier(
    identifier: string,
    sourceNames: Set<string>,
    sourceAliases: Map<string, string>,
    dependencyMap: Map<string, Set<string>>,
  ): void {
    const trimmed = identifier.trim();
    if (!trimmed || sourceNames.size === 0) return;

    if (trimmed === VIEW_DEPENDENCY_WILDCARD) {
      for (const source of sourceNames) {
        this.markViewDependencyColumn(dependencyMap, source, VIEW_DEPENDENCY_WILDCARD);
      }
      return;
    }

    const parts = trimmed.split(".").map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return;

    if (parts.length >= 2) {
      const sourceToken = parts[parts.length - 2]!;
      const columnToken = parts[parts.length - 1]!;
      const resolvedSource = this.resolveViewDependencySource(sourceToken, sourceNames, sourceAliases);
      if (resolvedSource) {
        this.markViewDependencyColumn(dependencyMap, resolvedSource, columnToken);
        return;
      }
    }

    const columnToken = parts[parts.length - 1]!;
    for (const source of sourceNames) {
      this.markViewDependencyColumn(dependencyMap, source, columnToken);
    }
  }

  private collectViewDependencyColumnsFromRawExpr(
    rawExpr: string,
    sourceNames: Set<string>,
    sourceAliases: Map<string, string>,
    dependencyMap: Map<string, Set<string>>,
  ): void {
    if (sourceNames.size === 0) return;

    const scrubbed = rawExpr.replace(/'[^']*'/g, " ").replace(/\"[^\"]*\"/g, " ");
    for (const qualified of scrubbed.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\.\s*([a-zA-Z_][a-zA-Z0-9_]*|\*)/g)) {
      this.collectViewDependencyColumnsFromIdentifier(
        `${qualified[1]}.${qualified[2]}`,
        sourceNames,
        sourceAliases,
        dependencyMap,
      );
    }

    for (const match of scrubbed.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g)) {
      const token = match[1]!;
      const upper = token.toUpperCase();
      if (VIEW_DEPENDENCY_KEYWORDS.has(upper)) continue;

      const nextChunk = scrubbed.slice((match.index ?? 0) + token.length);
      if (/^\s*\(/.test(nextChunk)) continue;
      this.collectViewDependencyColumnsFromIdentifier(token, sourceNames, sourceAliases, dependencyMap);
    }
  }

  private collectViewDependencyColumnsFromExpr(
    expr: ExprAst | undefined,
    sourceNames: Set<string>,
    sourceAliases: Map<string, string>,
    dependencyMap: Map<string, Set<string>>,
  ): void {
    if (!expr || sourceNames.size === 0) return;

    switch (expr.kind) {
      case "identifier":
        this.collectViewDependencyColumnsFromIdentifier(expr.name, sourceNames, sourceAliases, dependencyMap);
        return;
      case "binary":
        this.collectViewDependencyColumnsFromExpr(expr.left, sourceNames, sourceAliases, dependencyMap);
        this.collectViewDependencyColumnsFromExpr(expr.right, sourceNames, sourceAliases, dependencyMap);
        return;
      case "unary":
        this.collectViewDependencyColumnsFromExpr(expr.expr, sourceNames, sourceAliases, dependencyMap);
        return;
      case "function":
        for (const arg of expr.args) {
          this.collectViewDependencyColumnsFromExpr(arg, sourceNames, sourceAliases, dependencyMap);
        }
        return;
      case "raw":
        this.collectViewDependencyColumnsFromRawExpr(expr.text, sourceNames, sourceAliases, dependencyMap);
        return;
      default:
        return;
    }
  }

  private collectViewDependencyFromSelectAst(
    ast: SelectStatementAst,
    dependencyMap: Map<string, Set<string>>,
  ): void {
    const sourceNames = new Set<string>();
    const sourceAliases = new Map<string, string>();

    const trackSource = (tableName: string, alias?: string): void => {
      const source = tableName.trim().toUpperCase();
      if (!source) return;
      sourceNames.add(source);
      if (!dependencyMap.has(source)) dependencyMap.set(source, new Set<string>());
      sourceAliases.set(source, source);
      if (alias) sourceAliases.set(alias.trim().toUpperCase(), source);
    };

    if (ast.from.kind === "table") {
      trackSource(ast.from.name, ast.from.alias);
    } else {
      const nestedAst = parseSqlToAst(ast.from.subquerySql, { dialect: this.opts.dialect ?? "ansi" });
      this.collectViewDependencyFromStatement(nestedAst, dependencyMap);
    }

    const joins = ast.joins?.length ? ast.joins : ast.join ? [ast.join] : [];
    for (const join of joins) {
      trackSource(join.table);
      this.collectViewDependencyColumnsFromIdentifier(join.onLeft, sourceNames, sourceAliases, dependencyMap);
      this.collectViewDependencyColumnsFromIdentifier(join.onRight, sourceNames, sourceAliases, dependencyMap);
    }

    for (const item of ast.selectItems) {
      if (item.expr.kind === "identifier" && item.expr.name.trim() === VIEW_DEPENDENCY_WILDCARD) {
        for (const source of sourceNames) {
          this.markViewDependencyColumn(dependencyMap, source, VIEW_DEPENDENCY_WILDCARD);
        }
        continue;
      }
      if (item.expr.kind === "raw") {
        const rawExpr = item.expr.text.trim();
        if (rawExpr === VIEW_DEPENDENCY_WILDCARD) {
          for (const source of sourceNames) {
            this.markViewDependencyColumn(dependencyMap, source, VIEW_DEPENDENCY_WILDCARD);
          }
          continue;
        }
        const qualifiedWildcard = rawExpr.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.\*$/);
        if (qualifiedWildcard) {
          this.collectViewDependencyColumnsFromIdentifier(
            `${qualifiedWildcard[1]}.${VIEW_DEPENDENCY_WILDCARD}`,
            sourceNames,
            sourceAliases,
            dependencyMap,
          );
          continue;
        }
      }
      this.collectViewDependencyColumnsFromExpr(item.expr, sourceNames, sourceAliases, dependencyMap);
    }
    this.collectViewDependencyColumnsFromExpr(ast.where, sourceNames, sourceAliases, dependencyMap);
    this.collectViewDependencyColumnsFromExpr(ast.having, sourceNames, sourceAliases, dependencyMap);
    for (const orderItem of ast.orderBy ?? []) {
      this.collectViewDependencyColumnsFromExpr(orderItem.expr, sourceNames, sourceAliases, dependencyMap);
    }
    for (const groupItem of ast.groupBy ?? []) {
      this.collectViewDependencyColumnsFromExpr(groupItem, sourceNames, sourceAliases, dependencyMap);
    }
  }

  private collectViewDependencyFromStatement(
    ast: SqlAstStatement,
    dependencyMap: Map<string, Set<string>>,
  ): void {
    if (ast.kind === "select") {
      this.collectViewDependencyFromSelectAst(ast, dependencyMap);
      return;
    }

    if (ast.kind === "union" || ast.kind === "intersect" || ast.kind === "except") {
      const left = parseSqlToAst(ast.leftSql, { dialect: this.opts.dialect ?? "ansi" });
      const right = parseSqlToAst(ast.rightSql, { dialect: this.opts.dialect ?? "ansi" });
      this.collectViewDependencyFromStatement(left, dependencyMap);
      this.collectViewDependencyFromStatement(right, dependencyMap);
    }
  }

  private extractViewDependencies(querySql: string): ViewDependencyEntry[] {
    const ast = parseSqlToAst(querySql, { dialect: this.opts.dialect ?? "ansi" });
    const dependencyMap = new Map<string, Set<string>>();
    this.collectViewDependencyFromStatement(ast, dependencyMap);

    const out: ViewDependencyEntry[] = [];
    for (const [source, columns] of dependencyMap.entries()) {
      out.push({
        source,
        columns: [...columns.values()].sort(),
      });
    }
    out.sort((a, b) => a.source.localeCompare(b.source));
    return out;
  }

  private markViewInvalid(viewName: string, reason: string): void {
    const normalizedViewName = this.normalizeViewName(viewName);
    const entry = this.viewCatalog.get(normalizedViewName);
    if (!entry) return;
    entry.status = "INVALID";
    entry.invalidReason = reason;
    entry.invalidatedAt = Date.now();
  }

  private collectTransitiveDependentViews(seedViews: Set<string>): Set<string> {
    const impacted = new Set<string>(seedViews);
    let changed = true;
    while (changed) {
      changed = false;
      for (const entry of this.viewCatalog.values()) {
        const viewName = this.normalizeViewName(entry.name);
        if (impacted.has(viewName)) continue;
        const dependsOnImpactedView = entry.dependencies.some((dependency) =>
          impacted.has(this.normalizeViewName(dependency.source)));
        if (!dependsOnImpactedView) continue;
        impacted.add(viewName);
        changed = true;
      }
    }
    return impacted;
  }

  private invalidateViewsForDroppedTable(table: string): void {
    const tableKey = table.trim().toUpperCase();
    const directlyImpacted = new Set<string>();
    for (const entry of this.viewCatalog.values()) {
      if (!entry.dependencies.some((dependency) => dependency.source.toUpperCase() === tableKey)) continue;
      directlyImpacted.add(this.normalizeViewName(entry.name));
    }

    if (!directlyImpacted.size) return;
    const impacted = this.collectTransitiveDependentViews(directlyImpacted);
    for (const viewName of impacted) {
      const reason = directlyImpacted.has(viewName)
        ? `base table dropped: ${table}`
        : `dependent view invalidated after table drop: ${table}`;
      this.markViewInvalid(viewName, reason);
    }
  }

  private invalidateViewsForDroppedColumn(table: string, column: string): void {
    const tableKey = table.trim().toUpperCase();
    const columnKey = column.trim().toUpperCase();
    const directlyImpacted = new Set<string>();

    for (const entry of this.viewCatalog.values()) {
      const hasDependency = entry.dependencies.some((dependency) => {
        if (dependency.source.toUpperCase() !== tableKey) return false;
        const columns = dependency.columns.map((it) => it.toUpperCase());
        if (columns.includes(VIEW_DEPENDENCY_WILDCARD)) return true;
        return columns.includes(columnKey);
      });
      if (!hasDependency) continue;
      directlyImpacted.add(this.normalizeViewName(entry.name));
    }

    if (!directlyImpacted.size) return;
    const impacted = this.collectTransitiveDependentViews(directlyImpacted);
    for (const viewName of impacted) {
      const reason = directlyImpacted.has(viewName)
        ? `base column dropped: ${table}.${column}`
        : `dependent view invalidated after column drop: ${table}.${column}`;
      this.markViewInvalid(viewName, reason);
    }
  }

  private pruneInvalidIndexesForTable(table: string): void {
    const schema = this.schemas.get(table);
    if (!schema) return;

    const validColumns = new Set(schema.columns.map((column) => column.name.toUpperCase()));
    for (const [indexName, entry] of [...this.indexCatalog.entries()]) {
      if (entry.table.toUpperCase() !== table.toUpperCase()) continue;
      if (entry.columns.every((column) => validColumns.has(column.toUpperCase()))) continue;
      this.indexCatalog.delete(indexName);
    }
  }

  private executeCreateIndexStatement(ast: CreateIndexStatementAst): string {
    const table = ast.tableName.trim();
    const schema = this.schemas.get(table);
    if (!schema || !this.tables.has(table)) throw sqlError("ERR_TABLE_NOT_FOUND", table);

    const indexName = this.normalizeIndexName(ast.indexName);
    if (this.indexCatalog.has(indexName)) {
      throw sqlError("ERR_UNSUPPORTED_DDL", `index already exists: ${ast.indexName}`);
    }

    if (ast.columns.length !== 1) {
      throw sqlError("ERR_UNSUPPORTED_DDL", "CREATE INDEX execution currently supports single-column BTREE indexes only");
    }

    const requestedColumn = ast.columns[0]!.trim();
    const schemaColumn = schema.columns.find((column) => column.name.toUpperCase() === requestedColumn.toUpperCase());
    if (!schemaColumn) {
      throw sqlError("ERR_UNSUPPORTED_DDL", `index column not found on table ${table}: ${requestedColumn}`);
    }

    this.indexCatalog.set(indexName, {
      name: indexName,
      table,
      columns: [schemaColumn.name],
      type: "BTREE",
      unique: ast.unique,
      status: "ACTIVE",
    });
    this.rebuildBtreeIndexesForTable(table);
    this.recordImmutableIndexVersionObject(this.indexCatalog.get(indexName)!);
    return table;
  }

  private executeCreateViewStatement(ast: CreateViewStatementAst): string {
    const viewName = this.normalizeViewName(ast.viewName);
    this.assertViewPermission("CREATE", viewName);
    if (this.hasTableNameConflict(viewName)) {
      throw sqlError("ERR_UNSUPPORTED_DDL", `name conflict with existing table: ${ast.viewName}`);
    }
    if (this.viewCatalog.has(viewName)) {
      throw sqlError("ERR_UNSUPPORTED_DDL", `view already exists: ${ast.viewName}`);
    }

    const dependencies = this.extractViewDependencies(ast.querySql);
    this.viewCatalog.set(viewName, {
      name: viewName,
      querySql: ast.querySql,
      status: "ACTIVE",
      dependencies,
    });
    return viewName;
  }

  private executeDropIndexStatement(ast: DropIndexStatementAst): string | null {
    const indexName = this.normalizeIndexName(ast.indexName);
    const entry = this.indexCatalog.get(indexName);
    const tableHint = ast.tableName?.trim();
    if (!entry || (tableHint && entry.table.toUpperCase() !== tableHint.toUpperCase())) {
      if (ast.ifExists) return null;
      throw sqlError("ERR_UNSUPPORTED_DDL", `index not found: ${ast.indexName}`);
    }

    if (entry.unique && indexName.startsWith(`__${entry.table.toUpperCase()}__`)) {
      throw sqlError("ERR_UNSUPPORTED_DDL", `cannot drop internal constraint index: ${entry.name}`);
    }

    this.indexCatalog.delete(indexName);
    this.rebuildSecondaryIndexesForTable(entry.table);
    return entry.table;
  }

  private executeDropViewStatement(ast: DropViewStatementAst): string | null {
    const viewName = this.normalizeViewName(ast.viewName);
    const entry = this.viewCatalog.get(viewName);
    if (!entry) {
      if (ast.ifExists) return null;
      throw sqlError("ERR_UNSUPPORTED_DDL", `view not found: ${ast.viewName}`);
    }

    this.assertViewPermission("DROP", viewName);
    this.viewCatalog.delete(viewName);
    return entry.name;
  }

  private rebuildSecondaryIndexesForTable(table: string): void {
    this.rebuildHashIndexesForTable(table);
    this.rebuildBtreeIndexesForTable(table);
  }

  private rebuildHashIndexesForTable(table: string): void {
    const rows = this.tables.get(table);
    if (!rows) {
      this.hashIndexes.delete(table);
      this.hashIndexStats.delete(table);
      return;
    }

    const indexesForTable = new Map<string, Map<string, Set<SqlRow>>>();
    let keys = 0;
    let rowsIndexed = 0;

    for (const entry of this.indexCatalog.values()) {
      if (entry.table.toUpperCase() !== table.toUpperCase()) continue;
      if (entry.type !== "HASH") continue;
      if (entry.status !== "ACTIVE") continue;
      if (entry.columns.length !== 1) continue;

      const column = entry.columns[0]!;
      const bucket = new Map<string, Set<SqlRow>>();
      for (const row of rows) {
        const val = this.resolveRowValue(row, column);
        if (val === null || val === undefined) continue;
        const key = this.encodeTypedKey(val, `hash.index.key:${table}.${entry.name}.${column}`);
        const set = bucket.get(key) ?? new Set<SqlRow>();
        set.add(row);
        bucket.set(key, set);
        rowsIndexed += 1;
      }

      if (bucket.size > 0) {
        keys += bucket.size;
        indexesForTable.set(entry.name.toUpperCase(), bucket);
      }
    }

    if (indexesForTable.size > 0) {
      this.hashIndexes.set(table, indexesForTable);
      this.hashIndexStats.set(table, { keys, rowsIndexed });
      this.recordIndexMaintenance(table, "INDEX_REBUILD", rowsIndexed);
    } else {
      this.hashIndexes.delete(table);
      this.hashIndexStats.delete(table);
    }
  }

  private rebuildBtreeIndexesForTable(table: string): void {
    const rows = this.tables.get(table);
    if (!rows) {
      this.btreeIndexes.delete(table);
      this.btreeIndexStats.delete(table);
      return;
    }

    const indexesForTable: BtreeRuntimeIndexMap = new Map();
    let keys = 0;
    let rowsIndexed = 0;

    for (const entry of this.indexCatalog.values()) {
      if (entry.table.toUpperCase() !== table.toUpperCase()) continue;
      if (entry.type !== "BTREE") continue;
      if (entry.status !== "ACTIVE") continue;
      if (entry.columns.length !== 1) continue;

      const column = entry.columns[0]!;
      const leafMap = new Map<string, BtreeIndexLeafEntry>();
      for (const row of rows) {
        const val = this.resolveRowValue(row, column);
        if (val === null || val === undefined) continue;

        const encoded = this.encodeTypedKey(val, `btree.index.key:${table}.${entry.name}.${column}`);
        const existing = leafMap.get(encoded);
        if (existing) {
          existing.rows.add(row);
        } else {
          leafMap.set(encoded, {
            key: val as SqlPrimitive,
            rows: new Set<SqlRow>([row]),
          });
          keys += 1;
        }
        rowsIndexed += 1;
      }

      if (leafMap.size === 0) continue;
      const leaves = [...leafMap.values()].sort((a, b) => this.compareForOrder(a.key, b.key, "ASC"));
      indexesForTable.set(entry.name.toUpperCase(), {
        column,
        entries: leaves,
      });
    }

    if (indexesForTable.size > 0) {
      this.btreeIndexes.set(table, indexesForTable);
      this.btreeIndexStats.set(table, { keys, rowsIndexed });
      this.recordIndexMaintenance(table, "INDEX_REBUILD", rowsIndexed);
    } else {
      this.btreeIndexes.delete(table);
      this.btreeIndexStats.delete(table);
    }
  }

  private getHashIndexedCandidates(
    table: string,
    whereClauses: WhereClause[],
    trackLookupStats = true,
  ): { rows: SqlRow[]; indexName: string; column: string } | null {
    const tableIndexes = this.hashIndexes.get(table);
    if (!tableIndexes) return null;

    let best: { rows: SqlRow[]; indexName: string; column: string } | null = null;
    for (const clause of whereClauses) {
      if (clause.logic === "OR") continue;
      if (clause.op !== "=") continue;
      if (!clause.field || clause.field.includes(".")) continue;
      if (!clause.valueExprs?.length) continue;

      const eqValueRaw = clause.valueExprs[0]!.trim();
      if (/^[a-zA-Z_][a-zA-Z0-9_\.]*$/.test(eqValueRaw)) continue;
      const eqValue = this.castValue(eqValueRaw);
      if (eqValue === null || eqValue === undefined) continue;

      for (const [indexName, buckets] of tableIndexes.entries()) {
        const entry = this.indexCatalog.get(indexName);
        if (!entry || entry.columns.length !== 1) continue;
        const column = entry.columns[0]!;
        if (column.toUpperCase() !== clause.field.toUpperCase()) continue;

        const key = this.encodeTypedKey(eqValue as SqlPrimitive, `hash.index.lookup:${table}.${indexName}.${column}`);
        const hit = buckets.get(key);
        const candidateRows = hit ? [...hit] : [];
        const candidate = { rows: candidateRows, indexName, column };
        if (!best) {
          best = candidate;
          continue;
        }
        if (candidate.rows.length < best.rows.length) {
          best = candidate;
          continue;
        }
        if (candidate.rows.length > best.rows.length) continue;
        if (candidate.indexName.localeCompare(best.indexName) < 0) best = candidate;
      }
    }

    if (trackLookupStats && best) this.bumpIndexLookupStats(table, best.rows.length > 0);
    return best;
  }

  private compareBtreeKey(a: SqlPrimitive, b: SqlPrimitive): number {
    const lt = this.compareByOp(a, b, "<");
    if (lt === "TRUE") return -1;
    const gt = this.compareByOp(a, b, ">");
    if (gt === "TRUE") return 1;
    return 0;
  }

  private pickTighterBtreeBound(
    current: BtreeRangeBound | undefined,
    candidate: BtreeRangeBound,
    edge: "lower" | "upper",
  ): BtreeRangeBound {
    if (!current) return candidate;
    const cmp = this.compareBtreeKey(candidate.value, current.value);

    if (edge === "lower") {
      if (cmp > 0) return candidate;
      if (cmp < 0) return current;
      if (!candidate.inclusive && current.inclusive) return candidate;
      return current;
    }

    if (cmp < 0) return candidate;
    if (cmp > 0) return current;
    if (!candidate.inclusive && current.inclusive) return candidate;
    return current;
  }

  private isSimpleLiteralExpr(rawExpr: string): boolean {
    const trimmed = rawExpr.trim();
    if (!trimmed) return false;
    if (/^[a-zA-Z_][a-zA-Z0-9_\.]*$/.test(trimmed)) return false;
    if (/^(TRUE|FALSE|NULL)$/i.test(trimmed)) return true;
    if (/^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) return true;
    if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith("\"") && trimmed.endsWith("\""))) {
      return true;
    }
    return false;
  }

  private parseIndexLiteral(rawExpr: string): SqlPrimitive | undefined {
    if (!this.isSimpleLiteralExpr(rawExpr)) return undefined;
    const parsed = this.castValue(rawExpr);
    if (parsed === null || parsed === undefined) return undefined;
    return parsed as SqlPrimitive;
  }

  private extractBtreeRangePredicate(column: string, whereClauses: WhereClause[]): BtreeRangePredicate | null {
    if (whereClauses.length === 0) return null;
    if (whereClauses.some((clause) => clause.logic === "OR")) return null;

    let lower: BtreeRangeBound | undefined;
    let upper: BtreeRangeBound | undefined;
    const target = column.toUpperCase();

    for (const clause of whereClauses) {
      if (!clause.field || clause.field.includes(".")) continue;
      if (clause.field.toUpperCase() !== target) continue;
      if (clause.valueExpr) continue;

      if (clause.op === "=") {
        const eqRaw = clause.valueExprs?.[0];
        if (!eqRaw) continue;
        const eqValue = this.parseIndexLiteral(eqRaw);
        if (eqValue === undefined) continue;
        const bound: BtreeRangeBound = { value: eqValue, inclusive: true };
        lower = this.pickTighterBtreeBound(lower, bound, "lower");
        upper = this.pickTighterBtreeBound(upper, bound, "upper");
        continue;
      }

      if (clause.op === ">" || clause.op === ">=" || clause.op === "<" || clause.op === "<=") {
        const cmpRaw = clause.valueExprs?.[0];
        if (!cmpRaw) continue;
        const cmpValue = this.parseIndexLiteral(cmpRaw);
        if (cmpValue === undefined) continue;

        if (clause.op === ">" || clause.op === ">=") {
          lower = this.pickTighterBtreeBound(
            lower,
            { value: cmpValue, inclusive: clause.op === ">=" },
            "lower",
          );
        } else {
          upper = this.pickTighterBtreeBound(
            upper,
            { value: cmpValue, inclusive: clause.op === "<=" },
            "upper",
          );
        }
        continue;
      }

      if (clause.op === "BETWEEN") {
        const lowRaw = clause.valueExprs?.[0];
        const highRaw = clause.valueExprs?.[1];
        if (!lowRaw || !highRaw) continue;
        const lowValue = this.parseIndexLiteral(lowRaw);
        const highValue = this.parseIndexLiteral(highRaw);
        if (lowValue === undefined || highValue === undefined) continue;

        lower = this.pickTighterBtreeBound(lower, { value: lowValue, inclusive: true }, "lower");
        upper = this.pickTighterBtreeBound(upper, { value: highValue, inclusive: true }, "upper");
      }
    }

    if (!lower && !upper) return null;
    return { lower, upper };
  }

  private isBtreePredicateEmpty(predicate: BtreeRangePredicate): boolean {
    if (!predicate.lower || !predicate.upper) return false;
    const cmp = this.compareBtreeKey(predicate.lower.value, predicate.upper.value);
    if (cmp > 0) return true;
    if (cmp < 0) return false;
    return !predicate.lower.inclusive || !predicate.upper.inclusive;
  }

  private scanBtreeIndexRows(
    index: BtreeRuntimeIndex,
    direction: "ASC" | "DESC",
    predicate?: BtreeRangePredicate,
  ): SqlRow[] {
    if (predicate && this.isBtreePredicateEmpty(predicate)) return [];

    const entries = direction === "DESC" ? [...index.entries].reverse() : index.entries;
    const out: SqlRow[] = [];
    for (const leaf of entries) {
      if (predicate?.lower) {
        const cmpLower = this.compareBtreeKey(leaf.key, predicate.lower.value);
        const tooLow = cmpLower < 0 || (cmpLower === 0 && !predicate.lower.inclusive);
        if (tooLow) {
          if (direction === "DESC") break;
          continue;
        }
      }

      if (predicate?.upper) {
        const cmpUpper = this.compareBtreeKey(leaf.key, predicate.upper.value);
        const tooHigh = cmpUpper > 0 || (cmpUpper === 0 && !predicate.upper.inclusive);
        if (tooHigh) {
          if (direction === "ASC") break;
          continue;
        }
      }

      out.push(...leaf.rows.values());
    }
    return out;
  }

  private getBtreeIndexedCandidates(
    table: string,
    whereClauses: WhereClause[],
    trackLookupStats = true,
  ): { rows: SqlRow[]; indexName: string; column: string } | null {
    const tableIndexes = this.btreeIndexes.get(table);
    if (!tableIndexes) return null;

    let best: { rows: SqlRow[]; indexName: string; column: string } | null = null;
    for (const [indexName, runtime] of tableIndexes.entries()) {
      const entry = this.indexCatalog.get(indexName);
      if (!entry || entry.columns.length !== 1) continue;

      const predicate = this.extractBtreeRangePredicate(runtime.column, whereClauses);
      if (!predicate) continue;
      const rows = this.scanBtreeIndexRows(runtime, "ASC", predicate);
      const candidate = { rows, indexName, column: runtime.column };
      if (!best) {
        best = candidate;
        continue;
      }
      if (candidate.rows.length < best.rows.length) {
        best = candidate;
        continue;
      }
      if (candidate.rows.length > best.rows.length) continue;
      if (candidate.indexName.localeCompare(best.indexName) < 0) best = candidate;
    }

    if (trackLookupStats && best) this.bumpIndexLookupStats(table, best.rows.length > 0);
    return best;
  }

  private getBtreeOrderedScanCandidates(
    table: string,
    rows: SqlRow[],
    parsed: Pick<ParsedSelect, "orderByList" | "whereClauses" | "groupBy" | "aggregate" | "rowNumberAlias" | "having">,
    trackLookupStats = true,
  ): { rows: SqlRow[]; indexName: string; column: string; orderSatisfied: boolean } | null {
    if (parsed.aggregate || parsed.groupBy?.length || parsed.having || parsed.rowNumberAlias) return null;
    if (!parsed.orderByList || parsed.orderByList.length !== 1) return null;

    const orderExpr = parsed.orderByList[0]!.field.trim();
    const orderExprMatch = orderExpr.match(/^[a-zA-Z_][a-zA-Z0-9_\.]*$/);
    if (!orderExprMatch) return null;

    const orderField = orderExpr.includes(".") ? orderExpr.split(".").at(-1)! : orderExpr;
    const direction = parsed.orderByList[0]!.direction;
    const tableIndexes = this.btreeIndexes.get(table);
    if (!tableIndexes) return null;

    let best: { rows: SqlRow[]; indexName: string; column: string; orderSatisfied: boolean } | null = null;
    for (const [indexName, runtime] of tableIndexes.entries()) {
      if (runtime.column.toUpperCase() !== orderField.toUpperCase()) continue;
      const predicate = this.extractBtreeRangePredicate(runtime.column, parsed.whereClauses);
      const orderedRows = this.scanBtreeIndexRows(runtime, direction, predicate ?? undefined);

      const isBoundByOrderColumn = Boolean(predicate && (predicate.lower || predicate.upper));
      if (!isBoundByOrderColumn) {
        const nullTail = rows.filter((row) => {
          const value = this.resolveRowValue(row, runtime.column);
          return value === null || value === undefined;
        });
        orderedRows.push(...nullTail);
      }

      const candidate = {
        rows: orderedRows,
        indexName,
        column: runtime.column,
        orderSatisfied: true,
      };
      if (!best) {
        best = candidate;
        continue;
      }
      if (candidate.rows.length < best.rows.length) {
        best = candidate;
        continue;
      }
      if (candidate.rows.length > best.rows.length) continue;
      if (candidate.indexName.localeCompare(best.indexName) < 0) best = candidate;
    }

    if (trackLookupStats && best) this.bumpIndexLookupStats(table, best.rows.length > 0);
    return best;
  }

  getHashIndexStats(table?: string): { table: string; keys: number; rowsIndexed: number }[] {
    const out: { table: string; keys: number; rowsIndexed: number }[] = [];
    for (const [tableName, stats] of this.hashIndexStats.entries()) {
      if (table && tableName.toUpperCase() !== table.toUpperCase()) continue;
      out.push({ table: tableName, keys: stats.keys, rowsIndexed: stats.rowsIndexed });
    }
    out.sort((a, b) => a.table.localeCompare(b.table));
    return out;
  }

  getBtreeIndexStats(table?: string): { table: string; keys: number; rowsIndexed: number }[] {
    const out: { table: string; keys: number; rowsIndexed: number }[] = [];
    for (const [tableName, stats] of this.btreeIndexStats.entries()) {
      if (table && tableName.toUpperCase() !== table.toUpperCase()) continue;
      out.push({ table: tableName, keys: stats.keys, rowsIndexed: stats.rowsIndexed });
    }
    out.sort((a, b) => a.table.localeCompare(b.table));
    return out;
  }

  private syncConstraintIndexesToCatalog(table: string): void {
    const schema = this.schemas.get(table);
    if (!schema) return;

    for (const [indexName, entry] of [...this.indexCatalog.entries()]) {
      if (entry.table.toUpperCase() !== table.toUpperCase()) continue;
      if (!entry.unique) continue;
      if (!indexName.startsWith(`__${table.toUpperCase()}__`)) continue;
      this.indexCatalog.delete(indexName);
    }

    const groups = this.getUniqueGroups(table, schema);
    for (const group of groups) {
      const normalizedColumns = group.map((column) => column.trim());
      const syntheticName = this.normalizeIndexName(`__${table}__${normalizedColumns.join("_")}__UNQ`);
      this.indexCatalog.set(syntheticName, {
        name: syntheticName,
        table,
        columns: normalizedColumns,
        type: "HASH",
        unique: true,
        status: "ACTIVE",
      });
    }
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
      vals.push(this.encodeTypedKey(v as SqlPrimitive, `constraint.unique:${c}`));
    }
    return vals.join("||");
  }

  private ensureUniqueIndexMaps(table: string): void {
    const schema = this.schemas.get(table);
    if (!schema) return;
    if (this.getUniqueIndexesForTable(table)) return;

    const idxMap = new Map<string, Map<string, SqlRow>>();
    for (const g of this.getUniqueGroups(table, schema)) {
      idxMap.set(this.uniqueGroupName(g), new Map<string, SqlRow>());
    }
    this.setUniqueIndexesForTable(table, idxMap);
  }

  private rebuildUniqueIndexes(table: string): void {
    const schema = this.schemas.get(table);
    if (!schema) {
      const staged = this.getStagedTableWriteSet(table);
      if (staged) staged.uniqueIndexes = new Map<string, Map<string, SqlRow>>();
      else this.uniqueIndexes.delete(table);
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
    this.setUniqueIndexesForTable(table, idxMap);
    this.bumpConstraintCost(table, { rebuildOps: 1 });
  }

  private addRowToUniqueIndexes(table: string, row: SqlRow): void {
    const schema = this.schemas.get(table);
    if (!schema) return;
    this.ensureUniqueIndexMaps(table);
    const idxMap = this.getUniqueIndexesForTable(table);
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
    const idxMap = this.getUniqueIndexesForTable(table);
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

  private parseInsert(sql: string): { row: SqlRow; bindings: BoundColumnValues } {
    const m = sql.match(/INSERT INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\((.+)\)\s*VALUES\s*\((.+)\)/i);
    if (!m) throw sqlError("ERR_UNSUPPORTED_INSERT", sql);
    const table = m[1]!;
    const cols = this.splitTopLevelComma(m[2]).map((c) => c.trim());
    const vals = this.smartSplit(m[3]).map((v) => this.castValue(v));
    if (cols.length !== vals.length) throw sqlError("ERR_UNSUPPORTED_INSERT", "INSERT column/value mismatch");
    const row: SqlRow = {};
    const bindings: BoundColumnValues = {};
    cols.forEach((c, i) => {
      const rawValue = (vals[i] ?? null) as SqlPrimitive;
      row[c] = rawValue;
      try {
        const bound = fromLiteral(rawValue, undefined, {}, `dml.insert.value:${table}.${c}`);
        bindings[c] = bound;
      } catch {
        // Invalid literal shape will be re-validated against column type in applySchemaOnWrite.
      }
    });
    return { row, bindings };
  }

  private planUpdate(sql: string): UpdatePlan {
    const joinM = sql.match(
      /^UPDATE\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?\s+(?:(INNER|LEFT|RIGHT|FULL)(?:\s+OUTER)?\s+)?JOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?\s+ON\s+([a-zA-Z_][a-zA-Z0-9_\.]*)\s*=\s*([a-zA-Z_][a-zA-Z0-9_\.]*)\s+SET\s+([a-zA-Z_][a-zA-Z0-9_\.]*)\s*=\s*(.+?)(?:\s+WHERE\s+(.+))?$/i,
    );
    if (joinM) {
      const leftTable = joinM[1]!.trim();
      const leftAlias = joinM[2]?.trim() || leftTable;
      const joinType = (joinM[3]?.trim().toUpperCase() || "INNER") as "INNER" | "LEFT" | "RIGHT" | "FULL";
      const rightTable = joinM[4]!.trim();
      const rightAlias = joinM[5]?.trim() || rightTable;
      this.assertJoinAliasSafety(leftTable, leftAlias, rightTable, rightAlias, "update", sql);
      return {
        table: joinM[1]!.trim(),
        setField: joinM[8]!.trim(),
        setValue: this.trimQuoted(joinM[9]!.trim()),
        whereExpr: joinM[10]?.trim() ?? "1 = 1",
        joinAware: true,
        join: {
          type: joinType,
          table: joinM[4]!.trim(),
          leftAlias: joinM[2]?.trim() || joinM[1]!.trim(),
          rightAlias: joinM[5]?.trim() || joinM[4]!.trim(),
          leftField: joinM[6]!.trim(),
          rightField: joinM[7]!.trim(),
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
    const joinM = sql.match(
      /^DELETE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?\s+(?:(INNER|LEFT|RIGHT|FULL)(?:\s+OUTER)?\s+)?JOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?\s+ON\s+([a-zA-Z_][a-zA-Z0-9_\.]*)\s*=\s*([a-zA-Z_][a-zA-Z0-9_\.]*)\s*(?:WHERE\s+(.+))?$/i,
    );
    if (joinM) {
      const targetAlias = joinM[1]!.trim();
      const leftTable = joinM[2]!.trim();
      const leftAlias = joinM[3]?.trim() || leftTable;
      const joinType = (joinM[4]?.trim().toUpperCase() || "INNER") as "INNER" | "LEFT" | "RIGHT" | "FULL";
      const rightTable = joinM[5]!.trim();
      const rightAlias = joinM[6]?.trim() || rightTable;
      this.assertJoinAliasSafety(leftTable, leftAlias, rightTable, rightAlias, "delete", sql);
      if (targetAlias.toUpperCase() !== leftTable.toUpperCase() && targetAlias.toUpperCase() !== leftAlias.toUpperCase()) {
        throw sqlError("ERR_UNSUPPORTED_DELETE", `DELETE target must equal left table/alias: ${sql}`);
      }
      return {
        table: leftTable,
        whereExpr: joinM[9]?.trim() ?? "1 = 1",
        joinAware: true,
        join: {
          type: joinType,
          table: joinM[5]!.trim(),
          leftAlias,
          rightAlias: joinM[6]?.trim() || joinM[5]!.trim(),
          leftField: joinM[7]!.trim(),
          rightField: joinM[8]!.trim(),
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
    if (s === "*") return true;

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

  private inferSetOpColumns(selectSql: string): string[] | undefined {
    const ast = parseSqlToAst(selectSql, { dialect: this.opts.dialect ?? "ansi" });
    if (ast.kind === "union" || ast.kind === "intersect" || ast.kind === "except") return this.inferSetOpColumns(ast.leftSql);
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

  private inferSetOpArity(selectSql: string): number | undefined {
    const ast = parseSqlToAst(selectSql, { dialect: this.opts.dialect ?? "ansi" });
    if (ast.kind === "select") return ast.selectItems.length;
    if (ast.kind !== "union" && ast.kind !== "intersect" && ast.kind !== "except") return undefined;

    const setOpToken = ast.kind === "union" ? "UNION" : ast.kind === "intersect" ? "INTERSECT" : "EXCEPT";
    const left = this.inferSetOpArity(ast.leftSql);
    const right = this.inferSetOpArity(ast.rightSql);
    this.assertSetOpArityCompatible(left, right, setOpToken);
    return left ?? right;
  }

  private inferRuntimeProjectionColumns(rows: SqlRow[]): string[] | undefined {
    if (!rows.length) return undefined;
    const [first] = rows;
    if (!first) return undefined;
    return Object.keys(first);
  }

  private assertSetOpArityCompatible(left?: number, right?: number, setOpToken: "UNION" | "INTERSECT" | "EXCEPT" = "UNION"): void {
    if (left === undefined || right === undefined) return;
    if (left === right) return;
    throw createSqlError("SQL_SEMANTIC_TYPE_MISMATCH", {
      message: `${setOpToken} branches must project the same number of columns (left=${left}, right=${right})`,
      token: setOpToken,
    });
  }

  private normalizeSetOpRow(row: SqlRow, columns: string[], setOpToken: "UNION" | "INTERSECT" | "EXCEPT" = "UNION"): SqlRow {
    const values = Object.values(row);
    if (values.length !== columns.length) {
      throw createSqlError("SQL_SEMANTIC_TYPE_MISMATCH", {
        message: `${setOpToken} branch row width mismatch: expected ${columns.length} columns but got ${values.length}`,
        token: setOpToken,
      });
    }

    const out: SqlRow = {};
    columns.forEach((col, idx) => {
      out[col] = values[idx] ?? null;
    });
    return out;
  }

  private combineUnionRows(leftRows: SqlRow[], rightRows: SqlRow[], all: boolean): SqlRow[] {
    if (all) return [...leftRows, ...rightRows];

    const dedup = new Map<string, SqlRow>();
    for (const row of [...leftRows, ...rightRows]) {
      dedup.set(this.makeRowKey(row), row);
    }
    return [...dedup.values()];
  }

  private combineIntersectRows(leftRows: SqlRow[], rightRows: SqlRow[], all: boolean): SqlRow[] {
    if (all) {
      const rightCounts = new Map<string, number>();
      for (const row of rightRows) {
        const key = this.makeRowKey(row);
        rightCounts.set(key, (rightCounts.get(key) ?? 0) + 1);
      }

      const out: SqlRow[] = [];
      for (const row of leftRows) {
        const key = this.makeRowKey(row);
        const remaining = rightCounts.get(key) ?? 0;
        if (remaining <= 0) continue;
        out.push(row);
        if (remaining === 1) rightCounts.delete(key);
        else rightCounts.set(key, remaining - 1);
      }
      return out;
    }

    const rightKeys = new Set(rightRows.map((row) => this.makeRowKey(row)));
    const out: SqlRow[] = [];
    const emitted = new Set<string>();
    for (const row of leftRows) {
      const key = this.makeRowKey(row);
      if (!rightKeys.has(key) || emitted.has(key)) continue;
      emitted.add(key);
      out.push(row);
    }
    return out;
  }

  private combineExceptRows(leftRows: SqlRow[], rightRows: SqlRow[], all: boolean): SqlRow[] {
    if (all) {
      const rightCounts = new Map<string, number>();
      for (const row of rightRows) {
        const key = this.makeRowKey(row);
        rightCounts.set(key, (rightCounts.get(key) ?? 0) + 1);
      }

      const out: SqlRow[] = [];
      for (const row of leftRows) {
        const key = this.makeRowKey(row);
        const remaining = rightCounts.get(key) ?? 0;
        if (remaining > 0) {
          if (remaining === 1) rightCounts.delete(key);
          else rightCounts.set(key, remaining - 1);
          continue;
        }
        out.push(row);
      }
      return out;
    }

    const rightKeys = new Set(rightRows.map((row) => this.makeRowKey(row)));
    const out: SqlRow[] = [];
    const emitted = new Set<string>();
    for (const row of leftRows) {
      const key = this.makeRowKey(row);
      if (rightKeys.has(key) || emitted.has(key)) continue;
      emitted.add(key);
      out.push(row);
    }
    return out;
  }

  private splitSelectTail(sql: string, setOpToken: "UNION" | "INTERSECT" | "EXCEPT" = "UNION"): {
    baseSql: string;
    orderByList?: Array<{ field: string; direction: "ASC" | "DESC" }>;
    limit?: number;
    offset?: number;
  } {
    const ast = parseSqlToAst(sql, { dialect: this.opts.dialect ?? "ansi" });
    if (ast.kind !== "select") {
      throw createSqlError("SQL_DIALECT_UNSUPPORTED_SYNTAX", {
        message: `${setOpToken} right branch must be a SELECT statement for tail planning`,
        token: setOpToken,
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
                message: `Unable to render ORDER BY expression in ${setOpToken} tail`,
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

  private resolveJoinFieldValue(row: SqlRow, field: string): SqlPrimitive | undefined {
    const trimmed = field.trim();
    if (!trimmed) return undefined;
    if (Object.prototype.hasOwnProperty.call(row, trimmed)) return row[trimmed] as SqlPrimitive;

    const parts = trimmed.split(".");
    const unqualified = parts.at(-1) ?? trimmed;
    if (Object.prototype.hasOwnProperty.call(row, unqualified)) return row[unqualified] as SqlPrimitive;
    return undefined;
  }

  private toJoinComparableKey(value: SqlPrimitive | undefined, sourceContext: string): string | null {
    if (value === null || value === undefined) return null;
    return this.encodeTypedKey(value, sourceContext);
  }

  private mergeJoinedRows(leftTable: string, leftRow: SqlRow, rightTable: string, rightRow: SqlRow): SqlRow {
    const merged: SqlRow = {};
    for (const [k, v] of Object.entries(leftRow)) {
      merged[k] = v;
      merged[`${leftTable}.${k}`] = v;
    }
    for (const [k, v] of Object.entries(rightRow)) {
      merged[`${rightTable}.${k}`] = v;
      if (!(k in merged)) merged[k] = v;
    }
    return merged;
  }

  private mergeUnmatchedLeftRow(leftTable: string, leftRow: SqlRow): SqlRow {
    const merged: SqlRow = {};
    for (const [k, v] of Object.entries(leftRow)) {
      merged[k] = v;
      merged[`${leftTable}.${k}`] = v;
    }
    return merged;
  }

  private mergeUnmatchedRightRow(rightTable: string, rightRow: SqlRow): SqlRow {
    const merged: SqlRow = {};
    for (const [k, v] of Object.entries(rightRow)) {
      merged[`${rightTable}.${k}`] = v;
      if (!(k in merged)) merged[k] = v;
    }
    return merged;
  }

  private applyNestedLoopJoin(
    leftTable: string,
    leftRows: SqlRow[],
    join: NonNullable<ParsedSelect["join"]>,
  ): SqlRow[] {
    const rightRows = this.requireTable(join.table);
    const out: SqlRow[] = [];
    const matchedRightIndexes = new Set<number>();

    for (const leftRow of leftRows) {
      let matched = false;
      for (let ri = 0; ri < rightRows.length; ri++) {
        const rightRow = rightRows[ri]!;
        const leftVal = this.resolveJoinFieldValue(leftRow, join.leftField);
        const rightVal = this.resolveJoinFieldValue(rightRow, join.rightField);
        if (!this.joinKeyEqual(leftVal, rightVal)) continue;
        matched = true;
        matchedRightIndexes.add(ri);
        out.push(this.mergeJoinedRows(leftTable, leftRow, join.table, rightRow));
      }

      if (!matched && (join.type === "LEFT" || join.type === "FULL")) {
        out.push(this.mergeUnmatchedLeftRow(leftTable, leftRow));
      }
    }

    if (join.type === "FULL") {
      for (let ri = 0; ri < rightRows.length; ri++) {
        if (matchedRightIndexes.has(ri)) continue;
        out.push(this.mergeUnmatchedRightRow(join.table, rightRows[ri]!));
      }
    }

    return out;
  }

  private applyHashJoin(
    leftTable: string,
    leftRows: SqlRow[],
    join: NonNullable<ParsedSelect["join"]>,
  ): SqlRow[] {
    const rightRows = this.requireTable(join.table);
    const rightIndex = new Map<string, number[]>();

    for (let ri = 0; ri < rightRows.length; ri++) {
      const key = this.toJoinComparableKey(
        this.resolveJoinFieldValue(rightRows[ri]!, join.rightField),
        "join.hash.right",
      );
      if (key === null) continue;
      const bucket = rightIndex.get(key);
      if (bucket) bucket.push(ri);
      else rightIndex.set(key, [ri]);
    }

    const out: SqlRow[] = [];
    const matchedRightIndexes = new Set<number>();

    for (const leftRow of leftRows) {
      let matched = false;
      const key = this.toJoinComparableKey(
        this.resolveJoinFieldValue(leftRow, join.leftField),
        "join.hash.left",
      );
      const rightHits = key === null ? undefined : rightIndex.get(key);
      if (rightHits?.length) {
        for (const ri of rightHits) {
          matched = true;
          matchedRightIndexes.add(ri);
          out.push(this.mergeJoinedRows(leftTable, leftRow, join.table, rightRows[ri]!));
        }
      }

      if (!matched && (join.type === "LEFT" || join.type === "FULL")) {
        out.push(this.mergeUnmatchedLeftRow(leftTable, leftRow));
      }
    }

    if (join.type === "FULL") {
      for (let ri = 0; ri < rightRows.length; ri++) {
        if (matchedRightIndexes.has(ri)) continue;
        out.push(this.mergeUnmatchedRightRow(join.table, rightRows[ri]!));
      }
    }

    return out;
  }

  private applySortMergeJoin(
    leftTable: string,
    leftRows: SqlRow[],
    join: NonNullable<ParsedSelect["join"]>,
  ): SqlRow[] {
    const rightRows = this.requireTable(join.table);
    type JoinEntry = { key: string; rowIndex: number };

    const leftEntries: JoinEntry[] = [];
    for (let li = 0; li < leftRows.length; li++) {
      const key = this.toJoinComparableKey(
        this.resolveJoinFieldValue(leftRows[li]!, join.leftField),
        "join.merge.left",
      );
      if (key !== null) leftEntries.push({ key, rowIndex: li });
    }

    const rightEntries: JoinEntry[] = [];
    for (let ri = 0; ri < rightRows.length; ri++) {
      const key = this.toJoinComparableKey(
        this.resolveJoinFieldValue(rightRows[ri]!, join.rightField),
        "join.merge.right",
      );
      if (key !== null) rightEntries.push({ key, rowIndex: ri });
    }

    leftEntries.sort((a, b) => (a.key === b.key ? a.rowIndex - b.rowIndex : a.key.localeCompare(b.key)));
    rightEntries.sort((a, b) => (a.key === b.key ? a.rowIndex - b.rowIndex : a.key.localeCompare(b.key)));

    const matchesByLeft = new Map<number, number[]>();
    const matchedRightIndexes = new Set<number>();

    let li = 0;
    let ri = 0;
    while (li < leftEntries.length && ri < rightEntries.length) {
      const leftEntry = leftEntries[li]!;
      const rightEntry = rightEntries[ri]!;
      const cmp = leftEntry.key.localeCompare(rightEntry.key);

      if (cmp < 0) {
        li += 1;
        continue;
      }
      if (cmp > 0) {
        ri += 1;
        continue;
      }

      let liEnd = li + 1;
      while (liEnd < leftEntries.length && leftEntries[liEnd]!.key === leftEntry.key) liEnd += 1;
      let riEnd = ri + 1;
      while (riEnd < rightEntries.length && rightEntries[riEnd]!.key === rightEntry.key) riEnd += 1;

      const rightGroupIndexes = rightEntries.slice(ri, riEnd).map((entry) => entry.rowIndex);
      for (let leftIdx = li; leftIdx < liEnd; leftIdx++) {
        const leftRowIndex = leftEntries[leftIdx]!.rowIndex;
        const bucket = matchesByLeft.get(leftRowIndex) ?? [];
        for (const rightRowIndex of rightGroupIndexes) {
          bucket.push(rightRowIndex);
          matchedRightIndexes.add(rightRowIndex);
        }
        matchesByLeft.set(leftRowIndex, bucket);
      }

      li = liEnd;
      ri = riEnd;
    }

    const out: SqlRow[] = [];
    for (let leftRowIndex = 0; leftRowIndex < leftRows.length; leftRowIndex++) {
      const leftRow = leftRows[leftRowIndex]!;
      const rightHits = matchesByLeft.get(leftRowIndex);
      if (rightHits?.length) {
        for (const rightRowIndex of rightHits) {
          out.push(this.mergeJoinedRows(leftTable, leftRow, join.table, rightRows[rightRowIndex]!));
        }
        continue;
      }
      if (join.type === "LEFT" || join.type === "FULL") {
        out.push(this.mergeUnmatchedLeftRow(leftTable, leftRow));
      }
    }

    if (join.type === "FULL") {
      for (let rightRowIndex = 0; rightRowIndex < rightRows.length; rightRowIndex++) {
        if (matchedRightIndexes.has(rightRowIndex)) continue;
        out.push(this.mergeUnmatchedRightRow(join.table, rightRows[rightRowIndex]!));
      }
    }

    return out;
  }

  private applyJoin(
    leftTable: string,
    leftRows: SqlRow[],
    join: NonNullable<ParsedSelect["join"]>,
    algorithm: JoinExecutionAlgorithm = "NESTED_LOOP",
  ): SqlRow[] {
    if (join.type === "RIGHT") {
      const syntheticLeftRows = this.requireTable(join.table);
      const syntheticJoin: NonNullable<ParsedSelect["join"]> = {
        type: "LEFT",
        table: leftTable,
        leftField: join.rightField,
        rightField: join.leftField,
      };
      return this.applyJoin(join.table, syntheticLeftRows, syntheticJoin, algorithm);
    }

    if (algorithm === "HASH_JOIN") return this.applyHashJoin(leftTable, leftRows, join);
    if (algorithm === "SORT_MERGE_JOIN") return this.applySortMergeJoin(leftTable, leftRows, join);
    return this.applyNestedLoopJoin(leftTable, leftRows, join);
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

    const cmpSubqueryTopLevel = this.findTopLevelComparator(expr);
    if (cmpSubqueryTopLevel) {
      const rightSubquery = cmpSubqueryTopLevel.right.trim().match(/^\(\s*(SELECT\s+.+)\s*\)$/i);
      if (rightSubquery) {
        const leftParsed = this.parseFieldExpr(cmpSubqueryTopLevel.left);
        return {
          field: leftParsed.field,
          valueExpr: leftParsed.valueExpr,
          op: cmpSubqueryTopLevel.op as CompareOp,
          subquerySql: rightSubquery[1]!.trim(),
        };
      }
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
    const plan = this.getParsedSubqueryPlan(normalized);
    const stats = this.getOrCreateSubqueryStats(normalized);
    const correlated = plan.outerRefs.length > 0;

    stats.executions += 1;
    if (correlated) stats.correlatedExecutions += 1;

    const cacheKey = this.buildSubqueryResultCacheKey(plan, outerRow);
    const cached = this.subqueryRuntime?.resultCache.get(cacheKey);
    if (cached) {
      stats.cacheHits += 1;
      stats.rowsReturned += cached.length;
      return this.deepCloneRows(cached);
    }
    stats.cacheMisses += 1;

    const sourceRows = this.requireTable(plan.table);
    const matchedInnerRows: SqlRow[] = [];
    const matchedEvalRows: SqlRow[] = [];
    for (const innerRow of sourceRows) {
      this.consumeSubqueryCost(stats, correlated, normalized);
      const evalRow = this.buildSubqueryEvalRow(innerRow, plan.table, plan.tableAlias, outerRow);
      if (plan.whereTree && this.evaluateWhereTree(evalRow, plan.whereTree) !== "TRUE") continue;
      matchedInnerRows.push({ ...innerRow });
      matchedEvalRows.push(evalRow);
    }

    if (plan.fieldExpr === "*") {
      stats.rowsReturned += matchedInnerRows.length;
      this.storeSubqueryResultCache(cacheKey, matchedInnerRows);
      return this.deepCloneRows(matchedInnerRows);
    }

    const aggMatch = plan.fieldExpr.match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\((\*|[a-zA-Z_][a-zA-Z0-9_\.]*)\)(?:\s+AS\s+([a-zA-Z_][a-zA-Z0-9_\.]*))?$/i,
    );
    if (aggMatch) {
      const fn = aggMatch[1]!.toUpperCase();
      const aggField = aggMatch[2]!;
      const alias = aggMatch[3] ?? fn.toLowerCase();

      if (fn === "COUNT") {
        const count = aggField === "*"
          ? matchedEvalRows.length
          : matchedEvalRows.filter((r) => {
              const value = this.resolveRowValue(r, aggField);
              return value !== null && value !== undefined;
            }).length;
        const out = [{ [alias]: count }];
        stats.rowsReturned += out.length;
        this.storeSubqueryResultCache(cacheKey, out);
        return this.deepCloneRows(out);
      }

      const nums = matchedEvalRows
        .map((r) => Number(this.resolveRowValue(r, aggField)))
        .filter((n) => Number.isFinite(n));

      let out: SqlRow[] | null = null;
      if (fn === "SUM") out = [{ [alias]: nums.length ? nums.reduce((a, b) => a + b, 0) : null }];
      else if (fn === "AVG") out = [{ [alias]: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null }];
      else if (fn === "MIN") out = [{ [alias]: nums.length ? Math.min(...nums) : null }];
      else if (fn === "MAX") out = [{ [alias]: nums.length ? Math.max(...nums) : null }];
      if (out) {
        stats.rowsReturned += out.length;
        this.storeSubqueryResultCache(cacheKey, out);
        return this.deepCloneRows(out);
      }
    }

    const fields = this.splitTopLevelComma(plan.fieldExpr).map((x) => x.trim()).filter(Boolean);
    const projected = matchedEvalRows.map((row) => {
      const out: SqlRow = {};
      for (const f of fields) out[f] = this.evalExpr(row, f) ?? null;
      return out;
    });
    stats.rowsReturned += projected.length;
    this.storeSubqueryResultCache(cacheKey, projected);
    return this.deepCloneRows(projected);
  }

  private parseSubqueryExistsValue(subquerySql: string, outerRow?: SqlRow): boolean {
    const normalized = subquerySql.trim().replace(/\s+/g, " ");
    const plan = this.getParsedSubqueryPlan(normalized);
    const aggMatch = plan.fieldExpr.match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\((\*|[a-zA-Z_][a-zA-Z0-9_\.]*)\)(?:\s+AS\s+([a-zA-Z_][a-zA-Z0-9_\.]*))?$/i,
    );
    if (aggMatch) {
      const fn = aggMatch[1]!.toUpperCase();
      if (fn === "COUNT" || fn === "SUM" || fn === "AVG" || fn === "MIN" || fn === "MAX") {
        return this.parseSubquerySelect(normalized, outerRow).length > 0;
      }
    }

    const stats = this.getOrCreateSubqueryStats(normalized);
    const correlated = plan.outerRefs.length > 0;

    stats.executions += 1;
    if (correlated) stats.correlatedExecutions += 1;

    const cacheKey = `${this.buildSubqueryResultCacheKey(plan, outerRow)}::EXISTS`;
    const cached = this.subqueryRuntime?.resultCache.get(cacheKey);
    if (cached) {
      stats.cacheHits += 1;
      stats.rowsReturned += cached.length;
      return cached.length > 0;
    }
    stats.cacheMisses += 1;

    const sourceRows = this.requireTable(plan.table);
    for (const innerRow of sourceRows) {
      this.consumeSubqueryCost(stats, correlated, normalized);
      const evalRow = this.buildSubqueryEvalRow(innerRow, plan.table, plan.tableAlias, outerRow);
      if (plan.whereTree && this.evaluateWhereTree(evalRow, plan.whereTree) !== "TRUE") continue;

      const existsRow: SqlRow[] = [{ __exists: 1 }];
      stats.rowsReturned += existsRow.length;
      this.storeSubqueryResultCache(cacheKey, existsRow);
      return true;
    }

    this.storeSubqueryResultCache(cacheKey, []);
    return false;
  }

  private assertSubquerySingleColumnProjection(plan: ParsedSubqueryPlan, subquerySql: string): void {
    const fieldExpr = plan.fieldExpr.trim();
    if (fieldExpr === "*") {
      const schema = this.schemas.get(plan.table);
      const projectedCount = schema?.columns.length
        ?? (() => {
          const first = this.tables.get(plan.table)?.[0];
          return first ? Object.keys(first).length : undefined;
        })();
      if (projectedCount !== undefined && projectedCount !== 1) {
        throw sqlError("ERR_UNSUPPORTED_SUBQUERY", `Subquery must return exactly 1 column: ${subquerySql}`);
      }
      return;
    }

    const projectedFields = this.splitTopLevelComma(fieldExpr).map((x) => x.trim()).filter(Boolean);
    if (projectedFields.length !== 1) {
      throw sqlError("ERR_UNSUPPORTED_SUBQUERY", `Subquery must return exactly 1 column: ${subquerySql}`);
    }
  }

  private parseSubqueryValues(subquerySql: string, field?: string, outerRow?: SqlRow): SqlPrimitive[] {
    const normalized = subquerySql.trim().replace(/\s+/g, " ");
    const plan = this.getParsedSubqueryPlan(normalized);
    if (!field) this.assertSubquerySingleColumnProjection(plan, normalized);

    const rows = this.parseSubquerySelect(normalized, outerRow);
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

  private parseScalarSubqueryValue(subquerySql: string, outerRow?: SqlRow): SqlPrimitive {
    const rows = this.parseSubquerySelect(subquerySql, outerRow);
    if (!rows.length) return null;
    if (rows.length > 1) {
      throw sqlError("ERR_UNSUPPORTED_SUBQUERY", `Scalar subquery must return exactly 1 row: ${subquerySql}`);
    }

    const firstRow = rows[0]!;
    const keys = Object.keys(firstRow);
    if (keys.length !== 1) {
      throw sqlError("ERR_UNSUPPORTED_SUBQUERY", `Scalar subquery must return exactly 1 column: ${subquerySql}`);
    }
    const key = keys[0]!;
    return (firstRow[key] ?? null) as SqlPrimitive;
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
      const [leftTyped, rightTyped] = this.normalizeComparableTypedPair(a, b, "expr.nullif");
      const eq = typedValueComparator.eq(leftTyped, rightTyped);
      return eq === true ? null : a;
    }

    let castValueExpr: string | undefined;
    let castTypeExpr: string | undefined;

    const castAsMatch = expr.match(/^CAST\((.+)\s+AS\s+([A-Z]+)\)$/i);
    if (castAsMatch) {
      castValueExpr = castAsMatch[1]!;
      castTypeExpr = castAsMatch[2]!;
    } else {
      const castFnMatch = expr.match(/^CAST\((.+)\)$/i);
      if (castFnMatch) {
        const parts = this.smartSplit(castFnMatch[1]!);
        if (parts.length === 2) {
          castValueExpr = parts[0]!;
          castTypeExpr = this.trimQuoted(parts[1]!.trim());
        }
      }
    }

    if (castValueExpr && castTypeExpr) {
      const v = this.evalExpr(row, castValueExpr);
      const normalizedTarget = normalizeRuntimeTypeName(castTypeExpr);
      if (!normalizedTarget || normalizedTarget === "NULL") {
        throw sqlError("ERR_TYPE_CONSTRAINT", `unsupported CAST target: ${castTypeExpr}`);
      }
      if (v === null || v === undefined) return null;
      try {
        let castSource: SqlPrimitive = v;
        if (
          typeof castSource === "number"
          && Number.isFinite(castSource)
          && (normalizedTarget === "SMALLINT"
            || normalizedTarget === "INT"
            || normalizedTarget === "BIGINT"
            || normalizedTarget === "U64")
        ) {
          castSource = Math.trunc(castSource);
        }
        const casted = convertTypedValue(
          fromJs(castSource, undefined, {}, `expr.cast.source:${castValueExpr}`),
          normalizedTarget,
          {
            mode: "explicit",
            sourceContext: `expr.cast.target:${normalizedTarget}`,
          },
        );
        return casted.value;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/CAST .* not allowed/i.test(msg)) {
          throw sqlError("ERR_TYPE_CONSTRAINT", msg);
        }
        throw sqlError("ERR_TYPE_CONSTRAINT", `invalid CAST to ${normalizedTarget}: ${String(v)}`);
      }
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

  private encodeTypedKey(value: SqlPrimitive | undefined, sourceContext: string): string {
    const typed = fromStorage((value ?? null) as SqlPrimitive, undefined, {}, sourceContext);
    return JSON.stringify({ type: typed.type, value: typed.value });
  }

  private joinKeyEqual(left: SqlPrimitive | undefined, right: SqlPrimitive | undefined): boolean {
    if (left === null || left === undefined || right === null || right === undefined) return false;
    return (
      this.encodeTypedKey(left, "join.key.left")
      === this.encodeTypedKey(right, "join.key.right")
    );
  }

  private normalizeComparableTypedPair(
    left: SqlPrimitive | undefined,
    right: SqlPrimitive | undefined,
    sourceContext: string,
  ): [SqlTypedValue, SqlTypedValue] {
    let leftTyped = fromStorage((left ?? null) as SqlPrimitive, undefined, {}, `${sourceContext}.left`);
    let rightTyped = fromJs((right ?? null) as SqlPrimitive, undefined, {}, `${sourceContext}.right`);
    if (leftTyped.value === null || rightTyped.value === null || leftTyped.type === rightTyped.type) {
      return [leftTyped, rightTyped];
    }

    try {
      rightTyped = convertTypedValue(rightTyped, leftTyped.type, {
        mode: "implicit",
        sourceContext: `${sourceContext}.right->left`,
      });
      return [leftTyped, rightTyped];
    } catch {
      // Try opposite conversion direction first; final fallback is TEXT/TEXT compare.
    }

    try {
      leftTyped = convertTypedValue(leftTyped, rightTyped.type, {
        mode: "implicit",
        sourceContext: `${sourceContext}.left->right`,
      });
      return [leftTyped, rightTyped];
    } catch {
      // Convert both sides to TEXT for a deterministic typed fallback path.
    }

    leftTyped = convertTypedValue(leftTyped, SqlRuntimeType.TEXT, {
      mode: "explicit",
      sourceContext: `${sourceContext}.left->text`,
    });
    rightTyped = convertTypedValue(rightTyped, SqlRuntimeType.TEXT, {
      mode: "explicit",
      sourceContext: `${sourceContext}.right->text`,
    });
    return [leftTyped, rightTyped];
  }

  private compareByOp(left: SqlPrimitive | undefined, right: SqlPrimitive | undefined, op: ComparePredicate): TruthValue {
    const toTruthValue = (value: boolean | null): TruthValue => {
      if (value === null) return "UNKNOWN";
      return value ? "TRUE" : "FALSE";
    };

    const [leftTyped, rightTyped] = this.normalizeComparableTypedPair(left, right, `predicate.compare.${op}`);
    switch (op) {
      case "=":
        return toTruthValue(typedValueComparator.eq(leftTyped, rightTyped));
      case "!=":
      case "<>": {
        const eq = typedValueComparator.eq(leftTyped, rightTyped);
        return toTruthValue(eq === null ? null : !eq);
      }
      case ">":
        return toTruthValue(typedValueComparator.gt(leftTyped, rightTyped));
      case "<":
        return toTruthValue(typedValueComparator.lt(leftTyped, rightTyped));
      case ">=":
        return toTruthValue(typedValueComparator.gte(leftTyped, rightTyped));
      case "<=":
        return toTruthValue(typedValueComparator.lte(leftTyped, rightTyped));
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
      const exists = this.parseSubqueryExistsValue(subquerySql, row);
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
      ? this.parseScalarSubqueryValue(clause.subquerySql, row)
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
        const leftTyped = convertTypedValue(
          fromStorage((left ?? null) as SqlPrimitive, undefined, {}, "predicate.like.left"),
          SqlRuntimeType.TEXT,
          { mode: "explicit", sourceContext: "predicate.like.left" },
        );
        const rightTyped = convertTypedValue(
          fromJs((right ?? null) as SqlPrimitive, undefined, {}, "predicate.like.right"),
          SqlRuntimeType.TEXT,
          { mode: "explicit", sourceContext: "predicate.like.right" },
        );
        const regex = this.likeToRegex(String(rightTyped.value ?? ""), clause.likeEscape);
        const matched = new RegExp(regex, "i").test(String(leftTyped.value ?? ""));
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
        const [leftTyped, rightTyped] = this.normalizeComparableTypedPair(left, right, "predicate.isDistinctFrom");
        return typedValueComparator.eq(leftTyped, rightTyped) === true ? "FALSE" : "TRUE";
      }
      case "IS_NOT_DISTINCT_FROM": {
        if (left == null && right == null) return "TRUE";
        if (left == null || right == null) return "FALSE";
        const [leftTyped, rightTyped] = this.normalizeComparableTypedPair(left, right, "predicate.isNotDistinctFrom");
        return typedValueComparator.eq(leftTyped, rightTyped) === true ? "TRUE" : "FALSE";
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

    const [leftTyped, rightTyped] = this.normalizeComparableTypedPair(a, b, "order.key");
    const lt = typedValueComparator.lt(leftTyped, rightTyped);
    if (lt === true) return direction === "DESC" ? 1 : -1;
    const gt = typedValueComparator.gt(leftTyped, rightTyped);
    if (gt === true) return direction === "DESC" ? -1 : 1;
    return 0;
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
      const key = groupBy.map((g) => this.encodeTypedKey(row[g], `group.key:${g}`)).join("||");
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
      if (!aggregateField || aggregateField === "*") return { count: rows.length };
      return {
        count: rows.filter((r) => r[aggregateField] !== null && r[aggregateField] !== undefined).length,
      };
    }

    if (!aggregateField || aggregateField === "*") {
      throw sqlError("ERR_UNSUPPORTED_SELECT", `${aggregate} requires a numeric field`);
    }

    const typedNums = rows
      .map((r) => r[aggregateField])
      .filter((v) => v !== null && v !== undefined)
      .map((v) => fromStorage((v ?? null) as SqlPrimitive, undefined, {}, `aggregate.source:${aggregateField}`))
      .map((typed) => {
        try {
          return convertTypedValue(typed, SqlRuntimeType.DOUBLE, {
            mode: "explicit",
            sourceContext: `aggregate.numeric:${aggregateField}`,
          });
        } catch {
          return null;
        }
      })
      .filter((typed): typed is NonNullable<typeof typed> => typed !== null && typed.value !== null);

    if (aggregate === "SUM") {
      if (!typedNums.length) return { sum: null };
      let state = typedNums[0]!;
      for (let i = 1; i < typedNums.length; i++) {
        state = typedValueOperators.add(state, typedNums[i]!);
      }
      return { sum: state.value as SqlPrimitive };
    }

    if (aggregate === "AVG") {
      if (!typedNums.length) return { avg: null };
      let sumState = typedNums[0]!;
      for (let i = 1; i < typedNums.length; i++) {
        sumState = typedValueOperators.add(sumState, typedNums[i]!);
      }
      const divisor = fromJs(typedNums.length, SqlRuntimeType.INT, {}, `aggregate.avg.divisor:${aggregateField}`);
      const avg = typedValueOperators.div(sumState, divisor);
      return { avg: avg.value as SqlPrimitive };
    }

    if (aggregate === "MIN") {
      if (!typedNums.length) return { min: null };
      let state = typedNums[0]!;
      for (let i = 1; i < typedNums.length; i++) {
        const lt = typedValueComparator.lt(typedNums[i]!, state);
        if (lt === true) state = typedNums[i]!;
      }
      return { min: state.value as SqlPrimitive };
    }

    if (!typedNums.length) return { max: null };
    let state = typedNums[0]!;
    for (let i = 1; i < typedNums.length; i++) {
      const gt = typedValueComparator.gt(typedNums[i]!, state);
      if (gt === true) state = typedNums[i]!;
    }
    return { max: state.value as SqlPrimitive };
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
        acc[k] = this.encodeTypedKey(row[k], `distinct.key:${k}`);
        return acc;
      }, {} as Record<string, string>);
    return JSON.stringify(ordered);
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
