import { describe, it, expect, beforeEach } from "vitest";
import { WalrusSqlClient } from "../../src/client.js";

const makeClient = () =>
  new WalrusSqlClient({
    packageId: "0x0000000000000000000000000000000000000000000000000000000000000000",
    network: "sui-devnet",
    mode: "simulator",
    logging: { level: "error" },
  });

describe("function registry: scalar functions via query-replay path", () => {
  it("COALESCE returns first non-null argument", async () => {
    const client = makeClient();
    const result = await client.query("SELECT COALESCE(NULL, 'fallback') AS result");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.result).toBe("fallback");
  });

  it("COALESCE with all NULL returns NULL", async () => {
    const client = makeClient();
    const result = await client.query("SELECT COALESCE(NULL, NULL, NULL) AS result");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.result).toBeNull();
  });

  it("COALESCE returns first non-null (multiple args)", async () => {
    const client = makeClient();
    const result = await client.query("SELECT COALESCE(NULL, NULL, 'third', 'fourth') AS result");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.result).toBe("third");
  });

  it("NULLIF returns NULL when args are equal", async () => {
    const client = makeClient();
    const result = await client.query("SELECT NULLIF('x', 'x') AS result");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.result).toBeNull();
  });

  it("NULLIF returns first arg when args are not equal", async () => {
    const client = makeClient();
    const result = await client.query("SELECT NULLIF('x', 'y') AS result");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.result).toBe("x");
  });

  it("NULLIF with numeric args equal returns NULL", async () => {
    const client = makeClient();
    const result = await client.query("SELECT NULLIF(10, 10) AS result");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.result).toBeNull();
  });

  it("NULLIF with numeric args not equal returns first", async () => {
    const client = makeClient();
    const result = await client.query("SELECT NULLIF(10, 20) AS result");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.result).toBe(10);
  });

  it("nested COALESCE works correctly", async () => {
    const client = makeClient();
    const result = await client.query("SELECT COALESCE(NULL, COALESCE(NULL, 'nested')) AS result");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.result).toBe("nested");
  });
});

describe("function registry: aggregate functions", () => {
  let client: InstanceType<typeof WalrusSqlClient>;
  beforeEach(async () => {
    client = makeClient();
    await client.execute("CREATE TABLE test_agg (id INTEGER, val INTEGER)");
    await client.execute("INSERT INTO test_agg VALUES (1, 10), (2, 20), (3, 30), (4, NULL)");
  });

  it("COUNT(*) counts all rows", async () => {
    const result = await client.query("SELECT COUNT(*) AS cnt FROM test_agg");
    expect(result.rows[0]!.count).toBe(4);
  });

  it("COUNT(col) counts non-null values", async () => {
    const result = await client.query("SELECT COUNT(val) AS cnt FROM test_agg");
    expect(result.rows[0]!.count).toBe(3);
  });

  it("SUM calculates total", async () => {
    const result = await client.query("SELECT SUM(val) AS total FROM test_agg");
    expect(result.rows[0]!.sum).toBe(60);
  });

  it("AVG calculates average", async () => {
    const result = await client.query("SELECT AVG(val) AS average FROM test_agg");
    expect(result.rows[0]!.avg).toBe(20);
  });

  it("MIN finds minimum", async () => {
    const result = await client.query("SELECT MIN(val) AS minimum FROM test_agg");
    expect(result.rows[0]!.min).toBe(10);
  });

  it("MAX finds maximum", async () => {
    const result = await client.query("SELECT MAX(val) AS maximum FROM test_agg");
    expect(result.rows[0]!.max).toBe(30);
  });
});

describe("function registry: window functions (LAG/LEAD)", () => {
  let client: InstanceType<typeof WalrusSqlClient>;
  beforeEach(async () => {
    client = makeClient();
    await client.execute("CREATE TABLE test_window (id INTEGER, name TEXT, score INTEGER)");
    await client.execute("INSERT INTO test_window VALUES (1, 'Alice', 85), (2, 'Bob', 92), (3, 'Carol', 85), (4, 'Dave', 78)");
  });

  it("LAG returns previous row value", async () => {
    const result = await client.query(
      "SELECT name, score, LAG(score) OVER (ORDER BY id) AS prev_score FROM test_window ORDER BY id"
    );
    expect(result.rows[0]!.prev_score).toBeNull();
    expect(result.rows[1]!.prev_score).toBe(85);
    expect(result.rows[2]!.prev_score).toBe(92);
  });

  it("LEAD returns next row value", async () => {
    const result = await client.query(
      "SELECT name, score, LEAD(score) OVER (ORDER BY id) AS next_score FROM test_window ORDER BY id"
    );
    expect(result.rows[0]!.next_score).toBe(92);
    expect(result.rows[3]!.next_score).toBeNull();
  });
});

describe("function registry: CAST (scalar subquery path)", () => {
  it("CAST string to INTEGER", async () => {
    const client = makeClient();
    const result = await client.query("SELECT CAST('123' AS INTEGER) AS result");
    expect(result.rows[0]!.result).toBe(123);
  });

  it("CAST integer to TEXT", async () => {
    const client = makeClient();
    const result = await client.query("SELECT CAST(456 AS TEXT) AS result");
    expect(result.rows[0]!.result).toBe("456");
  });

  it("CAST string to REAL", async () => {
    const client = makeClient();
    const result = await client.query("SELECT CAST('3.14' AS REAL) AS result");
    expect(result.rows[0]!.result).toBeCloseTo?.(3.14) ?? expect(result.rows[0]!.result).toBe(3.14);
  });

  it("CAST NULL returns NULL", async () => {
    const client = makeClient();
    const result = await client.query("SELECT CAST(NULL AS INTEGER) AS result");
    expect(result.rows[0]!.result).toBeNull();
  });

  it("CAST boolean to INTEGER", async () => {
    const client = makeClient();
    const result = await client.query("SELECT CAST(1 AS BOOLEAN) AS result");
    expect(result.rows[0]!.result).toBe(true);
  });
});

describe("function registry: TOTAL and GROUP_CONCAT (scalar subquery path)", () => {
  it("TOTAL returns sum as floating point", async () => {
    const client = makeClient();
    await client.execute("CREATE TABLE test_total (id INTEGER, val INTEGER)");
    await client.execute("INSERT INTO test_total VALUES (1, 10), (2, 20), (3, 30)");
    const result = await client.query("SELECT TOTAL(val) AS total FROM test_total");
    expect(result.rows[0]!.total).toBe(60.0);
  });

  it("TOTAL returns 0.0 for NULL", async () => {
    const client = makeClient();
    await client.execute("CREATE TABLE test_total_null (id INTEGER, val INTEGER)");
    await client.execute("INSERT INTO test_total_null VALUES (1, NULL)");
    const result = await client.query("SELECT TOTAL(val) AS total FROM test_total_null");
    expect(result.rows[0]!.total).toBe(0.0);
  });

  it("GROUP_CONCAT concatenates values", async () => {
    const client = makeClient();
    await client.execute("CREATE TABLE test_gc (id INTEGER, val TEXT)");
    await client.execute("INSERT INTO test_gc VALUES (1, 'a'), (2, 'b'), (3, 'c')");
    const result = await client.query("SELECT GROUP_CONCAT(val) AS result FROM test_gc");
    // Aggregate functions return canonical key names (group_concat), not aliases (result)
    expect(result.rows[0]!.group_concat).toBe("a, b, c");
  });

  it("GROUP_CONCAT with custom separator", async () => {
    const client = makeClient();
    await client.execute("CREATE TABLE test_gc2 (id INTEGER, val TEXT)");
    await client.execute("INSERT INTO test_gc2 VALUES (1, 'x'), (2, 'y')");
    const result = await client.query("SELECT GROUP_CONCAT(val, SEPARATOR '|') AS result FROM test_gc2");
    expect(result.rows[0]!.group_concat).toBe("x|y");
  });
});

describe("function registry: window functions (FIRST_VALUE, LAST_VALUE, NTILE)", () => {
  let client: InstanceType<typeof WalrusSqlClient>;
  beforeEach(async () => {
    client = makeClient();
    await client.execute("CREATE TABLE test_wv (id INTEGER, name TEXT, score INTEGER)");
    await client.execute("INSERT INTO test_wv VALUES (1, 'Alice', 85), (2, 'Bob', 92), (3, 'Carol', 78)");
  });

  it("FIRST_VALUE returns first row value in ORDER BY", async () => {
    const result = await client.query(
      "SELECT name, score, FIRST_VALUE(score) OVER (ORDER BY id) AS first_score FROM test_wv ORDER BY id"
    );
    expect(result.rows[0]!.first_score).toBe(85);
    expect(result.rows[1]!.first_score).toBe(85);
    expect(result.rows[2]!.first_score).toBe(85);
  });

  it("LAST_VALUE returns last row value in ORDER BY", async () => {
    const result = await client.query(
      "SELECT name, score, LAST_VALUE(score) OVER (ORDER BY id) AS last_score FROM test_wv ORDER BY id"
    );
    expect(result.rows[0]!.last_score).toBe(85);
    expect(result.rows[1]!.last_score).toBe(92);
    expect(result.rows[2]!.last_score).toBe(78);
  });

  it("NTILE distributes rows into buckets", async () => {
    const result = await client.query(
      "SELECT name, NTILE(2) OVER (ORDER BY id) AS bucket FROM test_wv ORDER BY id"
    );
    expect(result.rows[0]!.bucket).toBe(1);
    expect(result.rows[1]!.bucket).toBe(1);
    expect(result.rows[2]!.bucket).toBe(2);
  });
});
