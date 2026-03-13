import type { ExprAst, SqlAstStatement } from "./sql-ast.js";

export type SqlDataType = "NULL" | "BOOLEAN" | "INT" | "REAL" | "TEXT" | "UNKNOWN";

export type IdentifierRef = {
  name: string;
  source?: string;
};

export type NameResolutionResult = {
  resolved: IdentifierRef;
  isOuterRef: boolean;
};

export type NameResolver = {
  resolveIdentifier(id: IdentifierRef): NameResolutionResult;
};

export type TypeInferenceContext = {
  statement: SqlAstStatement;
  resolver: NameResolver;
};

export type TypeInferencer = {
  inferExprType(expr: ExprAst, ctx: TypeInferenceContext): SqlDataType;
};

export type TruthValue = "TRUE" | "FALSE" | "UNKNOWN";

export type TruthEvaluator = {
  evalPredicate(expr: ExprAst, row: Record<string, unknown>): TruthValue;
};

export type SqlSemanticContracts = {
  nameResolver: NameResolver;
  typeInferencer: TypeInferencer;
  truthEvaluator: TruthEvaluator;
};
