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
  | CreateDomainStatementAst
  | DropDomainStatementAst
  | CreateAssertionStatementAst
  | DropAssertionStatementAst
  | InsertStatementAst
  | UpdateStatementAst
  | DeleteStatementAst
  | TruncateTableStatementAst
  | AlterTableStatementAst
  | CreateTableStatementAst
  | GrantStatementAst
  | RevokeStatementAst
  | UnknownStatementAst;

export type PrivilegeKind = "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "REFERENCES" | "EXECUTE" | "ALL";

export type GrantStatementAst = {
  kind: "grant";
  privileges: PrivilegeKind[];
  onObject: { type: "table" | "function"; name: string };
  grantee: { kind: "user" | "public"; name?: string };
  withGrantOption: boolean;
  rawSql: string;
};

export type RevokeStatementAst = {
  kind: "revoke";
  privileges: PrivilegeKind[];
  onObject: { type: "table" | "function"; name: string };
  grantee: { kind: "user" | "public"; name?: string };
  grantOptionFor: boolean;
  cascade: boolean;
  rawSql: string;
};

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
  /** Language clause (default "SQL") */
  language?: string;
  /** Body kind: "expression" for 'x+1', "statement" for 'BEGIN...END' */
  bodyKind: "expression" | "statement";
  body: string;
  /** Whether the function is deterministic */
  deterministic?: boolean;
  /** External name for external functions */
  externalName?: string;
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
  withCheckOption?: boolean;
};

export type DropViewStatementAst = {
  kind: "drop_view";
  viewName: string;
  ifExists: boolean;
  cascade: boolean;
  rawSql: string;
};

export type CreateDomainStatementAst = {
  kind: "create_domain";
  domainName: string;
  baseType: string;
  length?: number;
  precision?: number;
  scale?: number;
  defaultValue?: string;
  constraints?: Array<{ type: "NOT NULL" | "UNIQUE" | "CHECK"; expression?: string }>;
  rawSql: string;
};

export type DropDomainStatementAst = {
  kind: "drop_domain";
  domainName: string;
  ifExists: boolean;
  cascade: boolean;
  rawSql: string;
};

export type CreateAssertionStatementAst = {
  kind: "create_assertion";
  assertionName: string;
  predicate: string; // raw expression text for the CHECK condition
  initiallyDeferred: boolean;
  rawSql: string;
};

export type DropAssertionStatementAst = {
  kind: "drop_assertion";
  assertionName: string;
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
  action: AlterTableAction;
  rawSql: string;
};

export type AlterTableAction =
  | { action: "add_column"; columnName: string; dataType?: string }
  | { action: "drop_column"; columnName: string; cascade?: boolean }
  | { action: "alter_column_set_default"; columnName: string; defaultValue: string }
  | { action: "alter_column_drop_default"; columnName: string }
  | { action: "alter_column_set_type"; columnName: string; dataType: string }
  | { action: "alter_column_set_not_null"; columnName: string }
  | { action: "alter_column_drop_not_null"; columnName: string }
  | { action: "add_constraint"; constraintName?: string; constraintDefinition: string }
  | { action: "drop_constraint"; constraintName: string; cascade?: boolean }
  | { action: "rename_table"; newTableName: string }
  | { action: "rename_column"; columnName: string; newColumnName: string }
  | { action: "disable_trigger"; triggerName: string }
  | { action: "enable_trigger"; triggerName: string }
  | { action: "validate_constraint"; constraintName: string }
  | { action: "disable_constraint"; constraintName: string };

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
  joinType: "INNER" | "LEFT" | "RIGHT" | "FULL" | "CROSS";
  table: string;
  onLeft: string;
  onRight: string;
  /** True for NATURAL JOIN - columns are matched by name automatically */
  natural?: boolean;
  /** For USING JOIN - columns to match on (both sides use same column name) */
  usingColumns?: string[];
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
  nullsPosition?: "FIRST" | "LAST";
};

export type ExprAst =
  | { kind: "identifier"; name: string }
  | { kind: "qualified_identifier"; table: string; column: string }
  | { kind: "qualified_wildcard"; table: string }
  | { kind: "wildcard"; }
  | { kind: "literal"; typedValue: SqlTypedValue }
  | { kind: "function"; name: string; args: ExprAst[]; filter?: ExprAst }
  | { kind: "case"; baseExpr?: ExprAst; whenClauses: { condition: ExprAst; result: ExprAst }[]; elseResult?: ExprAst }
  | { kind: "binary"; op: string; left: ExprAst; right: ExprAst; escape?: ExprAst }
  | { kind: "collate"; expr: ExprAst; collation: string }
  | { kind: "unary"; op: string; expr: ExprAst }
  | { kind: "exists"; negated: boolean; subquerySql: string }
  | { kind: "in_subquery"; negated: boolean; expr: ExprAst; subquerySql: string }
  | { kind: "scalar_subquery"; subquerySql: string }
  | { kind: "any_subquery"; op: string; left: ExprAst; quantifier: "ANY" | "SOME" | "ALL"; subquerySql: string }
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
