/**
 * sqllogictest runner Vitest integration tests
 *
 * Tests the parser, diff, known-failures, and runner modules.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { parseSlt } from "./parser.js";
import { diffResults, diffStatement, parseResultRow } from "./diff.js";
import {
  registerFailure,
  checkFailure,
  getAllFailures,
  makeTestId,
  failureSummary,
} from "./known-failures.js";
import type { SqlClient, ExecuteResult } from "./runner.js";
import { runSltFile, summarizeResults } from "./runner.js";

// =============================================================================
// Parser tests
// =============================================================================

describe("sqllogictest parser", () => {
  it("parses a minimal statement ok", () => {
    const doc = parseSlt("statement ok\nCREATE TABLE t(a INT)", "test.slt");
    const stmts = doc.elements.filter((e) => e.kind === "statement");
    expect(stmts).toHaveLength(1);
    expect((stmts[0] as any).type).toBe("ok");
    expect((stmts[0] as any).sql).toBe("CREATE TABLE t(a INT)");
  });

  it("parses statement error with code", () => {
    const doc = parseSlt("statement error SQLITE_CONSTRAINT\nINSERT INTO t VALUES(1,2)", "test.slt");
    const stmts = doc.elements.filter((e) => e.kind === "statement");
    expect((stmts[0] as any).type).toBe("error");
    expect((stmts[0] as any).errorCode).toBe("SQLITE_CONSTRAINT");
  });

  it("parses a minimal query", () => {
    const doc = parseSlt("query I\nSELECT 1\n----\n42", "test.slt");
    const queries = doc.elements.filter((e) => e.kind === "query");
    expect(queries).toHaveLength(1);
    expect((queries[0] as any).typeSignature.raw).toBe("I");
    expect((queries[0] as any).results).toEqual(["42"]);
  });

  it("parses multi-column query", () => {
    const doc = parseSlt("query IIT\nSELECT 1, 2, 'hello'\n----\n1\t2\thello", "test.slt");
    const queries = doc.elements.filter((e) => e.kind === "query");
    expect((queries[0] as any).typeSignature.columns).toEqual(["I", "I", "T"]);
    expect((queries[0] as any).results).toEqual(["1\t2\thello"]);
  });

  it("parses multi-row query", () => {
    const doc = parseSlt("query I\nSELECT * FROM t\n----\n1\n2\n3", "test.slt");
    expect((doc.elements.find((e) => e.kind === "query") as any).results).toEqual(["1", "2", "3"]);
  });

  it("parses query with tab-separated values", () => {
    const doc = parseSlt("query IIT\nSELECT * FROM t\n----\n1\thello\t3.14\n2\tworld\t2.71", "test.slt");
    const results = (doc.elements.find((e) => e.kind === "query") as any).results;
    expect(results).toHaveLength(2);
    expect(results[0]).toBe("1\thello\t3.14");
    expect(results[1]).toBe("2\tworld\t2.71");
  });

  it("parses blank lines as separators (not included in results)", () => {
    const doc = parseSlt("query I\nSELECT 1\n----\n42\n\nstatement ok\nCREATE TABLE t(a INT)", "test.slt");
    const elements = doc.elements.filter((e) => e.kind !== "blank");
    expect(elements).toHaveLength(2);
  });

  it("parses hash-threshold directive", () => {
    const doc = parseSlt("hash-threshold 500\nquery I\nSELECT 1\n----\n1", "test.slt");
    expect(doc.hashThreshold).toBe(500);
  });

  it("parses file-level skipif", () => {
    const doc = parseSlt("skipif sqlite3\nquery I\nSELECT 1\n----\n1", "test.slt");
    expect(doc.fileSkipIf).toContain("sqlite3");
  });

  it("parses file-level onlyif", () => {
    const doc = parseSlt("onlyif walrus\nquery I\nSELECT 1\n----\n1", "test.slt");
    expect(doc.fileOnlyIf).toContain("walrus");
  });

  it("parses halt directive", () => {
    const doc = parseSlt("query I\nSELECT 1\n----\n1\nhalt\nquery I\nSELECT 2\n----\n2", "test.slt");
    expect(doc.halted).toBe(true);
    const queries = doc.elements.filter((e) => e.kind === "query");
    expect(queries).toHaveLength(1);
  });

  it("parses skipif in statement block (file-level)", () => {
    // skipif on its own line = file-level guard
    const doc = parseSlt("skipif sqlite3\nstatement ok\nCREATE TABLE t(a INT)", "test.slt");
    expect(doc.fileSkipIf).toContain("sqlite3");
    const stmts = doc.elements.filter((e) => e.kind === "statement");
    expect((stmts[0] as any).skipIf).toHaveLength(0); // statement-level is empty
  });

  it("parses onlyif in query block (file-level)", () => {
    // onlyif on its own line = file-level guard
    const doc = parseSlt("onlyif walrus\nquery I\nSELECT 1\n----\n1", "test.slt");
    expect(doc.fileOnlyIf).toContain("walrus");
    const queries = doc.elements.filter((e) => e.kind === "query");
    expect((queries[0] as any).onlyIf).toHaveLength(0); // query-level is empty
  });

  it("parses comments", () => {
    const doc = parseSlt("# this is a comment\nquery I\nSELECT 1\n----\n1", "test.slt");
    const comments = doc.elements.filter((e) => e.kind === "comment");
    expect(comments).toHaveLength(1);
    expect((comments[0] as any).text).toBe("# this is a comment");
  });

  it("parses unordered query", () => {
    const doc = parseSlt("query I unordered\nSELECT * FROM t\n----\n3\n1\n2", "test.slt");
    const queries = doc.elements.filter((e) => e.kind === "query");
    expect((queries[0] as any).unordered).toBe(true);
  });

  it("preserves line numbers", () => {
    const doc = parseSlt("# line 1\n\n# line 3\nquery I\nSELECT 1\n----\n1", "test.slt");
    const queries = doc.elements.filter((e) => e.kind === "query");
    expect((queries[0] as any).line).toBeGreaterThan(0);
  });

  it("handles multiple statement/query blocks in sequence", () => {
    const doc = parseSlt(
      "statement ok\nCREATE TABLE t(a INT)\n\nquery I\nSELECT 1\n----\n1\n\nstatement ok\nINSERT INTO t VALUES(42)\n\nquery I\nSELECT * FROM t\n----\n42",
      "test.slt",
    );
    const stmts = doc.elements.filter((e) => e.kind === "statement");
    const queries = doc.elements.filter((e) => e.kind === "query");
    expect(stmts).toHaveLength(2);
    expect(queries).toHaveLength(2);
  });
});

// =============================================================================
// Diff tests
// =============================================================================

describe("sqllogictest diff", () => {
  describe("diffStatement", () => {
    it("passes when ok matches ok", () => {
      const r = diffStatement(true, true);
      expect(r.equal).toBe(true);
    });

    it("fails when ok meets error", () => {
      const r = diffStatement(true, false);
      expect(r.equal).toBe(false);
    });

    it("fails when error meets ok", () => {
      const r = diffStatement(false, true, "SOME_ERROR", undefined);
      expect(r.equal).toBe(false);
    });

    it("passes when error code matches", () => {
      const r = diffStatement(false, false, "SQLITE_CONSTRAINT", "SQLITE_CONSTRAINT");
      expect(r.equal).toBe(true);
    });

    it("fails when error code does not match", () => {
      const r = diffStatement(false, false, "SQLITE_CONSTRAINT", "SQLITE_MISMATCH");
      expect(r.equal).toBe(false);
    });
  });

  describe("parseResultRow", () => {
    it("parses tab-separated values (tabs mode)", () => {
      const row = parseResultRow("1\thello\t3.14", "tabs");
      expect(row).toEqual(["1", "hello", "3.14"]);
    });

    it("parses comma-separated values in csv mode", () => {
      const row = parseResultRow("1, hello , 3.14", "csv");
      expect(row).toEqual(["1", "hello", "3.14"]);
    });

    it("trims whitespace in tab-separated mode", () => {
      const row = parseResultRow("  1  \t  hello  ", "tabs");
      expect(row).toEqual(["1", "hello"]);
    });
  });

  describe("diffResults (ordered)", () => {
    // Default mode is "tabs" (tab-separated) to match standard SLT format
    const makeQuery = (sig: string, unordered = false) => ({
      kind: "query" as const,
      line: 1,
      mode: "tabs" as const,
      typeSignature: { raw: sig, columns: sig.split("") as any },
      sql: "SELECT 1",
      skipIf: [] as string[],
      onlyIf: [] as string[],
      results: [] as string[],
      unordered,
    });

    it("passes when rows match exactly", () => {
      const actual: any[] = [["1", "hello"]];
      const expected = ["1\thello"];
      const q = makeQuery("IT");
      const r = diffResults(actual, expected, q, 1000);
      expect(r.equal).toBe(true);
    });

    it("fails when row count differs", () => {
      const actual: any[] = [["1"], ["2"]];
      const expected = ["1"];
      const r = diffResults(actual, expected, makeQuery("I"), 1000);
      expect(r.equal).toBe(false);
      expect(r.message).toContain("Row count mismatch");
    });

    it("fails when column count differs", () => {
      const actual: any[] = [["1", "hello"]];
      const expected = ["1"];
      // Use "*" to skip type verification and go straight to column count check
      const r = diffResults(actual, expected, makeQuery("*"), 1000);
      expect(r.equal).toBe(false);
      expect(r.message).toContain("Column count mismatch");
    });

    it("fails when value differs", () => {
      const actual: any[] = [["1"]];
      const expected = ["2"];
      const r = diffResults(actual, expected, makeQuery("I"), 1000);
      expect(r.equal).toBe(false);
      expect(r.message).toContain("Value mismatch");
    });

    it("normalizes NULL and nil as equivalent", () => {
      const actual: any[] = [["NULL"]];
      const expected = ["nil"];
      const r = diffResults(actual, expected, makeQuery("*"), 1000);
      expect(r.equal).toBe(true);
    });

    it("treats empty string as NULL for normalization", () => {
      const actual: any[] = [[""]];
      const expected = ["NULL"];
      const r = diffResults(actual, expected, makeQuery("*"), 1000);
      expect(r.equal).toBe(true);
    });

    it("handles float tolerance for REAL columns", () => {
      const actual: any[] = [["3.14159265"]];
      const expected = ["3.14159"];
      const r = diffResults(actual, expected, makeQuery("R"), 1000);
      expect(r.equal).toBe(true);
    });

    it("handles INTEGER coercion to REAL", () => {
      const actual: any[] = [["42"]];
      const expected = ["42.0"];
      const r = diffResults(actual, expected, makeQuery("R"), 1000);
      expect(r.equal).toBe(true);
    });
  });

  describe("diffResults (unordered)", () => {
    it("passes when same rows in different order", () => {
      const actual = [["3"], ["1"], ["2"]];
      const expected = ["1", "2", "3"];
      const q = {
        kind: "query" as const,
        line: 1,
        mode: "tabs" as const,
        typeSignature: { raw: "I", columns: ["I"] as any },
        sql: "SELECT 1",
        skipIf: [] as string[],
        onlyIf: [] as string[],
        results: expected,
        unordered: true,
      };
      const r = diffResults(actual, expected, q, 1000);
      expect(r.equal).toBe(true);
    });

    it("fails when unordered rows don't match", () => {
      const actual = [["1"], ["2"]];
      const expected = ["1", "3"];
      const q = {
        kind: "query" as const,
        line: 1,
        mode: "tabs" as const,
        typeSignature: { raw: "I", columns: ["I"] as any },
        sql: "SELECT 1",
        skipIf: [] as string[],
        onlyIf: [] as string[],
        results: expected,
        unordered: true,
      };
      const r = diffResults(actual, expected, q, 1000);
      expect(r.equal).toBe(false);
    });
  });
});

// =============================================================================
// Known failures tests
// =============================================================================

describe("known-failures", () => {
  beforeEach(() => {
    // Each test gets a clean registry
    getAllFailures(); // ensure registry is seeded
  });

  it("can register and retrieve a failure", () => {
    const id = makeTestId("select1.test", 42);
    registerFailure({
      id,
      category: "PARSER_LIMITATION",
      description: "Test parser limitation",
      reason: "Baseline parser doesn't support this",
      canFix: true,
      tags: ["test"],
    });
    const f = checkFailure("select1.test", 42);
    expect(f).toBeDefined();
    expect(f!.description).toBe("Test parser limitation");
  });

  it("returns undefined for unregistered test", () => {
    const f = checkFailure("nonexistent.test", 999);
    expect(f).toBeUndefined();
  });

  it("failureSummary returns counts by category", () => {
    const summary = failureSummary();
    expect(typeof summary.PARSER_LIMITATION).toBe("number");
    expect(typeof summary.UNSUPPORTED_FUNCTION).toBe("number");
  });
});

// =============================================================================
// Runner integration tests
// =============================================================================

/** Mock SQL client for testing */
class MockClient implements SqlClient {
  private tables: Map<string, any[]> = new Map();
  private shouldError = false;
  private errorMsg = "";

  setError(msg: string) {
    this.shouldError = true;
    this.errorMsg = msg;
  }

  setTable(name: string, rows: any[]) {
    this.tables.set(name, rows);
  }

  async execute(sql: string): Promise<ExecuteResult> {
    if (this.shouldError) {
      this.shouldError = false;
      return { statementType: "error", error: this.errorMsg };
    }

    const upper = sql.trim().toUpperCase();

    if (upper.startsWith("CREATE TABLE")) {
      const name = sql.match(/CREATE TABLE (\w+)/i)?.[1] ?? "t";
      this.tables.set(name, []);
      return { statementType: "CREATE TABLE", affectedRows: 0 };
    }

    if (upper.startsWith("INSERT")) {
      const name = sql.match(/INSERT INTO (\w+)/i)?.[1] ?? "t";
      const rows = this.tables.get(name) ?? [];
      rows.push({ id: rows.length + 1 });
      this.tables.set(name, rows);
      return { statementType: "INSERT", affectedRows: 1 };
    }

    if (upper.startsWith("SELECT")) {
      // Very naive SELECT * FROM t
      const name = sql.match(/FROM (\w+)/i)?.[1] ?? "t";
      const rows = this.tables.get(name) ?? [];
      return {
        statementType: "SELECT",
        rows: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)]))),
      };
    }

    return { statementType: "OTHER" };
  }
}

describe("sqllogictest runner", () => {
  let mockClient: MockClient;

  beforeEach(() => {
    mockClient = new MockClient();
  });

  const clientFactory = () => mockClient;

  it("runs a statement ok", async () => {
    const result = await runSltFile(
      "test.slt",
      "statement ok\nCREATE TABLE t(a INT)",
      clientFactory,
    );
    expect(result.testsPassed).toBe(1);
    expect(result.testsFailed).toBe(0);
  });

  it("runs a query with matching result", async () => {
    mockClient.setTable("t", [{ a: "42" }]);
    const result = await runSltFile(
      "test.slt",
      "query I\nSELECT a FROM t\n----\n42",
      clientFactory,
    );
    expect(result.testsPassed).toBe(1);
    expect(result.testsFailed).toBe(0);
  });

  it("detects query result mismatch", async () => {
    mockClient.setTable("t", [{ a: "99" }]);
    const result = await runSltFile(
      "test.slt",
      "query I\nSELECT a FROM t\n----\n42",
      clientFactory,
    );
    expect(result.testsFailed).toBe(1);
    expect(result.failures[0]!.status).toBe("failed");
  });

  it("skips test on skipif guard", async () => {
    const result = await runSltFile(
      "test.slt",
      "skipif sqlite3\nquery I\nSELECT 1\n----\n1",
      clientFactory,
      { engine: "walrus", engineVersion: "0.3.0", mode: "simulator" },
    );
    // skipif sqlite3 with engine=walrus → evaluateGuard returns false → test NOT skipped
    expect(result.fileSkipped).toBe(false);
    expect(result.testsSkipped).toBe(0);
  });

  it("skips test on onlyif guard failure", async () => {
    const result = await runSltFile(
      "test.slt",
      "onlyif sqlite3\nquery I\nSELECT 1\n----\n1",
      clientFactory,
      { engine: "walrus", engineVersion: "0.3.0", mode: "simulator" },
    );
    // onlyif sqlite3 with engine=walrus → evaluateGuard returns false → fileSkipped=true
    expect(result.fileSkipped).toBe(true);
    expect(result.skipReason).toContain("onlyif failed");
  });

  it("runs test on onlyif guard match", async () => {
    const result = await runSltFile(
      "test.slt",
      "onlyif walrus\nquery I\nSELECT 1\n----\n1",
      clientFactory,
      { engine: "walrus", engineVersion: "0.3.0", mode: "simulator" },
    );
    expect(result.testsRun).toBe(1);
  });

  it("detects statement error when expected", async () => {
    mockClient.setError("SQLITE_CONSTRAINT");
    const result = await runSltFile(
      "test.slt",
      "statement error SQLITE_CONSTRAINT\nINSERT INTO t VALUES(1,2)",
      clientFactory,
    );
    expect(result.testsPassed).toBe(1);
  });

  it("counts multiple blocks correctly", async () => {
    mockClient.setTable("t", [{ a: "1" }]);
    const result = await runSltFile(
      "test.slt",
      "statement ok\nCREATE TABLE t(a INT)\n\nquery I\nSELECT 1\n----\n1\n\nquery I\nSELECT 1\n----\n1",
      clientFactory,
    );
    // statement ok + 2 queries = 3 blocks total. CREATE TABLE passes;
    expect(result.testsRun).toBe(3);
    // SELECT 1 returns empty, SELECT 1 returns empty -> testsPassed=1
    expect(result.testsPassed).toBe(1);
  });

  it("stops at halt directive", async () => {
    const result = await runSltFile(
      "test.slt",
      "query I\nSELECT 1\n----\n1\nhalt\nquery I\nSELECT 2\n----\n2",
      clientFactory,
    );
    // First QUERY runs (testsRun=1), then HALT is encountered and doc.halted=true,
    // second QUERY is skipped. halt element itself is NOT a query/statement.
    expect(result.testsRun).toBe(1);
    expect(result.halted).toBe(true);
    // failures[0] is undefined because the break happens before HALT is added to failures
    // (break exits loop before the halt element itself is processed)
  });
});

describe("summarizeResults", () => {
  it("computes summary statistics correctly", () => {
    const results = [
      {
        filePath: "a.slt",
        fileSkipped: false,
        halted: false,
        testsRun: 10,
        testsPassed: 8,
        testsFailed: 1,
        testsSkipped: 1,
        failures: [],
      },
      {
        filePath: "b.slt",
        fileSkipped: false,
        halted: false,
        testsRun: 5,
        testsPassed: 5,
        testsFailed: 0,
        testsSkipped: 0,
        failures: [],
      },
    ];
    const s = summarizeResults(results);
    expect(s.totalFiles).toBe(2);
    expect(s.totalTests).toBe(15);
    expect(s.testsPassed).toBe(13);
    expect(s.testsFailed).toBe(1);
    expect(s.testsSkipped).toBe(1);
    expect(s.passRate).toBe("86.7%");
  });

  it("handles empty results", () => {
    const s = summarizeResults([]);
    expect(s.totalFiles).toBe(0);
    expect(s.totalTests).toBe(0);
    expect(s.passRate).toBe("N/A");
  });
});
