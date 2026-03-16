import type { SqlTypedValue } from "./types.js";

export type SqlTransactionAction = "BEGIN" | "COMMIT" | "ROLLBACK";
export type SqlNestedTransactionPolicy = "error_on_nested_begin";

export type SqlAstStatement = SelectStatementAst | UnionStatementAst | TransactionStatementAst | UnknownStatementAst;

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

export type TransactionStatementAst = {
  kind: "transaction";
  action: SqlTransactionAction;
  nestedTransactionPolicy: SqlNestedTransactionPolicy;
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
};

export type OrderItemAst = {
  kind: "order_item";
  expr: ExprAst;
  direction: "ASC" | "DESC";
};

export type ExprAst =
  | { kind: "identifier"; name: string }
  | { kind: "literal"; typedValue: SqlTypedValue }
  | { kind: "function"; name: string; args: ExprAst[] }
  | { kind: "binary"; op: string; left: ExprAst; right: ExprAst }
  | { kind: "unary"; op: string; expr: ExprAst }
  | { kind: "raw"; text: string };
