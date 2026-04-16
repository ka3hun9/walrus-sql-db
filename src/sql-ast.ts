import type { SqlTypedValue } from "./types.js";

export type SqlTransactionAction = "BEGIN" | "COMMIT" | "ROLLBACK";
export type SqlNestedTransactionPolicy = "error_on_nested_begin";

export type SqlAstStatement =
  | SelectStatementAst
  | UnionStatementAst
  | IntersectStatementAst
  | ExceptStatementAst
  | TransactionStatementAst
  | SavepointStatementAst
  | RollbackToSavepointStatementAst
  | ReleaseSavepointStatementAst
  | CreateSchemaStatementAst
  | CreateFunctionStatementAst
  | CreateTriggerStatementAst
  | CreateIndexStatementAst
  | DropIndexStatementAst
  | CreateViewStatementAst
  | DropViewStatementAst
  | InsertStatementAst
  | UpdateStatementAst
  | DeleteStatementAst
  | TruncateTableStatementAst
  | AlterTableStatementAst
  | CreateTableStatementAst
  | UnknownStatementAst;

export type UnknownStatementAst = {
  kind: "unknown";
  rawSql: string;
};

export type UnionStatementAst = {
  kind: "union";
  all: boolean;
  leftSql: string;
  rightSql: string;
  rawSql: string;
};

export type IntersectStatementAst = {
  kind: "intersect";
  all: boolean;
  leftSql: string;
  rightSql: string;
  rawSql: string;
};

export type ExceptStatementAst = {
  kind: "except";
  all: boolean;
  leftSql: string;
  rightSql: string;
  rawSql: string;
};

export type TransactionStatementAst = {
  kind: "transaction";
  action: SqlTransactionAction;
  nestedTransactionPolicy: SqlNestedTransactionPolicy;
  rawSql: string;
};

export type SavepointStatementAst = {
  kind: "savepoint";
  name: string;
  rawSql: string;
};

export type RollbackToSavepointStatementAst = {
  kind: "rollback_to_savepoint";
  name: string;
  rawSql: string;
};

export type ReleaseSavepointStatementAst = {
  kind: "release_savepoint";
  name: string;
  rawSql: string;
};

export type CreateSchemaStatementAst = {
  kind: "create_schema";
  schemaName: string;
  rawSql: string;
};

export type ScalarFunctionSpec = {
  name: string;
  params: Array<{ name: string; typeName: string }>;
  returnType: string;
  body: string; // simple expression body
};

export type CreateFunctionStatementAst = {
  kind: "create_function";
  functionName: string;
  spec: ScalarFunctionSpec;
  rawSql: string;
};

export type TriggerSpec = {
  name: string;
  tableName: string;
  timing: "BEFORE" | "AFTER";
  event: "INSERT" | "UPDATE" | "DELETE";
  body: string; // SQL statement(s) to execute
};

export type CreateTriggerStatementAst = {
  kind: "create_trigger";
  spec: TriggerSpec;
  rawSql: string;
};

export type CreateIndexStatementAst = {
  kind: "create_index";
  indexName: string;
  tableName: string;
  columns: string[];
  unique: boolean;
  rawSql: string;
};

export type DropIndexStatementAst = {
  kind: "drop_index";
  indexName: string;
  tableName?: string;
  ifExists: boolean;
  rawSql: string;
};

export type CreateViewStatementAst = {
  kind: "create_view";
  viewName: string;
  querySql: string;
  rawSql: string;
};

export type DropViewStatementAst = {
  kind: "drop_view";
  viewName: string;
  ifExists: boolean;
  rawSql: string;
};

export type SelectStatementAst = {
  kind: "select";
  explain: boolean;
  from: TableRefAst;
  selectItems: SelectItemAst[];
  where?: ExprAst;
  whereText?: string;
  groupBy?: ExprAst[];
  having?: ExprAst;
  havingText?: string;
  orderBy?: OrderItemAst[];
  limit?: number;
  offset?: number;
  join?: JoinAst;
  joins?: JoinAst[];
  rawSql: string;
};

export type InsertStatementAst = {
  kind: "insert";
  tableName: string;
  columns?: string[];
  values: ExprAst[][];  // multiple value rows
  selectSql?: string;   // INSERT ... SELECT form
  rawSql: string;
};

export type UpdateStatementAst = {
  kind: "update";
  tableName: string;
  tableAlias?: string;
  setClause: Array<{ column: string; value: ExprAst }>;
  where?: ExprAst;
  join?: JoinAst;
  rawSql: string;
};

export type DeleteStatementAst = {
  kind: "delete";
  tableName: string;
  tableAlias?: string;
  using?: string;
  where?: ExprAst;
  join?: JoinAst;
  rawSql: string;
};

export type TruncateTableStatementAst = {
  kind: "truncate_table";
  tableName: string;
  rawSql: string;
};

export type CreateTableStatementAst = {
  kind: "create_table";
  tableName: string;
  rawSql: string;
};

export type AlterTableStatementAst = {
  kind: "alter_table";
  tableName: string;
  action: string;
  rawSql: string;
};

export type TableRefAst =
  | {
      kind: "table";
      name: string;
      alias?: string;
    }
  | {
      kind: "subquery";
      subquerySql: string;
      alias: string;
      rewrittenSql: string;
      /** True for LATERAL subqueries */
      lateral?: boolean;
      /** Preserved outer SELECT items (for scalar subqueries) */
      outerSelectItems?: SelectItemAst[];
    };

export type JoinAst = {
  kind: "join";
  joinType: "INNER" | "LEFT" | "RIGHT" | "FULL";
  table: string;
  onLeft: string;
  onRight: string;
};

export type SelectItemAst = {
  kind: "select_item";
  expr: ExprAst;
  alias?: string;
  window?: WindowFunctionAst;
};

export type OrderItemAst = {
  kind: "order_item";
  expr: ExprAst;
  direction: "ASC" | "DESC";
};

export type ExprAst =
  | { kind: "identifier"; name: string }
  | { kind: "literal"; typedValue: SqlTypedValue }
  | { kind: "function"; name: string; args: ExprAst[]; filter?: ExprAst }
  | { kind: "case"; whenClauses: { condition: ExprAst; result: ExprAst }[]; elseResult?: ExprAst }
  | { kind: "binary"; op: string; left: ExprAst; right: ExprAst }
  | { kind: "unary"; op: string; expr: ExprAst }
  | { kind: "exists"; negated: boolean; subquerySql: string }
  | { kind: "in_subquery"; negated: boolean; expr: ExprAst; subquerySql: string }
  | { kind: "scalar_subquery"; subquerySql: string }
  | { kind: "raw"; text: string };

export type WindowFunctionAst = {
  kind: "window_function";
  name: string;
  args: ExprAst[];
  over: {
    partitionBy: ExprAst[];
    orderBy: OrderItemAst[];
    frame?: WindowFrameAst;
  };
};

export type WindowFrameAst = {
  unit: "ROWS" | "GROUPS" | "RANGE";
  start: WindowFrameBound;
  end: WindowFrameBound;
};

export type WindowFrameBound =
  | { kind: "unbounded_preceding" }
  | { kind: "unbounded_following" }
  | { kind: "current_row" }
  | { kind: "offset_preceding"; offset: number }
  | { kind: "offset_following"; offset: number }
  | { kind: "offset_preceding_interval"; value: number; unit: string }
  | { kind: "offset_following_interval"; value: number; unit: string };
