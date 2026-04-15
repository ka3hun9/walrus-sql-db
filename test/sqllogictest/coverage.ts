/**
 * SQL feature coverage tracker for sqllogictest
 *
 * Tracks which SQL features are exercised by the test suite,
 * generating a coverage report mapping features to test counts.
 */

import type { SltQuery, SltStatement } from "./types.js";

/** SQL feature categories for coverage tracking */
export interface FeatureCoverage {
  statements: Record<string, number>;
  clauses: Record<string, number>;
  functions: Record<string, number>;
  types: Record<string, number>;
  constructs: Record<string, number>;
}

/** Normalize a SQL keyword (lowercase, trimmed) */
function norm(sql: string): string {
  return sql.trim().toLowerCase();
}

/** Extract statement type from SQL text */
function extractStatementType(sql: string): string {
  const upper = norm(sql);
  if (upper.startsWith("select")) return "SELECT";
  if (upper.startsWith("insert")) return "INSERT";
  if (upper.startsWith("update")) return "UPDATE";
  if (upper.startsWith("delete")) return "DELETE";
  if (upper.startsWith("create table")) return "CREATE TABLE";
  if (upper.startsWith("create index")) return "CREATE INDEX";
  if (upper.startsWith("create view")) return "CREATE VIEW";
  if (upper.startsWith("create trigger")) return "CREATE TRIGGER";
  if (upper.startsWith("drop")) return "DROP";
  if (upper.startsWith("alter")) return "ALTER";
  if (upper.startsWith("begin")) return "BEGIN";
  if (upper.startsWith("commit")) return "COMMIT";
  if (upper.startsWith("rollback")) return "ROLLBACK";
  if (upper.startsWith("savepoint")) return "SAVEPOINT";
  if (upper.startsWith("truncate")) return "TRUNCATE";
  if (upper.startsWith("merge")) return "MERGE";
  if (upper.startsWith("grant")) return "GRANT";
  if (upper.startsWith("revoke")) return "REVOKE";
  if (upper.startsWith("vacuum")) return "VACUUM";
  return "OTHER";
}

/** Extract clauses from a SELECT query */
function extractClauses(sql: string): string[] {
  const upper = norm(sql);
  const clauses: string[] = [];
  if (upper.includes("where")) clauses.push("WHERE");
  if (upper.includes("group by") || upper.includes("groupby")) clauses.push("GROUP BY");
  if (upper.includes("having")) clauses.push("HAVING");
  if (upper.includes("order by") || upper.includes("orderby")) clauses.push("ORDER BY");
  if (upper.includes("limit")) clauses.push("LIMIT");
  if (upper.includes("offset")) clauses.push("OFFSET");
  if (upper.includes("join") || upper.includes(" cross join ")) clauses.push("JOIN");
  if (upper.includes("left join")) clauses.push("LEFT JOIN");
  if (upper.includes("right join")) clauses.push("RIGHT JOIN");
  if (upper.includes("inner join")) clauses.push("INNER JOIN");
  if (upper.includes("outer join")) clauses.push("OUTER JOIN");
  if (upper.includes("natural join")) clauses.push("NATURAL JOIN");
  if (upper.includes("from")) clauses.push("FROM");
  if (upper.includes("distinct")) clauses.push("DISTINCT");
  if (upper.includes("union")) clauses.push("UNION");
  if (upper.includes("intersect")) clauses.push("INTERSECT");
  if (upper.includes("except")) clauses.push("EXCEPT");
  if (upper.includes("with")) clauses.push("CTE (WITH)");
  if (upper.includes("recursive")) clauses.push("RECURSIVE CTE");
  if (upper.includes("window")) clauses.push("WINDOW");
  if (upper.includes("returning")) clauses.push("RETURNING");
  if (upper.includes("partition by") || upper.includes("partitionby")) clauses.push("PARTITION BY");
  if (upper.includes("rows between")) clauses.push("ROWS BETWEEN");
  if (upper.includes("range between")) clauses.push("RANGE BETWEEN");
  if (upper.includes("groups between")) clauses.push("GROUPS BETWEEN");
  if (upper.includes("unbounded preceding")) clauses.push("UNBOUNDED PRECEDING");
  if (upper.includes("unbounded following")) clauses.push("UNBOUNDED FOLLOWING");
  if (upper.includes("current row")) clauses.push("CURRENT ROW");
  if (upper.includes("case when") || upper.includes("case\\s+when")) clauses.push("CASE WHEN");
  if (upper.includes("exists")) clauses.push("EXISTS");
  if (upper.includes("in (")) clauses.push("IN");
  if (upper.includes("between")) clauses.push("BETWEEN");
  if (upper.includes("like")) clauses.push("LIKE");
  if (upper.includes("is null") || upper.includes("isnull")) clauses.push("IS NULL");
  if (upper.includes("is not null") || upper.includes("isnotnull")) clauses.push("IS NOT NULL");
  if (upper.includes("not null")) clauses.push("NOT NULL");
  if (upper.includes("primary key")) clauses.push("PRIMARY KEY");
  if (upper.includes("foreign key")) clauses.push("FOREIGN KEY");
  if (upper.includes("references")) clauses.push("REFERENCES");
  if (upper.includes("check")) clauses.push("CHECK");
  if (upper.includes("unique")) clauses.push("UNIQUE");
  if (upper.includes("index")) clauses.push("INDEX");
  if (upper.includes("trigger")) clauses.push("TRIGGER");
  if (upper.includes("transaction")) clauses.push("TRANSACTION");
  if (upper.includes("autocommit")) clauses.push("AUTOCOMMIT");
  if (upper.includes("rollback to")) clauses.push("ROLLBACK TO");
  if (upper.includes("release savepoint")) clauses.push("RELEASE SAVEPOINT");
  if (upper.includes("pragma")) clauses.push("PRAGMA");
  if (upper.includes("explain")) clauses.push("EXPLAIN");
  if (upper.includes("analyze")) clauses.push("ANALYZE");
  return clauses;
}

/** Extract SQL functions from query */
function extractFunctions(sql: string): string[] {
  const upper = norm(sql);
  const funcs: string[] = [];

  const fnPatterns: [RegExp, string][] = [
    [/count\s*\(/, "COUNT"],
    [/sum\s*\(/, "SUM"],
    [/avg\s*\(/, "AVG"],
    [/min\s*\(/, "MIN"],
    [/max\s*\(/, "MAX"],
    [/total\s*\(/, "TOTAL"],
    [/abs\s*\(/, "ABS"],
    [/length\s*\(/, "LENGTH"],
    [/substr\s*\(/, "SUBSTR"],
    [/substring\s*\(/, "SUBSTRING"],
    [/trim\s*\(/, "TRIM"],
    [/upper\s*\(/, "UPPER"],
    [/lower\s*\(/, "LOWER"],
    [/replace\s*\(/, "REPLACE"],
    [/instr\s*\(/, "INSTR"],
    [/coalesce\s*\(/, "COALESCE"],
    [/nullif\s*\(/, "NULLIF"],
    [/ifnull\s*\(/, "IFNULL"],
    [/iif\s*\(/, "IIF"],
    [/cast\s*\(/, "CAST"],
    [/typeof\s*\(/, "TYPEOF"],
    [/date\s*\(/, "DATE"],
    [/time\s*\(/, "TIME"],
    [/datetime\s*\(/, "DATETIME"],
    [/strftime\s*\(/, "STRFTIME"],
    [/julianday\s*\(/, "JULIANDAY"],
    [/round\s*\(/, "ROUND"],
    [/floor\s*\(/, "FLOOR"],
    [/ceil\s*\(/, "CEILING"],
    [/upper\s*\(/, "UPPER"],
    [/lower\s*\(/, "LOWER"],
    [/random\s*\(/, "RANDOM"],
    [/printf\s*\(/, "PRINTF"],
    [/group_concat\s*\(/, "GROUP_CONCAT"],
    [/hex\s*\(/, "HEX"],
    [/quote\s*\(/, "QUOTE"],
    [/format\s*\(/, "FORMAT"],
    [/row_number\s*\(/, "ROW_NUMBER"],
    [/rank\s*\(/, "RANK"],
    [/dense_rank\s*\(/, "DENSE_RANK"],
    [/percent_rank\s*\(/, "PERCENT_RANK"],
    [/cume_dist\s*\(/, "CUME_DIST"],
    [/lag\s*\(/, "LAG"],
    [/lead\s*\(/, "LEAD"],
    [/first_value\s*\(/, "FIRST_VALUE"],
    [/last_value\s*\(/, "LAST_VALUE"],
    [/nth_value\s*\(/, "NTH_VALUE"],
    [/ntile\s*\(/, "NTILE"],
    [/json\s*\(/, "JSON"],
    [/json_extract\s*\(/, "JSON_EXTRACT"],
    [/json_object\s*\(/, "JSON_OBJECT"],
    [/json_array\s*\(/, "JSON_ARRAY"],
    [/typeof\s*\(/, "TYPEOF"],
    [/sqlite_version\s*\(/, "SQLITE_VERSION"],
    [/ Changes\s*\(/, "CHANGES"],
    [/Total_Changes\s*\(/, "TOTAL_CHANGES"],
    [/last_insert_rowid\s*\(/, "LAST_INSERT_ROWID"],
    [/typeof\s*\(/, "TYPEOF"],
    [/IIF\s*\(/, "IIF"],
    [/REPLACE\s*\(/, "REPLACE"],
    [/TRIM\s*\(/, "TRIM"],
    [/LTRIM\s*\(/, "LTRIM"],
    [/RTRIM\s*\(/, "RTRIM"],
    [/NULLIF\s*\(/, "NULLIF"],
    [/IFNULL\s*\(/, "IFNULL"],
    [/ABS\s*\(/, "ABS"],
    [/ROUND\s*\(/, "ROUND"],
    [/AVG\s*\(/, "AVG"],
    [/COUNT\s*\(/, "COUNT"],
    [/SUM\s*\(/, "SUM"],
    [/MAX\s*\(/, "MAX"],
    [/MIN\s*\(/, "MIN"],
  ];

  for (const [re, name] of fnPatterns) {
    if (re.test(upper)) {
      funcs.push(name);
    }
  }

  return funcs;
}

/** Extract column type references from type signatures */
function extractTypes(sql: string): string[] {
  const upper = norm(sql);
  const types: string[] = [];

  if (upper.includes("int") || upper.includes("integer")) types.push("INTEGER");
  if (upper.includes("text") || upper.includes("varchar") || upper.includes("char(")) types.push("TEXT");
  if (upper.includes("real") || upper.includes("double") || upper.includes("float")) types.push("REAL");
  if (upper.includes("blob")) types.push("BLOB");
  if (upper.includes("numeric") || upper.includes("decimal")) types.push("NUMERIC");
  if (upper.includes("boolean") || upper.includes("bool")) types.push("BOOLEAN");
  if (upper.includes("null")) types.push("NULL");
  if (upper.includes("datetime")) types.push("DATETIME");
  if (upper.includes("date")) types.push("DATE");
  if (upper.includes("time")) types.push("TIME");
  if (upper.includes("timestamp")) types.push("TIMESTAMP");
  if (upper.includes("interval")) types.push("INTERVAL");

  return types;
}

/** Extract higher-level constructs */
function extractConstructs(sql: string): string[] {
  const upper = norm(sql);
  const constructs: string[] = [];

  if (/select\s+.+\s+from\s+\(/i.test(upper)) constructs.push("subquery in FROM");
  if (/where\s+.+\s+select\s+/i.test(upper)) constructs.push("subquery in WHERE");
  if (/exists\s*\(\s*select/i.test(upper)) constructs.push("EXISTS subquery");
  if (/not\s+exists\s*\(\s*select/i.test(upper)) constructs.push("NOT EXISTS subquery");
  if (/select\s+.+\s+from\s+\(\s*select/i.test(upper)) constructs.push("subquery in FROM");
  if (/\(\s*select[^)]+\)\s+as\s+\w+/i.test(upper)) constructs.push("scalar subquery");
  if (/with\s+recursive/i.test(upper)) constructs.push("RECURSIVE CTE");
  if (/with\s+\w+\s+as\s*\(/i.test(upper) && !/with\s+recursive/i.test(upper)) constructs.push("CTE");
  if (/over\s*\(\s*partition\s+by/i.test(upper)) constructs.push("window with PARTITION");
  if (/over\s*\(\s*order\s+by/i.test(upper)) constructs.push("window with ORDER BY");
  if (/rows\s+between/i.test(upper)) constructs.push("window ROWS frame");
  if (/range\s+between/i.test(upper)) constructs.push("window RANGE frame");
  if (/groups\s+between/i.test(upper)) constructs.push("window GROUPS frame");
  if (/union\s+all/i.test(upper)) constructs.push("UNION ALL");
  if (/intersect/i.test(upper)) constructs.push("INTERSECT");
  if (/except/i.test(upper)) constructs.push("EXCEPT");
  if (/insert\s+into.*select/i.test(upper)) constructs.push("INSERT SELECT");
  if (/update\s+\w+\s+set.*select/i.test(upper)) constructs.push("UPDATE with subquery");
  if (/case\s+when/i.test(upper)) constructs.push("CASE WHEN");
  if (/check\s*\(\s*select/i.test(upper)) constructs.push("CHECK with subquery");
  if (/references\s+\w+\s*\(\s*select/i.test(upper)) constructs.push("FK with subquery");
  if (/create\s+table.*as\s+select/i.test(upper)) constructs.push("CREATE TABLE AS SELECT");
  if (/create\s+index.*on/i.test(upper) && !/if\s+not\s+exists/i.test(upper)) constructs.push("CREATE INDEX");
  if (/create\s+unique\s+index/i.test(upper)) constructs.push("CREATE UNIQUE INDEX");
  if (/create\s+trigger/i.test(upper)) constructs.push("CREATE TRIGGER");
  if (/create\s+view/i.test(upper)) constructs.push("CREATE VIEW");
  if (/drop\s+index/i.test(upper)) constructs.push("DROP INDEX");
  if (/drop\s+table/i.test(upper)) constructs.push("DROP TABLE");
  if (/drop\s+view/i.test(upper)) constructs.push("DROP VIEW");
  if (/drop\s+trigger/i.test(upper)) constructs.push("DROP TRIGGER");
  if (/alter\s+table/i.test(upper)) constructs.push("ALTER TABLE");
  if (/truncate/i.test(upper)) constructs.push("TRUNCATE");
  if (/merge\s+into/i.test(upper)) constructs.push("MERGE");

  return constructs;
}

/** Track coverage from a single element */
export function trackElement(
  coverage: FeatureCoverage,
  element: { kind: string; sql?: string } | { kind: string },
): void {
  if (element.kind === "statement" || element.kind === "query") {
    const el = element as SltStatement | SltQuery;
    if (!el.sql) return;

    // Statement type
    const stmtType = extractStatementType(el.sql);
    coverage.statements[stmtType] = (coverage.statements[stmtType] ?? 0) + 1;

    // Clauses (only for SELECT-like statements)
    if (stmtType === "SELECT" || stmtType === "INSERT" || stmtType === "UPDATE" || stmtType === "DELETE") {
      for (const clause of extractClauses(el.sql)) {
        coverage.clauses[clause] = (coverage.clauses[clause] ?? 0) + 1;
      }
    }

    // Functions
    for (const fn of extractFunctions(el.sql)) {
      coverage.functions[fn] = (coverage.functions[fn] ?? 0) + 1;
    }

    // Types
    for (const type of extractTypes(el.sql)) {
      coverage.types[type] = (coverage.types[type] ?? 0) + 1;
    }

    // Constructs
    for (const c of extractConstructs(el.sql)) {
      coverage.constructs[c] = (coverage.constructs[c] ?? 0) + 1;
    }
  }
}

/** Create an empty coverage tracker */
export function createEmptyCoverage(): FeatureCoverage {
  return {
    statements: {},
    clauses: {},
    functions: {},
    types: {},
    constructs: {},
  };
}

/** Merge two coverage objects */
export function mergeCoverage(a: FeatureCoverage, b: FeatureCoverage): FeatureCoverage {
  const merge = (x: Record<string, number>, y: Record<string, number>) => {
    const result: Record<string, number> = { ...x };
    for (const [k, v] of Object.entries(y)) {
      result[k] = (result[k] ?? 0) + v;
    }
    return result;
  };

  return {
    statements: merge(a.statements, b.statements),
    clauses: merge(a.clauses, b.clauses),
    functions: merge(a.functions, b.functions),
    types: merge(a.types, b.types),
    constructs: merge(a.constructs, b.constructs),
  };
}

/** Generate a human-readable coverage report */
export function formatCoverageReport(coverage: FeatureCoverage): string {
  const lines: string[] = [];

  lines.push("## SQL Feature Coverage Report\n");

  lines.push("### Statements");
  for (const [k, v] of Object.entries(coverage.statements).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${k}: ${v}`);
  }

  lines.push("\n### Clauses");
  for (const [k, v] of Object.entries(coverage.clauses).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${k}: ${v}`);
  }

  lines.push("\n### Functions");
  for (const [k, v] of Object.entries(coverage.functions).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${k}: ${v}`);
  }

  lines.push("\n### Types");
  for (const [k, v] of Object.entries(coverage.types).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${k}: ${v}`);
  }

  lines.push("\n### Constructs");
  for (const [k, v] of Object.entries(coverage.constructs).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${k}: ${v}`);
  }

  return lines.join("\n");
}

/** Export coverage as JSON */
export function coverageToJson(coverage: FeatureCoverage): string {
  return JSON.stringify(coverage, null, 2);
}
