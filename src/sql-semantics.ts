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

export function resolveIdentifierValue(row: Record<string, unknown>, identifier: string): SqlPrimitive | undefined {
  const raw = normalizeIdentifier(identifier);

  if (Object.prototype.hasOwnProperty.call(row, raw)) {
    return row[raw] as SqlPrimitive | undefined;
  }

  const isOuterRef = /^outer\./i.test(raw);
  const canonical = isOuterRef ? raw.replace(/^outer\./i, "") : raw;

  if (Object.prototype.hasOwnProperty.call(row, canonical)) {
    return row[canonical] as SqlPrimitive | undefined;
  }

  // Unqualified identifier fallback: match `<alias>.<column>` keys.
  if (!canonical.includes(".")) {
    const suffix = `.${canonical}`;
    const matches = Object.keys(row).filter((k) => k.endsWith(suffix));
    if (matches.length === 1) {
      return row[matches[0]!] as SqlPrimitive | undefined;
    }
    if (matches.length > 1) {
      throw createSqlError("SQL_SEMANTIC_AMBIGUOUS_IDENTIFIER", {
        message: `Ambiguous identifier: ${canonical}`,
        token: canonical,
      });
    }
  }

  return undefined;
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

export function evalPredicate3VL(expr: ExprAst, row: Record<string, unknown>): TruthValue {
  const value = evalExprAst(expr, (name) => resolveIdentifierValue(row, name));
  return toTruthValue(value);
}

export function createRowNameResolver(row: Record<string, unknown>): NameResolver {
  return {
    resolveIdentifier(id: IdentifierRef): NameResolutionResult {
      const name = normalizeIdentifier(id.name);
      const isOuterRef = /^outer\./i.test(name);
      const canonical = isOuterRef ? name.replace(/^outer\./i, "") : name;

      // Trigger ambiguity check via resolver helper.
      resolveIdentifierValue(row, name);

      return {
        resolved: { name: canonical, source: id.source },
        isOuterRef,
      };
    },
  };
}
