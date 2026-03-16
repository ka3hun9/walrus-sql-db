export enum SqlErrorFamilyEnum {
  Syntax = "SQL_SYNTAX",
  Semantic = "SQL_SEMANTIC",
  Dialect = "SQL_DIALECT",
}

export enum SqlErrorCodeEnum {
  SyntaxUnexpectedToken = "SQL_SYNTAX_UNEXPECTED_TOKEN",
  SyntaxUnterminatedLiteral = "SQL_SYNTAX_UNTERMINATED_LITERAL",
  SyntaxIncompleteStatement = "SQL_SYNTAX_INCOMPLETE_STATEMENT",
  SyntaxInvalidClauseOrder = "SQL_SYNTAX_INVALID_CLAUSE_ORDER",
  SemanticUnknownIdentifier = "SQL_SEMANTIC_UNKNOWN_IDENTIFIER",
  SemanticAmbiguousIdentifier = "SQL_SEMANTIC_AMBIGUOUS_IDENTIFIER",
  SemanticTypeMismatch = "SQL_SEMANTIC_TYPE_MISMATCH",
  SemanticInvalidGrouping = "SQL_SEMANTIC_INVALID_GROUPING",
  DialectUnsupportedSyntax = "SQL_DIALECT_UNSUPPORTED_SYNTAX",
  DialectUnsupportedFunction = "SQL_DIALECT_UNSUPPORTED_FUNCTION",
  DialectUnsupportedOperator = "SQL_DIALECT_UNSUPPORTED_OPERATOR",
}

export enum ClientErrorCodeEnum {
  TableNotFound = "ERR_TABLE_NOT_FOUND",
  UnsupportedInsert = "ERR_UNSUPPORTED_INSERT",
  UnsupportedUpdate = "ERR_UNSUPPORTED_UPDATE",
  UnsupportedDelete = "ERR_UNSUPPORTED_DELETE",
  UnsupportedSelect = "ERR_UNSUPPORTED_SELECT",
  UnsupportedSelectClauses = "ERR_UNSUPPORTED_SELECT_CLAUSES",
  UnsupportedOrderBy = "ERR_UNSUPPORTED_ORDER_BY",
  UnsupportedWhere = "ERR_UNSUPPORTED_WHERE",
  UnsupportedAstFrom = "ERR_UNSUPPORTED_AST_FROM",
  UnsupportedRawExpr = "ERR_UNSUPPORTED_RAW_EXPR",
  UnsupportedSubquery = "ERR_UNSUPPORTED_SUBQUERY",
  UnsupportedDdl = "ERR_UNSUPPORTED_DDL",
  UnsupportedType = "ERR_UNSUPPORTED_TYPE",
  TypeConstraint = "ERR_TYPE_CONSTRAINT",
  ConstraintViolation = "ERR_CONSTRAINT_VIOLATION",
  TransactionState = "ERR_TRANSACTION_STATE",
  ExecutionFailed = "ERR_EXECUTION_FAILED",
  QueryFailed = "ERR_QUERY_FAILED",
  VerificationFailed = "ERR_VERIFICATION_FAILED",
}

export enum ConstraintViolationKindEnum {
  NotNull = "NOT_NULL",
  DuplicateKey = "DUPLICATE_KEY",
  ForeignKey = "FOREIGN_KEY",
  WriteConflict = "WRITE_CONFLICT",
  PkDrop = "PK_DROP",
  UniqueDrop = "UNIQUE_DROP",
  DdlDependency = "DDL_DEPENDENCY",
  NotNullAddColumn = "NOT_NULL_ADD_COLUMN",
}

export type SqlErrorFamily = `${SqlErrorFamilyEnum}`;
export type SqlErrorCode = `${SqlErrorCodeEnum}`;
export type ClientErrorCode = `${ClientErrorCodeEnum}`;
export type ConstraintViolationKind = `${ConstraintViolationKindEnum}`;
export type UnifiedErrorCode = SqlErrorCode | ClientErrorCode;
