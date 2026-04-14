export type SqlErrorFamily = "SQL_SYNTAX" | "SQL_SEMANTIC" | "SQL_DIALECT";

export type SqlErrorCode =
  | "SQL_SYNTAX_UNEXPECTED_TOKEN"
  | "SQL_SYNTAX_UNTERMINATED_LITERAL"
  | "SQL_SYNTAX_INCOMPLETE_STATEMENT"
  | "SQL_SYNTAX_INVALID_CLAUSE_ORDER"
  | "SQL_SEMANTIC_UNKNOWN_IDENTIFIER"
  | "SQL_SEMANTIC_AMBIGUOUS_IDENTIFIER"
  | "SQL_SEMANTIC_TYPE_MISMATCH"
  | "SQL_SEMANTIC_INVALID_GROUPING"
  | "SQL_PERMISSION_DENIED"
  | "SQL_DIALECT_UNSUPPORTED_SYNTAX"
  | "SQL_DIALECT_UNSUPPORTED_FUNCTION"
  | "SQL_DIALECT_UNSUPPORTED_OPERATOR";

export type SqlErrorDetails = {
  message: string;
  position?: number;
  token?: string;
  hint?: string;
  dialect?: string;
  cause?: unknown;
};

export class SqlEngineError extends Error {
  readonly code: SqlErrorCode;
  readonly family: SqlErrorFamily;
  readonly details?: SqlErrorDetails;

  constructor(code: SqlErrorCode, family: SqlErrorFamily, details?: SqlErrorDetails) {
    super(details?.message ?? code);
    this.name = "SqlEngineError";
    this.code = code;
    this.family = family;
    this.details = details;
  }
}

export function createSqlError(code: SqlErrorCode, details?: SqlErrorDetails): SqlEngineError {
  const family: SqlErrorFamily = code.startsWith("SQL_SYNTAX")
    ? "SQL_SYNTAX"
    : code.startsWith("SQL_SEMANTIC")
      ? "SQL_SEMANTIC"
      : "SQL_DIALECT";
  return new SqlEngineError(code, family, details);
}
