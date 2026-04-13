import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE products (id INT PRIMARY KEY, name TEXT, price INT, active INT)");
await db.execute("INSERT INTO products (id, name, price, active) VALUES (1, 'apple', 100, 1)");
await db.execute("INSERT INTO products (id, name, price, active) VALUES (2, 'banana', 200, 1)");
await db.execute("INSERT INTO products (id, name, price, active) VALUES (3, 'cherry', 300, 0)");
await db.execute("INSERT INTO products (id, name, price, active) VALUES (4, 'date', 400, 1)");

// P4-DYN-001: PREPARE with positional parameter placeholder
await db.execute("PREPARE get_product FROM 'SELECT id, name, price FROM products WHERE id = ?'");
console.log("ok: P4-DYN-001 PREPARE statement");

// P4-DYN-002: EXECUTE with parameter binding
const r1 = await db.query("EXECUTE get_product USING 2");
assert.equal(r1.rows.length, 1, `Expected 1 row, got ${r1.rows.length}`);
assert.equal(r1.rows[0]!["name"], "banana", `Expected 'banana', got ${r1.rows[0]!["name"]}`);
console.log("ok: P4-DYN-002 EXECUTE with positional param");

// Execute with different param
const r2 = await db.query("EXECUTE get_product USING 4");
assert.equal(r2.rows[0]!["name"], "date");
console.log("ok: P4-DYN-002 EXECUTE reuse with different param");

// P4-DYN-002: EXECUTE with multiple params
await db.execute("PREPARE range_query FROM 'SELECT id, name FROM products WHERE price >= ? AND price <= ?'");
const r3 = await db.query("EXECUTE range_query USING 150, 350");
assert.equal(r3.rows.length, 2, `Expected 2 rows, got ${r3.rows.length}`);
const names3 = r3.rows.map((r) => r["name"]).sort();
assert.deepEqual(names3, ["banana", "cherry"]);
console.log("ok: P4-DYN-002 EXECUTE with multiple params");

// P4-DYN-002: EXECUTE with NULL param
await db.execute("PREPARE check_active FROM 'SELECT id, name FROM products WHERE active = ?'");
const r4 = await db.query("EXECUTE check_active USING 1");
assert.equal(r4.rows.length, 3, `Expected 3 active products, got ${r4.rows.length}`);
console.log("ok: P4-DYN-002 EXECUTE active filter");

const r5 = await db.query("EXECUTE check_active USING 0");
assert.equal(r5.rows.length, 1, `Expected 1 inactive product`);
assert.equal(r5.rows[0]!["name"], "cherry");
console.log("ok: P4-DYN-002 EXECUTE with 0 param");

// P4-DYN-001: PREPARE DML statement (INSERT with param)
await db.execute("PREPARE insert_product FROM 'INSERT INTO products (id, name, price, active) VALUES (?, ?, ?, 1)'");
await db.execute("EXECUTE insert_product USING 5, 'elderberry', 500");
const r6 = await db.query("SELECT id, name FROM products WHERE id = 5");
assert.equal(r6.rows.length, 1, "Inserted row should exist");
assert.equal(r6.rows[0]!["name"], "elderberry");
console.log("ok: P4-DYN-001/002 PREPARE+EXECUTE INSERT DML");

// P4-DYN-003: Error when statement not found
let notFoundErr: Error | null = null;
try {
  await db.query("EXECUTE nonexistent_stmt");
} catch (e) {
  notFoundErr = e as Error;
}
assert.ok(notFoundErr !== null, "EXECUTE of unknown stmt should throw");
assert.ok(notFoundErr!.message.includes("ERR_STMT_NOT_FOUND"), `Expected ERR_STMT_NOT_FOUND, got: ${notFoundErr!.message}`);
console.log("ok: P4-DYN-003 unknown statement throws ERR_STMT_NOT_FOUND");

// P4-DYN-004: Param count mismatch (too few params)
let bindErr: Error | null = null;
try {
  await db.query("EXECUTE range_query USING 100");
} catch (e) {
  bindErr = e as Error;
}
assert.ok(bindErr !== null, "Too few params should throw");
console.log("ok: P4-DYN-004 param count mismatch handled");

console.log("\nok: P4-DYN-001 through P4-DYN-004 dynamic SQL PREPARE/EXECUTE");
