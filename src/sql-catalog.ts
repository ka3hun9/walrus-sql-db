import type { SqlPrimitive, SqlRow, SqlRuntimeTypeName } from "./types.js";

export type SqlTypeName = Exclude<SqlRuntimeTypeName, "NULL">;

export type ColumnTypeSpec = {
  name: SqlTypeName;
  length?: number;
  precision?: number;
  scale?: number;
  /** If set, this column was defined using a domain (for DROP DOMAIN CASCADE) */
  domainName?: string;
};

export type ColumnSchema = {
  name: string;
  type: ColumnTypeSpec;
  notNull: boolean;
  primaryKey: boolean;
  unique: boolean;
  defaultValue?: SqlPrimitive;
};

export type ForeignKeySpec = {
  columns: string[];
  refTable: string;
  refColumns: string[];
  matchRule: "SIMPLE" | "FULL" | "PARTIAL";
  onDelete: "NO ACTION" | "RESTRICT" | "CASCADE" | "SET NULL" | "SET DEFAULT";
  onUpdate: "NO ACTION" | "RESTRICT" | "CASCADE" | "SET NULL" | "SET DEFAULT";
};

export type CheckConstraintSpec = {
  name?: string;
  predicate: string; // raw expression text, evaluated via evalPredicate3VL
};

export type TableSchema = {
  name: string;
  columns: ColumnSchema[];
  uniqueGroups?: string[][];
  primaryKeyGroup?: string[];
  foreignKeys?: ForeignKeySpec[];
  checkConstraints?: CheckConstraintSpec[];
};

export type IndexCatalogType = "HASH" | "BTREE";
export type IndexCatalogStatus = "ACTIVE" | "BUILDING" | "DROPPED";
export type ViewCatalogStatus = "ACTIVE" | "INVALID";

export type IndexCatalogEntry = {
  name: string;
  table: string;
  columns: string[];
  type: IndexCatalogType;
  unique: boolean;
  status: IndexCatalogStatus;
};

export type ViewCatalogEntry = {
  name: string;
  querySql: string;
  status: ViewCatalogStatus;
  dependencies: ViewDependencyEntry[];
  invalidReason?: string;
  invalidatedAt?: number;
  withCheckOption?: boolean;
  // Cached mapping from canonical aggregate key to alias (e.g., "sum" -> "total")
  aggregateAliasMapping?: Map<string, string>;
};

export type ViewDependencyEntry = {
  source: string;
  columns: string[];
};

export type DomainCatalogEntry = {
  name: string;
  baseType: string;
  length?: number;
  precision?: number;
  scale?: number;
  defaultValue?: SqlPrimitive;
  constraints: Array<{ type: "NOT NULL" | "UNIQUE" | "CHECK"; expression?: string }>;
};

export type AssertionCatalogEntry = {
  name: string;
  predicate: string;
  initiallyDeferred: boolean;
};

export type ConstraintIndexCostStats = {
  insertOps: number;
  updateOps: number;
  deleteOps: number;
  rebuildOps: number;
  conflictChecks: number;
  rowsIndexed: number;
};

export function emptyConstraintCostStats(): ConstraintIndexCostStats {
  return {
    insertOps: 0,
    updateOps: 0,
    deleteOps: 0,
    rebuildOps: 0,
    conflictChecks: 0,
    rowsIndexed: 0,
  };
}

export function cloneRows(rows: SqlRow[]): SqlRow[] {
  return rows.map((r) => ({ ...r }));
}
