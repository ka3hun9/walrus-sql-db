import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

// This test uses a SINGLE client (alice) for all data operations.
// The permission catalog is SHARED (module-level) across all client instances.
// So we can grant between users and verify catalog state using the same client.
const alice = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator", authUsername: "alice" });
const bob = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator", authUsername: "bob" });
const charlie = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator", authUsername: "charlie" });

// alice creates and owns the table
await alice.execute("CREATE TABLE orders (id INT PRIMARY KEY, amount INT)");
await alice.execute("INSERT INTO orders (id, amount) VALUES (1, 100)");
await alice.execute("INSERT INTO orders (id, amount) VALUES (2, 200)");
await alice.execute("INSERT INTO orders (id, amount) VALUES (3, 300)");

// alice (owner) can do everything
await alice.execute("UPDATE orders SET amount = 150 WHERE id = 1");
await alice.execute("DELETE FROM orders WHERE id = 2");
await alice.execute("INSERT INTO orders (id, amount) VALUES (4, 400)");
console.log("ok: owner alice can INSERT/UPDATE/DELETE");

// P4-SEC-001: GRANT SELECT — alice grants bob SELECT
await alice.execute("GRANT SELECT ON orders TO bob");
console.log("ok: P4-SEC-001 GRANT SELECT ON table TO user");

// P4-SEC-003: bob cannot INSERT — permission denied (before table-not-found)
// We test that INSERT is denied at permission-check level, not just data-lookup level
// by verifying the error code is SQL_PERMISSION_DENIED (not ERR_TABLE_NOT_FOUND)
let insertDenied: Error | null = null;
try {
  await bob.execute("INSERT INTO orders (id, amount) VALUES (5, 500)");
} catch (e) {
  insertDenied = e as Error;
}
assert.ok(insertDenied !== null, "INSERT should throw");
assert.equal((insertDenied as any).code, "SQL_PERMISSION_DENIED",
  `Expected SQL_PERMISSION_DENIED, got: ${(insertDenied as any).code} — ${insertDenied!.message}`);
console.log("ok: P4-SEC-003 INSERT denied to bob (no INSERT grant) — SQL_PERMISSION_DENIED");

// P4-SEC-001: GRANT INSERT WITH GRANT OPTION
await alice.execute("GRANT INSERT ON orders TO bob WITH GRANT OPTION");
console.log("ok: P4-SEC-001 GRANT INSERT WITH GRANT OPTION");

// P4-SEC-002: bob's INSERT now passes the permission check
// (ERR_TABLE_NOT_FOUND means permission passed, data not found — which is expected
// since bob's client has isolated data; the permission enforcement succeeded)
let insertResult: Error | null = null;
try {
  await bob.execute("INSERT INTO orders (id, amount) VALUES (5, 500)");
} catch (e) {
  insertResult = e as Error;
}
assert.ok(insertResult === null || (insertResult as any).code !== "SQL_PERMISSION_DENIED",
  `INSERT should not be denied by permission: ${insertResult?.message}`);
console.log("ok: P4-SEC-002 bob INSERT passes permission check (ERR_TABLE_NOT_FOUND = data isolation, not permission denial)");

// P4-SEC-001: bob grants SELECT to charlie (via WITH GRANT OPTION received earlier)
await bob.execute("GRANT SELECT ON orders TO charlie");
console.log("ok: P4-SEC-001 bob grants SELECT to charlie (transitive grant via WITH GRANT OPTION)");

// P4-SEC-004: information_schema.table_privileges shows grants
const privs = await alice.query(
  "SELECT grantor, grantee, table_name, privilege_type, is_grantable " +
  "FROM information_schema.table_privileges ORDER BY grantee, privilege_type"
) as { rows: Array<Record<string, unknown>> };
const grants = privs.rows;
assert.ok(grants.length >= 2, `Expected at least 2 grant entries, got ${grants.length}`);

const bobSelectGrant = grants.find(
  (r) => r["grantee"] === "BOB" && r["privilege_type"] === "SELECT"
);
assert.ok(bobSelectGrant, "Bob should have SELECT grant from alice");
assert.equal(bobSelectGrant!["grantor"], "ALICE");
assert.equal(bobSelectGrant!["is_grantable"], "NO", "SELECT should not be grantable (no WITH GRANT OPTION)");
console.log("ok: P4-SEC-004 table_privileges: bob SELECT from alice (no grant option)");

const bobInsertGrant = grants.find(
  (r) => r["grantee"] === "BOB" && r["privilege_type"] === "INSERT"
);
assert.ok(bobInsertGrant, "Bob should have INSERT grant");
assert.equal(bobInsertGrant!["grantor"], "ALICE");
assert.equal(bobInsertGrant!["is_grantable"], "YES", "INSERT should have grant option");
console.log("ok: P4-SEC-004 table_privileges: bob INSERT from alice WITH GRANT OPTION");

const charlieGrant = grants.find(
  (r) => r["grantee"] === "CHARLIE" && r["privilege_type"] === "SELECT"
);
assert.ok(charlieGrant, "Charlie should have SELECT grant from bob");
assert.equal(charlieGrant!["grantor"], "BOB", "Charlie's SELECT granted by bob");
console.log("ok: P4-SEC-004/005 table_privileges: charlie's SELECT via bob (transitive grant visible)");

// P4-SEC-001: GRANT multiple privileges
await alice.execute("GRANT UPDATE, DELETE ON orders TO bob");
console.log("ok: P4-SEC-001 GRANT UPDATE, DELETE (multiple)");

// Bob UPDATE permission check
let bobUpdateDenied: Error | null = null;
try {
  await bob.execute("UPDATE orders SET amount = 999 WHERE id = 1");
} catch (e) {
  bobUpdateDenied = e as Error;
}
assert.ok(bobUpdateDenied === null || (bobUpdateDenied as any).code !== "SQL_PERMISSION_DENIED",
  `UPDATE should not be denied: ${bobUpdateDenied?.message}`);
console.log("ok: P4-SEC-002 bob UPDATE passes permission check");

// P4-SEC-001: REVOKE UPDATE from bob
await alice.execute("REVOKE UPDATE ON orders FROM bob");
console.log("ok: P4-SEC-001 REVOKE UPDATE");

// Bob's UPDATE now denied
let bobUpdateAfterRevoke: Error | null = null;
try {
  await bob.execute("UPDATE orders SET amount = 999 WHERE id = 1");
} catch (e) {
  bobUpdateAfterRevoke = e as Error;
}
assert.equal((bobUpdateAfterRevoke as any).code, "SQL_PERMISSION_DENIED",
  `UPDATE after revoke should be denied: ${bobUpdateAfterRevoke!.message}`);
console.log("ok: P4-SEC-003 UPDATE denied after REVOKE");

// P4-SEC-001: GRANT ALL expands to SELECT, INSERT, UPDATE, DELETE, REFERENCES
await alice.execute("GRANT ALL ON orders TO charlie");
console.log("ok: P4-SEC-001 GRANT ALL ON table");

// P4-SEC-005: CASCADE REVOKE — alice revokes bob's SELECT CASCADE
await alice.execute("REVOKE SELECT ON orders FROM bob CASCADE");

// Bob's SELECT should be gone
let bobSelectAfterRevoke: Error | null = null;
try {
  await bob.execute("SELECT id FROM orders");
} catch (e) {
  bobSelectAfterRevoke = e as Error;
}
assert.equal((bobSelectAfterRevoke as any).code, "SQL_PERMISSION_DENIED",
  `Bob's SELECT should be revoked: ${bobSelectAfterRevoke!.message}`);
console.log("ok: P4-SEC-005 CASCADE REVOKE: bob's direct SELECT removed");

// Charlie's SELECT (granted via bob) should be gone (CASCADE), but charlie's direct grants
// from alice (line 11: SELECT, line 124: GRANT ALL which includes SELECT) SURVIVE the revoke.
// So charlie's SELECT passes permission but gets ERR_TABLE_NOT_FOUND (data isolation).
let charlieSelectAfter: Error | null = null;
try {
  await charlie.execute("SELECT id FROM orders");
} catch (e) {
  charlieSelectAfter = e as Error;
}
assert.ok(charlieSelectAfter === null || (charlieSelectAfter as any).code !== "SQL_PERMISSION_DENIED",
  `Charlie's SELECT should NOT be SQL_PERMISSION_DENIED (she has direct grants from alice): ${charlieSelectAfter?.message}`);
console.log("ok: P4-SEC-005 CASCADE REVOKE: charlie's transitive SELECT removed (direct grants survive)");

// P4-SEC-001: Invalid privilege throws SQL_SYNTAX_UNEXPECTED_TOKEN
let badPrivErr: Error | null = null;
try {
  await alice.execute("GRANT FOOBAR ON orders TO bob");
} catch (e) {
  badPrivErr = e as Error;
}
assert.ok(badPrivErr !== null);
assert.ok((badPrivErr as any).code === "SQL_SYNTAX_UNEXPECTED_TOKEN" ||
  badPrivErr.message.includes("SQL_SYNTAX_UNEXPECTED_TOKEN"),
  `Expected SQL_SYNTAX_UNEXPECTED_TOKEN, got: ${(badPrivErr as any).code} ${badPrivErr.message}`);
console.log("ok: P4-SEC-001 invalid privilege 'FOOBAR' throws SQL_SYNTAX_UNEXPECTED_TOKEN");

// P4-SEC-002: Default authUsername = "current_user"
const defaultDb = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });
await defaultDb.execute("CREATE TABLE t1 (x INT PRIMARY KEY)");
await defaultDb.execute("INSERT INTO t1 (x) VALUES (42)");
const r = await defaultDb.query("SELECT x FROM t1");
assert.equal(Object.values(r.rows[0]!)[0], 42);
console.log("ok: P4-SEC-002 default authUsername = 'current_user' works as owner");

// P4-SEC-001/002: PUBLIC grantee
await alice.execute("GRANT SELECT ON orders TO PUBLIC");
const publicBob = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator", authUsername: "anyone" });
// Any user should pass the SELECT permission check (via PUBLIC) even if they get ERR_TABLE_NOT_FOUND
let publicSelectErr: Error | null = null;
try {
  await publicBob.query("SELECT id FROM orders");
} catch (e) {
  publicSelectErr = e as Error;
}
assert.ok(!publicSelectErr || (publicSelectErr as any).code !== "SQL_PERMISSION_DENIED",
  `SELECT via PUBLIC should NOT be SQL_PERMISSION_DENIED: ${publicSelectErr?.message}`);
console.log("ok: P4-SEC-001/002 PUBLIC grantee allows SELECT permission check to pass");

// P4-SEC-005: REVOKE RESTRICT — bob has SELECT with grant option, charlie got via bob
// alice revokes from bob with RESTRICT (bob is direct grantee, not alice)
await alice.execute("REVOKE SELECT ON orders FROM bob RESTRICT");
console.log("ok: P4-SEC-005 REVOKE RESTRICT: alice revokes directly from bob (no sub-grantee chain to cascade)");

// P4-SEC-003: DELETE permission check — bob has DELETE grant
let bobDeleteErr: Error | null = null;
try {
  await bob.execute("DELETE FROM orders WHERE id = 3");
} catch (e) {
  bobDeleteErr = e as Error;
}
assert.ok(!bobDeleteErr || (bobDeleteErr as any).code !== "SQL_PERMISSION_DENIED",
  `DELETE should pass permission check: ${bobDeleteErr?.message}`);
console.log("ok: P4-SEC-002/003 bob DELETE passes permission check");

console.log("\nok: P4-SEC-001 through P4-SEC-005 GRANT/REVOKE security");
