import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE items (id INT PRIMARY KEY, name TEXT, val INT)");
await db.execute("INSERT INTO items (id, name, val) VALUES (1, 'alpha', 10)");
await db.execute("INSERT INTO items (id, name, val) VALUES (2, 'beta', 20)");
await db.execute("INSERT INTO items (id, name, val) VALUES (3, 'gamma', 30)");

// P4-CUR-001: DECLARE CURSOR syntax
await db.execute("DECLARE cur1 CURSOR FOR SELECT id, name FROM items ORDER BY id");
console.log("ok: P4-CUR-001 DECLARE CURSOR");

// P4-CUR-002: State machine — cannot FETCH before OPEN
let stateErr: Error | null = null;
try {
  await db.query("FETCH cur1");
} catch (e) {
  stateErr = e as Error;
}
assert.ok(stateErr !== null, "FETCH before OPEN should throw");
assert.ok(stateErr!.message.includes("ERR_CURSOR_NOT_OPEN"), `Expected ERR_CURSOR_NOT_OPEN, got: ${stateErr!.message}`);
console.log("ok: P4-CUR-002 FETCH before OPEN throws ERR_CURSOR_NOT_OPEN");

// OPEN the cursor
await db.execute("OPEN cur1");
console.log("ok: P4-CUR-001 OPEN CURSOR");

// P4-CUR-003: FETCH row-by-row consistency
const row1 = await db.query("FETCH cur1");
assert.equal(row1.rows.length, 1, "First FETCH should return 1 row");
assert.equal(row1.rows[0]!["id"], 1, `Expected id=1, got ${row1.rows[0]!["id"]}`);
console.log("ok: P4-CUR-003 FETCH row 1");

const row2 = await db.query("FETCH cur1");
assert.equal(row2.rows.length, 1);
assert.equal(row2.rows[0]!["id"], 2);
console.log("ok: P4-CUR-003 FETCH row 2");

const row3 = await db.query("FETCH cur1");
assert.equal(row3.rows.length, 1);
assert.equal(row3.rows[0]!["id"], 3);
console.log("ok: P4-CUR-003 FETCH row 3");

// P4-CUR-002: EOF behavior — FETCH past end returns empty
const eof = await db.query("FETCH cur1");
assert.equal(eof.rows.length, 0, "FETCH past end should return empty rows");
console.log("ok: P4-CUR-002 FETCH at EOF returns empty");

// FETCH on EOF cursor keeps returning empty
const eof2 = await db.query("FETCH cur1");
assert.equal(eof2.rows.length, 0, "FETCH on EOF cursor should stay empty");
console.log("ok: P4-CUR-002 repeated FETCH at EOF stays empty");

// P4-CUR-002: CLOSE cursor
await db.execute("CLOSE cur1");
console.log("ok: P4-CUR-001 CLOSE CURSOR");

// P4-CUR-002: FETCH after CLOSE throws
let closedErr: Error | null = null;
try {
  await db.query("FETCH cur1");
} catch (e) {
  closedErr = e as Error;
}
assert.ok(closedErr !== null, "FETCH after CLOSE should throw");
assert.ok(closedErr!.message.includes("ERR_CURSOR_CLOSED"), `Expected ERR_CURSOR_CLOSED, got: ${closedErr!.message}`);
console.log("ok: P4-CUR-002 FETCH after CLOSE throws ERR_CURSOR_CLOSED");

// P4-CUR-002: OPEN already-open cursor throws
const db2 = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db2.execute("CREATE TABLE nums (n INT PRIMARY KEY)");
await db2.execute("INSERT INTO nums (n) VALUES (1)");
await db2.execute("INSERT INTO nums (n) VALUES (2)");
await db2.execute("DECLARE c2 CURSOR FOR SELECT n FROM nums");
await db2.execute("OPEN c2");
let doubleOpenErr: Error | null = null;
try {
  await db2.execute("OPEN c2");
} catch (e) {
  doubleOpenErr = e as Error;
}
assert.ok(doubleOpenErr !== null, "OPEN already-open cursor should throw");
assert.ok(doubleOpenErr!.message.includes("ERR_CURSOR_ALREADY_OPEN"), `Expected ERR_CURSOR_ALREADY_OPEN, got: ${doubleOpenErr!.message}`);
console.log("ok: P4-CUR-002 double OPEN throws ERR_CURSOR_ALREADY_OPEN");

// P4-CUR-003: Cursor with WHERE filter
const db3 = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await db3.execute("CREATE TABLE vals (id INT PRIMARY KEY, v INT)");
await db3.execute("INSERT INTO vals (id, v) VALUES (1, 100)");
await db3.execute("INSERT INTO vals (id, v) VALUES (2, 200)");
await db3.execute("INSERT INTO vals (id, v) VALUES (3, 300)");
await db3.execute("DECLARE c3 CURSOR FOR SELECT id, v FROM vals WHERE v >= 200 ORDER BY id");
await db3.execute("OPEN c3");
const f1 = await db3.query("FETCH c3");
assert.equal(f1.rows[0]!["v"], 200);
const f2 = await db3.query("FETCH c3");
assert.equal(f2.rows[0]!["v"], 300);
const f3 = await db3.query("FETCH c3");
assert.equal(f3.rows.length, 0, "EOF after filtered fetch");
await db3.execute("CLOSE c3");
console.log("ok: P4-CUR-003 cursor with WHERE filter");

console.log("\nok: P4-CUR-001 through P4-CUR-003 cursor lifecycle");
