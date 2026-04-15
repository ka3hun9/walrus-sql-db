import { describe, it, expect } from "vitest";
import { parseSqlToAst } from "../../src/sql-parser.js";

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
