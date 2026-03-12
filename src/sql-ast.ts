export type SqlAstStatement = SelectStatementAst | UnknownStatementAst;

export type UnknownStatementAst = {
  kind: "unknown";
  rawSql: string;
};

export type SelectStatementAst = {
  kind: "select";
  explain: boolean;
  from: TableRefAst;
  selectItems: SelectItemAst[];
  where?: ExprAst;
  groupBy?: ExprAst[];
  having?: ExprAst;
  orderBy?: OrderItemAst[];
  limit?: number;
  offset?: number;
  join?: JoinAst;
  rawSql: string;
};

export type TableRefAst = {
  kind: "table";
  name: string;
};

export type JoinAst = {
  kind: "join";
  joinType: "INNER" | "LEFT" | "RIGHT";
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
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "function"; name: string; args: ExprAst[] }
  | { kind: "raw"; text: string };
