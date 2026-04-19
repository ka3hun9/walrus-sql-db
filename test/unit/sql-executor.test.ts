import { describe, it, expect, beforeEach } from "vitest";
import { WalrusSqlClient } from "../../src/client.js";

describe("sql-executor (simulator mode)", () => {
  // Each test gets its own client to avoid state pollution
  const makeClient = () =>
    new WalrusSqlClient({
      packageId: "0x0000000000000000000000000000000000000000000000000000000000000000",
      network: "sui-devnet",
      mode: "simulator",
      logging: { level: "error" },
    });

  describe("transaction control (baseline parser)", () => {
    it("BEGIN starts a transaction", async () => {
      const client = makeClient();
      const result = await client.execute("BEGIN");
      expect(result.statementType).toBe("BEGIN");
    });

    it("BEGIN TRANSACTION is equivalent to BEGIN", async () => {
      const client = makeClient();
      const result = await client.execute("BEGIN TRANSACTION");
      expect(result.statementType).toBe("BEGIN");
    });

    it("COMMIT after BEGIN succeeds", async () => {
      const client = makeClient();
      await client.execute("BEGIN");
      const result = await client.execute("COMMIT");
      expect(result.statementType).toBe("COMMIT");
    });

    it("COMMIT without active transaction throws", async () => {
      const client = makeClient();
      try {
        await client.execute("COMMIT");
      } catch (e: unknown) {
        expect(String(e)).toContain("TRANSACTION");
      }
    });

    it("ROLLBACK without active transaction throws", async () => {
      const client = makeClient();
      try {
        await client.execute("ROLLBACK");
      } catch (e: unknown) {
        expect(String(e)).toContain("TRANSACTION");
      }
    });

    it("ROLLBACK after BEGIN succeeds", async () => {
      const client = makeClient();
      await client.execute("BEGIN");
      const result = await client.execute("ROLLBACK");
      expect(result.statementType).toBe("ROLLBACK");
    });

    it("COMMIT WORK equivalent to COMMIT", async () => {
      const client = makeClient();
      await client.execute("BEGIN");
      const result = await client.execute("COMMIT WORK");
      expect(result.statementType).toBe("COMMIT");
    });

    it("ROLLBACK WORK equivalent to ROLLBACK", async () => {
      const client = makeClient();
      await client.execute("BEGIN");
      const result = await client.execute("ROLLBACK WORK");
      expect(result.statementType).toBe("ROLLBACK");
    });
  });

  describe("BEGIN state isolation", () => {
    it("transaction is committed", async () => {
      const client = makeClient();
      await client.execute("BEGIN");
      await client.execute("COMMIT");
      // After COMMIT, can BEGIN again
      const result = await client.execute("BEGIN");
      expect(result.statementType).toBe("BEGIN");
    });

    it("transaction is rolled back", async () => {
      const client = makeClient();
      await client.execute("BEGIN");
      await client.execute("ROLLBACK");
      // After ROLLBACK, can BEGIN again
      const result = await client.execute("BEGIN");
      expect(result.statementType).toBe("BEGIN");
    });
  });

  describe("PRIMARY KEY constraint", () => {
    it("INSERT duplicate PRIMARY KEY throws error", async () => {
      const client = makeClient();
      await client.execute("CREATE TABLE t (ID INT PRIMARY KEY, NAME TEXT)");
      await client.execute("INSERT INTO t VALUES (1, 'alice')");
      await expect(client.execute("INSERT INTO t VALUES (1, 'bob')")).rejects.toThrow("Duplicate key");
    });

    it("INSERT multiple rows with same PRIMARY KEY throws on first duplicate", async () => {
      const client = makeClient();
      await client.execute("CREATE TABLE t (ID INT PRIMARY KEY, NAME TEXT)");
      // First row succeeds
      await client.execute("INSERT INTO t VALUES (1, 'alice')");
      // Second row with same key fails
      await expect(client.execute("INSERT INTO t VALUES (1, 'bob')")).rejects.toThrow("Duplicate key");
    });

    it("UPDATE to existing PRIMARY KEY throws error", async () => {
      const client = makeClient();
      await client.execute("CREATE TABLE t (ID INT PRIMARY KEY, NAME TEXT)");
      await client.execute("INSERT INTO t VALUES (1, 'alice')");
      await client.execute("INSERT INTO t VALUES (2, 'bob')");
      // Update row 1 to have id=2 (which already exists)
      await expect(client.execute("UPDATE t SET ID = 2 WHERE ID = 1")).rejects.toThrow("Duplicate key");
    });

    it("UPDATE PRIMARY KEY to same value succeeds", async () => {
      const client = makeClient();
      await client.execute("CREATE TABLE t (ID INT PRIMARY KEY, NAME TEXT)");
      await client.execute("INSERT INTO t VALUES (1, 'alice')");
      await client.execute("INSERT INTO t VALUES (2, 'bob')");
      // Update name but keep same id - should succeed
      await client.execute("UPDATE t SET NAME = 'alice updated' WHERE ID = 1");
      const result = await client.query("SELECT NAME FROM t WHERE ID = 1");
      expect((result.rows?.[0] as any)?.NAME).toBe("alice updated");
    });

    it("composite PRIMARY KEY enforces uniqueness", async () => {
      const client = makeClient();
      await client.execute("CREATE TABLE t (A INT, B INT, C TEXT, PRIMARY KEY (A, B))");
      await client.execute("INSERT INTO t VALUES (1, 1, 'first')");
      // Same a, same b - duplicate
      await expect(client.execute("INSERT INTO t VALUES (1, 1, 'second')")).rejects.toThrow("Duplicate key");
      // Different b - should succeed
      await client.execute("INSERT INTO t VALUES (1, 2, 'second')");
    });
  });

  describe("UNIQUE constraint", () => {
    it("INSERT duplicate UNIQUE column throws error", async () => {
      const client = makeClient();
      await client.execute("CREATE TABLE t (ID INT, EMAIL TEXT UNIQUE)");
      await client.execute("INSERT INTO t VALUES (1, 'alice@example.com')");
      await expect(client.execute("INSERT INTO t VALUES (2, 'alice@example.com')")).rejects.toThrow("Duplicate key");
    });

    it("UPDATE to existing UNIQUE value throws error", async () => {
      const client = makeClient();
      await client.execute("CREATE TABLE t (ID INT, EMAIL TEXT UNIQUE)");
      await client.execute("INSERT INTO t VALUES (1, 'alice@example.com')");
      await client.execute("INSERT INTO t VALUES (2, 'bob@example.com')");
      await expect(client.execute("UPDATE t SET EMAIL = 'alice@example.com' WHERE ID = 2")).rejects.toThrow("Duplicate key");
    });
  });

  describe("CHECK constraint", () => {
    it("INSERT violates CHECK throws error", async () => {
      const client = makeClient();
      await client.execute("CREATE TABLE t (AGE INT CHECK (AGE >= 0))");
      await client.execute("INSERT INTO t (AGE) VALUES (25)");
      await expect(client.execute("INSERT INTO t (AGE) VALUES (-5)")).rejects.toThrow("CHECK constraint");
    });

    it("UPDATE violates CHECK throws error", async () => {
      const client = makeClient();
      await client.execute("CREATE TABLE t (AGE INT CHECK (AGE >= 0))");
      await client.execute("INSERT INTO t (AGE) VALUES (25)");
      await expect(client.execute("UPDATE t SET AGE = -1 WHERE AGE = 25")).rejects.toThrow("CHECK constraint");
    });
  });

  describe("ORDER BY NULLS FIRST/LAST", () => {
    it("ORDER BY col NULLS FIRST puts NULLs before non-NULL", async () => {
      const client = makeClient();
      await client.execute("CREATE TABLE t (ID INT, VAL INT)");
      await client.execute("INSERT INTO t VALUES (1, 10), (2, NULL), (3, 30), (4, NULL)");
      const result = await client.query("SELECT ID FROM t ORDER BY VAL NULLS FIRST");
      expect(result.rows.map((r) => r.ID)).toEqual([2, 4, 1, 3]);
    });

    it("ORDER BY col NULLS LAST puts NULLs after non-NULL", async () => {
      const client = makeClient();
      await client.execute("CREATE TABLE t (ID INT, VAL INT)");
      await client.execute("INSERT INTO t VALUES (1, 10), (2, NULL), (3, 30), (4, NULL)");
      const result = await client.query("SELECT ID FROM t ORDER BY VAL NULLS LAST");
      expect(result.rows.map((r) => r.ID)).toEqual([1, 3, 2, 4]);
    });

    it("ORDER BY col ASC defaults to NULLS LAST", async () => {
      const client = makeClient();
      await client.execute("CREATE TABLE t (ID INT, VAL INT)");
      await client.execute("INSERT INTO t VALUES (1, 10), (2, NULL), (3, 30), (4, NULL)");
      const result = await client.query("SELECT ID FROM t ORDER BY VAL ASC");
      expect(result.rows.map((r) => r.ID)).toEqual([1, 3, 2, 4]);
    });

    it("ORDER BY col DESC NULLS FIRST puts NULLs first despite DESC", async () => {
      const client = makeClient();
      await client.execute("CREATE TABLE t (ID INT, VAL INT)");
      await client.execute("INSERT INTO t VALUES (1, 10), (2, NULL), (3, 30), (4, NULL)");
      const result = await client.query("SELECT ID FROM t ORDER BY VAL DESC NULLS FIRST");
      expect(result.rows.map((r) => r.ID)).toEqual([2, 4, 3, 1]);
    });
  });

  describe("NATURAL JOIN", () => {
    it("NATURAL JOIN matches columns with same name", async () => {
      const client = makeClient();
      await client.execute("CREATE TABLE a (ID INT, NAME TEXT)");
      await client.execute("CREATE TABLE b (ID INT, AGE INT)");
      await client.execute("INSERT INTO a VALUES (1, 'alice'), (2, 'bob')");
      await client.execute("INSERT INTO b VALUES (1, 30), (2, 25)");
      const result = await client.query("SELECT a.ID, a.NAME, b.AGE FROM a NATURAL JOIN b");
      expect(result.rows.length).toBe(2);
      expect(result.rows[0]).toEqual({ ID: 1, NAME: "alice", AGE: 30 });
      expect(result.rows[1]).toEqual({ ID: 2, NAME: "bob", AGE: 25 });
    });

    it("NATURAL LEFT JOIN", async () => {
      const client = makeClient();
      await client.execute("CREATE TABLE a (ID INT, NAME TEXT)");
      await client.execute("CREATE TABLE b (ID INT, AGE INT)");
      await client.execute("INSERT INTO a VALUES (1, 'alice'), (2, 'bob'), (3, 'charlie')");
      await client.execute("INSERT INTO b VALUES (1, 30), (2, 25)");
      const result = await client.query("SELECT a.ID, a.NAME, b.AGE FROM a NATURAL LEFT JOIN b ORDER BY ID");
      expect(result.rows.length).toBe(3);
      expect(result.rows[0]).toEqual({ ID: 1, NAME: "alice", AGE: 30 });
      expect(result.rows[1]).toEqual({ ID: 2, NAME: "bob", AGE: 25 });
      expect(result.rows[2]).toEqual({ ID: 3, NAME: "charlie", AGE: null });
    });
  });

  describe("USING JOIN", () => {
    it("USING with single column", async () => {
      const client = makeClient();
      await client.execute("CREATE TABLE a (ID INT, NAME TEXT)");
      await client.execute("CREATE TABLE b (ID INT, AGE INT)");
      await client.execute("INSERT INTO a VALUES (1, 'alice'), (2, 'bob')");
      await client.execute("INSERT INTO b VALUES (1, 30), (2, 25)");
      const result = await client.query("SELECT ID, NAME, AGE FROM a JOIN b USING (ID)");
      expect(result.rows.length).toBe(2);
      expect(result.rows[0]).toEqual({ ID: 1, NAME: "alice", AGE: 30 });
      expect(result.rows[1]).toEqual({ ID: 2, NAME: "bob", AGE: 25 });
    });

    it("USING with multiple columns", async () => {
      const client = makeClient();
      await client.execute("CREATE TABLE a (ID INT, DEPT TEXT, NAME TEXT)");
      await client.execute("CREATE TABLE b (ID INT, DEPT TEXT, AGE INT)");
      await client.execute("INSERT INTO a VALUES (1, 'sales', 'alice'), (1, 'tech', 'bob'), (2, 'sales', 'charlie')");
      await client.execute("INSERT INTO b VALUES (1, 'sales', 30), (1, 'tech', 25), (2, 'sales', 35)");
      const result = await client.query("SELECT ID, DEPT, NAME, AGE FROM a JOIN b USING (ID, DEPT) ORDER BY NAME");
      expect(result.rows.length).toBe(3);
      expect(result.rows[0]).toEqual({ ID: 1, DEPT: "sales", NAME: "alice", AGE: 30 });
      expect(result.rows[1]).toEqual({ ID: 1, DEPT: "tech", NAME: "bob", AGE: 25 });
      expect(result.rows[2]).toEqual({ ID: 2, DEPT: "sales", NAME: "charlie", AGE: 35 });
    });

    it("USING LEFT JOIN", async () => {
      const client = makeClient();
      await client.execute("CREATE TABLE a (ID INT, NAME TEXT)");
      await client.execute("CREATE TABLE b (ID INT, AGE INT)");
      await client.execute("INSERT INTO a VALUES (1, 'alice'), (2, 'bob'), (3, 'charlie')");
      await client.execute("INSERT INTO b VALUES (1, 30), (2, 25)");
      const result = await client.query("SELECT ID, NAME, AGE FROM a LEFT JOIN b USING (ID) ORDER BY ID");
      expect(result.rows.length).toBe(3);
      expect(result.rows[0]).toEqual({ ID: 1, NAME: "alice", AGE: 30 });
      expect(result.rows[1]).toEqual({ ID: 2, NAME: "bob", AGE: 25 });
      expect(result.rows[2]).toEqual({ ID: 3, NAME: "charlie", AGE: null });
    });
  });

  describe("WITH CHECK OPTION", () => {
    it("CREATE VIEW WITH CHECK OPTION parses correctly", async () => {
      const client = makeClient();
      await client.execute("CREATE TABLE t (ID INT, VAL INT)");
      await client.execute("INSERT INTO t VALUES (1, 10), (2, 20), (3, 30)");
      await client.execute("CREATE VIEW v AS SELECT * FROM t WHERE VAL > 15 WITH CHECK OPTION");
      const result = await client.query("SELECT * FROM v");
      expect(result.rows.length).toBe(2);
      expect(result.rows.map((r) => r.ID)).toEqual([2, 3]);
    });

    it("INSERT into view WITH CHECK OPTION succeeds when row satisfies WHERE", async () => {
      const client = makeClient();
      await client.execute("CREATE TABLE t (ID INT, VAL INT)");
      await client.execute("INSERT INTO t VALUES (1, 10), (2, 20)");
      await client.execute("CREATE VIEW v AS SELECT * FROM t WHERE VAL > 15 WITH CHECK OPTION");
      await client.execute("INSERT INTO v VALUES (3, 25)");
      const result = await client.query("SELECT * FROM v ORDER BY ID");
      expect(result.rows.length).toBe(2);
      expect(result.rows[1]).toEqual({ ID: 3, VAL: 25 });
    });

    it("INSERT into view WITH CHECK OPTION throws when row violates WHERE", async () => {
      const client = makeClient();
      await client.execute("CREATE TABLE t (ID INT, VAL INT)");
      await client.execute("INSERT INTO t VALUES (1, 10), (2, 20)");
      await client.execute("CREATE VIEW v AS SELECT * FROM t WHERE VAL > 15 WITH CHECK OPTION");
      await expect(client.execute("INSERT INTO v VALUES (3, 5)")).rejects.toThrow("WITH CHECK OPTION");
    });

    it("UPDATE into view WITH CHECK OPTION succeeds when updated row satisfies WHERE", async () => {
      const client = makeClient();
      await client.execute("CREATE TABLE t (ID INT, VAL INT)");
      await client.execute("INSERT INTO t VALUES (1, 10), (2, 20), (3, 5)");
      await client.execute("CREATE VIEW v AS SELECT * FROM t WHERE VAL > 15 WITH CHECK OPTION");
      await client.execute("UPDATE v SET VAL = 25 WHERE ID = 3");
      const result = await client.query("SELECT * FROM v ORDER BY ID");
      expect(result.rows.length).toBe(2);
      expect(result.rows[1]).toEqual({ ID: 3, VAL: 25 });
    });

    it("UPDATE into view WITH CHECK OPTION throws when updated row violates WHERE", async () => {
      const client = makeClient();
      await client.execute("CREATE TABLE t (ID INT, VAL INT)");
      await client.execute("INSERT INTO t VALUES (1, 10), (2, 20)");
      await client.execute("CREATE VIEW v AS SELECT * FROM t WHERE VAL > 15 WITH CHECK OPTION");
      await expect(client.execute("UPDATE v SET VAL = 5 WHERE ID = 2")).rejects.toThrow("WITH CHECK OPTION");
    });

    it("view WITHOUT WITH CHECK OPTION allows inserting rows not in view", async () => {
      const client = makeClient();
      await client.execute("CREATE TABLE t (ID INT, VAL INT)");
      await client.execute("INSERT INTO t VALUES (1, 10), (2, 20)");
      await client.execute("CREATE VIEW v AS SELECT * FROM t WHERE VAL > 15");
      // This should succeed because the view doesn't have WITH CHECK OPTION
      await client.execute("INSERT INTO v VALUES (3, 5)");
      const result = await client.query("SELECT * FROM t WHERE ID = 3");
      expect(result.rows[0]).toEqual({ ID: 3, VAL: 5 });
    });
  });
});
