import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

// Set up tables
await db.execute("CREATE TABLE employees (id INT PRIMARY KEY, name TEXT NOT NULL, dept TEXT, salary INT)");
await db.execute("CREATE TABLE departments (dept_id INT PRIMARY KEY, dept_name TEXT NOT NULL)");
await db.execute("CREATE VIEW emp_view AS SELECT id, name FROM employees");

// P4-INFO-001: information_schema.tables
const tables = await db.query("SELECT table_name, table_type FROM information_schema.tables ORDER BY table_name");
const tableNames = tables.rows.map((r) => r["table_name"]) as string[];
assert.ok(tableNames.includes("employees"), `tables should include 'employees': ${tableNames}`);
assert.ok(tableNames.includes("departments"), `tables should include 'departments': ${tableNames}`);
console.log("ok: P4-INFO-001 information_schema.tables has base tables");

// View should appear with table_type = VIEW
const views = tables.rows.filter((r) => r["table_type"] === "VIEW");
const baseT = tables.rows.filter((r) => r["table_type"] === "BASE TABLE");
assert.ok(baseT.length >= 2, `Expected at least 2 BASE TABLE rows`);
assert.ok(views.length >= 1, `Expected at least 1 VIEW row`);
console.log("ok: P4-INFO-001 table_type distinction between BASE TABLE and VIEW");

// WHERE filter on information_schema.tables
const filtered = await db.query("SELECT table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE' ORDER BY table_name");
const filteredNames = filtered.rows.map((r) => r["table_name"]) as string[];
assert.ok(filteredNames.includes("employees"), `Filtered should include 'employees'`);
assert.ok(!filteredNames.includes("emp_view"), `Filtered should NOT include view`);
console.log("ok: P4-INFO-001 WHERE filter on information_schema.tables");

// P4-INFO-002: information_schema.columns
const cols = await db.query("SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'employees' ORDER BY ordinal_position");
assert.equal(cols.rows.length, 4, `Expected 4 columns for employees, got ${cols.rows.length}`);
const colNames = cols.rows.map((r) => r["column_name"]);
assert.deepEqual(colNames, ["id", "name", "dept", "salary"]);
console.log("ok: P4-INFO-002 information_schema.columns column list");

// NOT NULL column
const nameCol = cols.rows.find((r) => r["column_name"] === "name");
assert.equal(nameCol!["is_nullable"], "NO", "name is NOT NULL");
const deptCol = cols.rows.find((r) => r["column_name"] === "dept");
assert.equal(deptCol!["is_nullable"], "YES", "dept is nullable");
console.log("ok: P4-INFO-002 is_nullable reflects NOT NULL constraint");

// data_type
const idCol = cols.rows.find((r) => r["column_name"] === "id");
assert.equal(idCol!["data_type"], "INT", `id data_type should be INT, got ${idCol!["data_type"]}`);
const nameColType = cols.rows.find((r) => r["column_name"] === "name");
assert.equal(nameColType!["data_type"], "TEXT", `name data_type should be TEXT`);
console.log("ok: P4-INFO-002 data_type reflects column type");

// P4-INFO-003: information_schema.table_constraints
const constraints = await db.query("SELECT table_name, constraint_name, constraint_type FROM information_schema.table_constraints ORDER BY table_name, constraint_type");
const constraintTypes = constraints.rows.map((r) => r["constraint_type"]) as string[];
assert.ok(constraintTypes.includes("PRIMARY KEY"), "Should have PRIMARY KEY constraint");
console.log("ok: P4-INFO-003 information_schema.table_constraints has PRIMARY KEY");

// P4-INFO-004: DDL changes are immediately visible
await db.execute("CREATE TABLE new_table (x INT PRIMARY KEY, y TEXT)");
const tablesAfter = await db.query("SELECT table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE' ORDER BY table_name");
const namesAfter = tablesAfter.rows.map((r) => r["table_name"]) as string[];
assert.ok(namesAfter.includes("new_table"), "Newly created table should appear in information_schema");
console.log("ok: P4-INFO-004 DDL changes immediately visible in information_schema");

// Column count for new_table
const newCols = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'new_table'");
assert.equal(newCols.rows.length, 2, `Expected 2 columns for new_table`);
console.log("ok: P4-INFO-004 New table columns visible in information_schema.columns");

// P4-INFO-005: Basic query stability - repeated queries return same results
const r1 = await db.query("SELECT COUNT(*) FROM information_schema.tables WHERE table_type = 'BASE TABLE'");
const r2 = await db.query("SELECT COUNT(*) FROM information_schema.tables WHERE table_type = 'BASE TABLE'");
const count1 = Object.values(r1.rows[0]!)[0] as number;
const count2 = Object.values(r2.rows[0]!)[0] as number;
assert.equal(count1, count2, "Repeated queries should return consistent results");
console.log("ok: P4-INFO-005 information_schema query stability");

console.log("\nok: P4-INFO-001 through P4-INFO-005 information_schema");
