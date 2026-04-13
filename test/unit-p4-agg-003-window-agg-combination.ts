import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE agg003 (id INT PRIMARY KEY, dept TEXT, sal INT)");
await db.execute("INSERT INTO agg003 (id, dept, sal) VALUES (1, 'A', 100)");
await db.execute("INSERT INTO agg003 (id, dept, sal) VALUES (2, 'A', 200)");
await db.execute("INSERT INTO agg003 (id, dept, sal) VALUES (3, 'B', 150)");
await db.execute("INSERT INTO agg003 (id, dept, sal) VALUES (4, 'B', 300)");
await db.execute("INSERT INTO agg003 (id, dept, sal) VALUES (5, 'C', 250)");

// 1. Window + ORDER BY + LIMIT
const r1 = await db.query(
  "SELECT id, sal, ROW_NUMBER() OVER (ORDER BY sal DESC) AS rn FROM agg003 ORDER BY sal DESC LIMIT 3",
);
assert.equal(r1.rows.length, 3, `Window+LIMIT: expected 3 rows, got ${r1.rows.length}`);
const salOrder = r1.rows.map((r) => r["sal"] as number);
assert.deepEqual(salOrder, [300, 250, 200], `Wrong ORDER: ${JSON.stringify(salOrder)}`);
assert.equal(r1.rows[0]!["rn"], 1, `Top rn should be 1`);
console.log("ok: window + ORDER BY + LIMIT");

// 2. Window + WHERE filter
const r2 = await db.query(
  "SELECT id, sal, ROW_NUMBER() OVER (ORDER BY sal DESC) AS rn FROM agg003 WHERE sal >= 150",
);
// rows matching: sal 200, 150, 300, 250 (4 rows)
assert.equal(r2.rows.length, 4, `Window+WHERE: expected 4, got ${r2.rows.length}`);
console.log("ok: window + WHERE clause");

// 3. Aggregate GROUP BY + ORDER BY + LIMIT
const r3 = await db.query(
  "SELECT dept, SUM(sal) FROM agg003 GROUP BY dept ORDER BY dept ASC LIMIT 2",
);
assert.equal(r3.rows.length, 2, `GROUP BY LIMIT: expected 2, got ${r3.rows.length}`);
const depts = r3.rows.map((r) => r["dept"]);
assert.deepEqual(depts, ["A", "B"], `Wrong dept order: ${JSON.stringify(depts)}`);
console.log("ok: aggregate GROUP BY + ORDER BY + LIMIT");

// 4. PARTITION BY + ORDER BY window
const r4 = await db.query(
  "SELECT dept, sal, ROW_NUMBER() OVER (PARTITION BY dept ORDER BY sal ASC) AS rn FROM agg003 ORDER BY dept, sal",
);
// dept A: sal 100→rn1, 200→rn2; dept B: sal 150→rn1, 300→rn2; dept C: sal 250→rn1
assert.equal(r4.rows.length, 5);
const rnBySal = Object.fromEntries(r4.rows.map((r) => [r["sal"], r["rn"]]));
assert.equal(rnBySal[100], 1); assert.equal(rnBySal[200], 2);
assert.equal(rnBySal[150], 1); assert.equal(rnBySal[300], 2);
assert.equal(rnBySal[250], 1);
console.log("ok: PARTITION BY + ORDER BY window function");

// 5. RANK() with ties + ORDER BY output
const r5 = await db.query(
  "SELECT dept, sal, RANK() OVER (ORDER BY sal DESC) AS rnk FROM agg003 ORDER BY rnk ASC, sal DESC",
);
assert.equal(r5.rows[0]!["sal"], 300, "Highest sal first");
assert.equal(r5.rows[0]!["rnk"], 1);
console.log("ok: RANK() with ORDER BY");

console.log("\nok: P4-AGG-003 window function and aggregate combination compatibility");
