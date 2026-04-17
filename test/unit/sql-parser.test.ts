import { describe, it, expect } from "vitest";
import { parseSqlToAst } from "../../src/sql-parser.js";
import { parseSlt } from "../sqllogictest/parser.js";
import { loadCachedTest, cachedTestCount, PRIORITY_TESTS } from "../sqllogictest/fetch.js";
import type { SqlAstStatement, ExprAst, SelectItemAst, TableRefAst, JoinAst } from "../../src/sql-ast.js";

describe("sql-parser", () => {
  describe("basic SELECT parsing", () => {
    it("parses simple SELECT", () => {
      const ast = parseSqlToAst("SELECT * FROM users");
      expect(ast.kind).toBe("select");
    });

    it("parses SELECT with column list", () => {
      const ast = parseSqlToAst("SELECT id, name, email FROM users");
      expect(ast.kind).toBe("select");
    });

    it("parses SELECT with WHERE clause", () => {
      const ast = parseSqlToAst("SELECT * FROM users WHERE id = 1");
      expect(ast.kind).toBe("select");
    });

    it("parses SELECT with ORDER BY", () => {
      const ast = parseSqlToAst("SELECT * FROM users ORDER BY name ASC");
      expect(ast.kind).toBe("select");
    });

    it("parses SELECT with LIMIT", () => {
      const ast = parseSqlToAst("SELECT * FROM users LIMIT 10");
      expect(ast.kind).toBe("select");
    });
  });

  describe("INTERVAL parsing", () => {
    it("parses INTERVAL in WHERE clause", () => {
      const ast = parseSqlToAst("SELECT * FROM events WHERE ts > NOW() - INTERVAL '1' DAY");
      expect(ast.kind).toBe("select");
    });

    it("parses INTERVAL with YEAR unit", () => {
      const ast = parseSqlToAst("SELECT * FROM events WHERE ts > NOW() - INTERVAL '2' YEAR");
      expect(ast.kind).toBe("select");
    });

    it("parses INTERVAL with HOUR unit", () => {
      const ast = parseSqlToAst("SELECT * FROM events WHERE ts > NOW() - INTERVAL '3' HOUR");
      expect(ast.kind).toBe("select");
    });

    it("parses INTERVAL with MONTH unit", () => {
      const ast = parseSqlToAst("SELECT * FROM events WHERE ts > NOW() - INTERVAL '6' MONTH");
      expect(ast.kind).toBe("select");
    });

    it("parses multiple INTERVAL conditions", () => {
      const ast = parseSqlToAst(
        "SELECT * FROM events WHERE ts > NOW() - INTERVAL '1' DAY AND ts < NOW() - INTERVAL '1' HOUR",
      );
      expect(ast.kind).toBe("select");
    });
  });

  describe("CASE WHEN parsing", () => {
    it("parses simple CASE WHEN", () => {
      const ast = parseSqlToAst("SELECT CASE WHEN id = 1 THEN 'one' WHEN id = 2 THEN 'two' ELSE 'other' END FROM users");
      expect(ast.kind).toBe("select");
    });

    it("parses CASE WHEN without ELSE", () => {
      const ast = parseSqlToAst("SELECT CASE WHEN id = 1 THEN 'one' WHEN id = 2 THEN 'two' END FROM users");
      expect(ast.kind).toBe("select");
    });

    it("parses CASE WHEN in WHERE clause", () => {
      const ast = parseSqlToAst("SELECT * FROM users WHERE CASE WHEN id > 10 THEN true ELSE false END");
      expect(ast.kind).toBe("select");
    });
  });

  describe("window function frames", () => {
    it("parses ROWS frame with UNBOUNDED PRECEDING", () => {
      const ast = parseSqlToAst(
        "SELECT row_number() OVER (ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) FROM users",
      );
      expect(ast.kind).toBe("select");
    });

    it("parses GROUPS frame with BETWEEN", () => {
      const ast = parseSqlToAst(
        "SELECT row_number() OVER (ORDER BY id GROUPS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) FROM users",
      );
      expect(ast.kind).toBe("select");
    });

    it("parses RANGE frame with UNBOUNDED", () => {
      const ast = parseSqlToAst(
        "SELECT row_number() OVER (ORDER BY id RANGE BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) FROM users",
      );
      expect(ast.kind).toBe("select");
    });

    it("parses frame with numeric PRECEDING", () => {
      const ast = parseSqlToAst(
        "SELECT row_number() OVER (ORDER BY id ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING) FROM users",
      );
      expect(ast.kind).toBe("select");
    });

    it("parses frame with INTERVAL offset for RANGE", () => {
      const ast = parseSqlToAst(
        "SELECT sum(val) OVER (ORDER BY ts RANGE BETWEEN INTERVAL '1' DAY PRECEDING AND INTERVAL '1' DAY FOLLOWING) FROM events",
      );
      expect(ast.kind).toBe("select");
    });

    it("parses window function with PARTITION BY", () => {
      const ast = parseSqlToAst(
        "SELECT row_number() OVER (PARTITION BY category ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) FROM products",
      );
      expect(ast.kind).toBe("select");
    });
  });

  // LATERAL subquery parsing is tested via executeSimulator in client.ts
  // since the baseline parser doesn't directly support LATERAL

  // NOTE: TRUNCATE, MERGE, INSERT, UPDATE, DELETE are handled by executeSimulator
  // via regex in client.ts, not by parseSqlToAst baseline parser.
  // The following are the statement types the baseline parser accepts:
  // SELECT, UNION, INTERSECT, EXCEPT, BEGIN, COMMIT, ROLLBACK,
  // SAVEPOINT, ROLLBACK TO SAVEPOINT, RELEASE SAVEPOINT,
  // CREATE SCHEMA/FUNCTION/TRIGGER/INDEX/VIEW, DROP INDEX/VIEW

  describe("JOIN parsing", () => {
    it("parses INNER JOIN", () => {
      const ast = parseSqlToAst("SELECT * FROM a INNER JOIN b ON a.id = b.a_id");
      expect(ast.kind).toBe("select");
    });

    it("parses LEFT JOIN", () => {
      const ast = parseSqlToAst("SELECT * FROM a LEFT JOIN b ON a.id = b.a_id");
      expect(ast.kind).toBe("select");
    });

    it("parses RIGHT JOIN", () => {
      const ast = parseSqlToAst("SELECT * FROM a RIGHT JOIN b ON a.id = b.a_id");
      expect(ast.kind).toBe("select");
    });

    // CROSS JOIN is not supported by baseline parser
  });

  describe("GROUP BY and HAVING", () => {
    it("parses GROUP BY with aggregate", () => {
      const ast = parseSqlToAst("SELECT category, COUNT(*) FROM products GROUP BY category");
      expect(ast.kind).toBe("select");
    });

    it("parses GROUP BY with HAVING", () => {
      const ast = parseSqlToAst(
        "SELECT category, COUNT(*) FROM products GROUP BY category HAVING COUNT(*) > 5",
      );
      expect(ast.kind).toBe("select");
    });
  });

  describe("subquery in FROM", () => {
    it("parses subquery in FROM", () => {
      const ast = parseSqlToAst("SELECT * FROM (SELECT id FROM users) AS sub");
      expect(ast.kind).toBe("select");
    });
  });

  // CTE (WITH clause) is recognized by the grammar but not fully enabled
  // in the baseline v1 parser

  describe("UNION and set operations", () => {
    it("parses UNION", () => {
      const ast = parseSqlToAst("SELECT id FROM users UNION SELECT id FROM admins");
      expect(ast.kind).toBe("union");
    });

    it("parses UNION ALL", () => {
      const ast = parseSqlToAst("SELECT id FROM users UNION ALL SELECT id FROM admins");
      expect(ast.kind).toBe("union");
    });

    it("parses INTERSECT", () => {
      const ast = parseSqlToAst("SELECT id FROM users INTERSECT SELECT id FROM admins");
      expect(ast.kind).toBe("intersect");
    });

    it("parses EXCEPT", () => {
      const ast = parseSqlToAst("SELECT id FROM users EXCEPT SELECT id FROM admins");
      expect(ast.kind).toBe("except");
    });
  });

  describe("EXPLAIN", () => {
    it("parses EXPLAIN SELECT", () => {
      const ast = parseSqlToAst("EXPLAIN SELECT * FROM users");
      expect(ast.kind).toBe("select");
    });
  });

  // CREATE TABLE and DROP TABLE are handled by executeSimulator in client.ts

  describe("error cases", () => {
    it("throws on unsupported CAST type for ANSI dialect", () => {
      expect(() => parseSqlToAst("SELECT CAST(id AS UNSIGNED) FROM users", { dialect: "ansi" })).toThrow();
    });

    it("throws on ILIKE for ANSI dialect", () => {
      expect(() => parseSqlToAst("SELECT * FROM users WHERE name ILIKE 'alice'", { dialect: "ansi" })).toThrow();
    });
  });
});

/**
 * Recursively check if an ExprAst contains any raw nodes
 */
function containsRawExpr(expr: ExprAst): boolean {
  if (expr.kind === "raw") return true;
  if (expr.kind === "function") {
    for (const arg of expr.args) {
      if (containsRawExpr(arg)) return true;
    }
    if (expr.filter && containsRawExpr(expr.filter)) return true;
  }
  if (expr.kind === "case") {
    if (expr.baseExpr && containsRawExpr(expr.baseExpr)) return true;
    for (const clause of expr.whenClauses) {
      if (containsRawExpr(clause.condition) || containsRawExpr(clause.result)) return true;
    }
    if (expr.elseResult && containsRawExpr(expr.elseResult)) return true;
  }
  if (expr.kind === "binary") {
    return containsRawExpr(expr.left) || containsRawExpr(expr.right);
  }
  if (expr.kind === "unary") {
    return containsRawExpr(expr.expr);
  }
  return false;
}

function findRawInSelectItem(item: SelectItemAst): boolean {
  if (containsRawExpr(item.expr)) return true;
  if (item.window) {
    // window.args
    for (const arg of item.window.args) {
      if (containsRawExpr(arg)) return true;
    }
    // window.over.partitionBy
    for (const expr of item.window.over.partitionBy) {
      if (containsRawExpr(expr)) return true;
    }
    // window.over.orderBy
    for (const orderItem of item.window.over.orderBy) {
      if (containsRawExpr(orderItem.expr)) return true;
    }
  }
  return false;
}

function findRawInTableRef(t: TableRefAst): boolean {
  return false; // table and subquery don't contain ExprAst at this level
}

function findRawInJoin(j: JoinAst): boolean {
  // onLeft and onRight are strings, not ExprAst
  return false;
}

function findAllRawPaths(ast: SqlAstStatement): string[] {
  const paths: string[] = [];
  switch (ast.kind) {
    case "select": {
      if (ast.where && containsRawExpr(ast.where)) paths.push("where");
      if (ast.having && containsRawExpr(ast.having)) paths.push("having");
      for (const expr of ast.groupBy ?? []) {
        if (containsRawExpr(expr)) { paths.push("groupBy"); break; }
      }
      for (const item of ast.selectItems) {
        if (findRawInSelectItem(item)) { paths.push("selectItems"); break; }
      }
      for (const orderItem of ast.orderBy ?? []) {
        if (containsRawExpr(orderItem.expr)) { paths.push("orderBy"); break; }
      }
      if (ast.join && findRawInJoin(ast.join)) paths.push("join");
      for (const j of ast.joins ?? []) {
        if (findRawInJoin(j)) { paths.push("joins"); break; }
      }
      break;
    }
    // union/intersect/except: rawSql is a string, not an AST to traverse
    default:
      break;
  }
  return paths;
}

describe("raw expression canary", () => {
  // Load all cached fixture SQL
  const cachedSqlQueries: Array<{ file: string; sql: string; line: number }> = [];

  beforeAll(() => {
    if (cachedTestCount() === 0) return;
    for (const name of PRIORITY_TESTS) {
      try {
        const content = loadCachedTest(name);
        const doc = parseSlt(content, name);
        for (const el of doc.elements) {
          if (el.kind === "query") {
            cachedSqlQueries.push({ file: name, sql: (el as any).sql, line: (el as any).line });
          }
        }
      } catch {
        // skip
      }
    }
  });

  it("has cached fixture SQL to test", () => {
    expect(cachedSqlQueries.length).toBeGreaterThan(0);
  });

  /**
   * Canary test: monitors raw expression count in parsed fixture SQL.
   *
   * Raw expressions (kind="raw") indicate parts of SQL that the baseline parser
   * cannot fully parse and falls back to string-based handling. The baseline parser
   * intentionally produces raw expressions for complex expressions that the PEG grammar
   * cannot handle (e.g., certain function compositions, chained operations).
   *
   * This test tracks the raw node query rate as a canary to detect regressions.
   * The baseline parser is NOT intended to parse all SQLite SQL - it handles
   * common SQL patterns, while complex expressions fall back to regex-based execution.
   *
   * The threshold is set conservatively to allow for baseline parser limitations
   * while catching significant regressions.
   */
  it("monitors raw expression count in fixture SQL (baseline parser coverage)", () => {
    const parseErrors: Array<{ file: string; line: number; sql: string; error: string }> = [];
    const pathBreakdown: Record<string, number> = {};
    let queriesWithRaw = 0;
    for (const { file, sql, line } of cachedSqlQueries) {
      try {
        const ast = parseSqlToAst(sql, { dialect: "sqlite" });
        const rawPaths = findAllRawPaths(ast);
        if (rawPaths.length > 0) {
          queriesWithRaw++;
          for (const p of rawPaths) pathBreakdown[p] = (pathBreakdown[p] ?? 0) + 1;
        }
      } catch (e: any) {
        parseErrors.push({ file, line, sql, error: e.message });
      }
    }
    // Report summary
    const totalQueries = cachedSqlQueries.length;
    const parseErrorRate = totalQueries > 0 ? ((parseErrors.length / totalQueries) * 100).toFixed(1) : "0.0";
    const rawQueryRate = totalQueries > 0 ? ((queriesWithRaw / totalQueries) * 100).toFixed(1) : "0.0";
    console.error(`\n=== Baseline Parser Coverage Report ===`);
    console.error(`Total queries tested: ${totalQueries}`);
    console.error(`Parse errors: ${parseErrors.length} (${parseErrorRate}%) - grammar limitations`);
    console.error(`Queries with raw nodes: ${queriesWithRaw} (${rawQueryRate}%)`);
    console.error(`Raw node locations: ${JSON.stringify(pathBreakdown)}`);
    // Canary threshold: raw query rate must stay below 50%.
    // A rate above 50% indicates a significant regression in parser coverage.
    expect(queriesWithRaw).toBeLessThan(totalQueries * 0.5);
  });
});
