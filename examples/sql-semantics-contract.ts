import { strict as assert } from "node:assert";
import type {
  NameResolver,
  TruthEvaluator,
  TypeInferencer,
  SqlSemanticContracts,
  TypeInferenceContext,
} from "../src/sql-semantics.js";
import type { ExprAst, SqlAstStatement } from "../src/sql-ast.js";
import { fromLiteral } from "../src/types.js";

const resolver: NameResolver = {
  resolveIdentifier(id) {
    return { resolved: { name: id.name.toLowerCase() }, isOuterRef: id.name.startsWith("outer.") };
  },
};

const inferencer: TypeInferencer = {
  inferExprType(expr: ExprAst) {
    if (expr.kind === "literal" && typeof expr.typedValue.value === "number") return "INT";
    if (expr.kind === "literal" && typeof expr.typedValue.value === "string") return "TEXT";
    return "UNKNOWN";
  },
};

const truth: TruthEvaluator = {
  evalPredicate(expr: ExprAst) {
    if (expr.kind === "literal" && expr.typedValue.value === true) return "TRUE";
    if (expr.kind === "literal" && expr.typedValue.value === false) return "FALSE";
    return "UNKNOWN";
  },
};

const contracts: SqlSemanticContracts = {
  nameResolver: resolver,
  typeInferencer: inferencer,
  truthEvaluator: truth,
};

const stmt = { kind: "unknown", rawSql: "SELECT 1" } as SqlAstStatement;
const ctx: TypeInferenceContext = { statement: stmt, resolver };

const resolved = contracts.nameResolver.resolveIdentifier({ name: "Outer.User_ID" });
assert.equal(resolved.resolved.name, "outer.user_id");
assert.equal(resolved.isOuterRef, false);

const t1 = contracts.typeInferencer.inferExprType({ kind: "literal", typedValue: fromLiteral(42) }, ctx);
assert.equal(t1, "INT");

const tv = contracts.truthEvaluator.evalPredicate({ kind: "literal", typedValue: fromLiteral(null) }, {});
assert.equal(tv, "UNKNOWN");

console.log("sql-semantics-contract ok");
