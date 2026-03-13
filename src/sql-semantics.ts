import { evalExprAst } from "./sql-ast-eval.js";
import type { ExprAst, SqlAstStatement } from "./sql-ast.js";
import { createSqlError } from "./sql-errors.js";
import type { SqlPrimitive } from "./types.js";

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

function normalizeIdentifier(name: string): string {
  return name.trim();
}

export function resolveIdentifierBinding(availableKeys: string[], identifier: string): NameResolutionResult {
  const raw = normalizeIdentifier(identifier);
  const isOuterRef = /^outer\./i.test(raw);
  const canonical = isOuterRef ? raw.replace(/^outer\./i, "") : raw;

  // exact match has highest priority
  if (availableKeys.includes(raw)) {
    return {
      resolved: { name: raw },
      isOuterRef,
    };
  }

  if (availableKeys.includes(canonical)) {
    return {
      resolved: { name: canonical },
      isOuterRef,
    };
  }

  // unqualified identifier fallback: match `<alias>.<column>` uniquely
  if (!canonical.includes(".")) {
    const suffix = `.${canonical}`;
    const matches = availableKeys.filter((k) => k.endsWith(suffix));
    if (matches.length === 1) {
      return {
        resolved: { name: matches[0]! },
        isOuterRef,
      };
    }
    if (matches.length > 1) {
      throw createSqlError("SQL_SEMANTIC_AMBIGUOUS_IDENTIFIER", {
        message: `Ambiguous identifier: ${canonical}`,
        token: canonical,
      });
    }
  }

  throw createSqlError("SQL_SEMANTIC_UNKNOWN_IDENTIFIER", {
    message: `Unknown identifier: ${canonical}`,
    token: canonical,
  });
}

export function resolveIdentifierValue(
  row: Record<string, unknown>,
  identifier: string,
  mode: "lenient" | "strict" = "lenient",
): SqlPrimitive | undefined {
  const keys = Object.keys(row);
  try {
    const binding = resolveIdentifierBinding(keys, identifier);
    return row[binding.resolved.name] as SqlPrimitive | undefined;
  } catch (e) {
    if (mode === "strict") throw e;
    return undefined;
  }
}

export function toTruthValue(value: SqlPrimitive | undefined): TruthValue {
  if (value === null || value === undefined) return "UNKNOWN";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return Number.isFinite(value) ? (value !== 0 ? "TRUE" : "FALSE") : "UNKNOWN";

  const s = String(value).trim().toUpperCase();
  if (s === "TRUE" || s === "T" || s === "1") return "TRUE";
  if (s === "FALSE" || s === "F" || s === "0") return "FALSE";

  return "UNKNOWN";
}

export function evalPredicate3VL(
  expr: ExprAst,
  row: Record<string, unknown>,
  mode: "lenient" | "strict" = "lenient",
): TruthValue {
  const value = evalExprAst(expr, (name) => resolveIdentifierValue(row, name, mode));
  return toTruthValue(value);
}

export function createRowNameResolver(row: Record<string, unknown>): NameResolver {
  return {
    resolveIdentifier(id: IdentifierRef): NameResolutionResult {
      const keys = Object.keys(row);
      const binding = resolveIdentifierBinding(keys, id.name);
      return {
        resolved: { name: binding.resolved.name, source: id.source },
        isOuterRef: binding.isOuterRef,
      };
    },
  };
}
