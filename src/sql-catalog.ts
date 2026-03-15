import type { SqlRow, SqlRuntimeTypeName } from "./types.js";

export type SqlTypeName = Exclude<SqlRuntimeTypeName, "NULL">;

export type ColumnTypeSpec = {
  name: SqlTypeName;
  length?: number;
  precision?: number;
  scale?: number;
};

export type ColumnSchema = {
  name: string;
  type: ColumnTypeSpec;
  notNull: boolean;
  primaryKey: boolean;
  unique: boolean;
};

export type ForeignKeySpec = {
  columns: string[];
  refTable: string;
  refColumns: string[];
};

export type TableSchema = {
  name: string;
  columns: ColumnSchema[];
  uniqueGroups?: string[][];
  primaryKeyGroup?: string[];
  foreignKeys?: ForeignKeySpec[];
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
