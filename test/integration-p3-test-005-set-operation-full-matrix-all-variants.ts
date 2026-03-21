import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  readCache: { enabled: false },
});

await db.execute("CREATE TABLE p3_test5_left (id INT, tag TEXT)");
await db.execute("CREATE TABLE p3_test5_mid (id INT, tag TEXT)");
await db.execute("CREATE TABLE p3_test5_tail (id INT, tag TEXT)");

const leftRows: Array<[number, string]> = [
  [1, "l1"],
  [2, "shared"],
  [2, "shared"],
  [2, "left_only"],
  [3, "left"],
  [5, "both"],
];

const midRows: Array<[number, string]> = [
  [2, "shared"],
  [2, "shared"],
  [2, "mid_only"],
  [4, "mid"],
  [5, "both"],
  [5, "both"],
];

const tailRows: Array<[number, string]> = [
  [2, "shared"],
  [2, "shared"],
  [3, "left"],
  [5, "both"],
  [6, "tail"],
];

for (const [id, tag] of leftRows) {
  await db.execute(`INSERT INTO p3_test5_left (id, tag) VALUES (${id}, '${tag}')`);
}
for (const [id, tag] of midRows) {
  await db.execute(`INSERT INTO p3_test5_mid (id, tag) VALUES (${id}, '${tag}')`);
}
for (const [id, tag] of tailRows) {
  await db.execute(`INSERT INTO p3_test5_tail (id, tag) VALUES (${id}, '${tag}')`);
}

const asPairKey = (rows: Array<{ id?: unknown; tag?: unknown }>): string[] =>
  rows.map((row) => `${String(row.id)}:${String(row.tag)}`);

const unionDistinct = await db.query(
  "SELECT id, tag FROM p3_test5_left UNION SELECT id, tag FROM p3_test5_mid ORDER BY id ASC, tag ASC",
);
assert.deepEqual(asPairKey(unionDistinct.rows), ["1:l1", "2:left_only", "2:mid_only", "2:shared", "3:left", "4:mid", "5:both"]);

const unionAll = await db.query(
  "SELECT id, tag FROM p3_test5_left UNION ALL SELECT id, tag FROM p3_test5_mid ORDER BY id ASC, tag ASC",
);
assert.deepEqual(asPairKey(unionAll.rows), [
  "1:l1",
  "2:left_only",
  "2:mid_only",
  "2:shared",
  "2:shared",
  "2:shared",
  "2:shared",
  "3:left",
  "4:mid",
  "5:both",
  "5:both",
  "5:both",
]);

const intersectDistinct = await db.query(
  "SELECT id, tag FROM p3_test5_left INTERSECT SELECT id, tag FROM p3_test5_mid ORDER BY id ASC, tag ASC",
);
assert.deepEqual(asPairKey(intersectDistinct.rows), ["2:shared", "5:both"]);

const intersectAll = await db.query(
  "SELECT id, tag FROM p3_test5_left INTERSECT ALL SELECT id, tag FROM p3_test5_mid ORDER BY id ASC, tag ASC",
);
assert.deepEqual(asPairKey(intersectAll.rows), ["2:shared", "2:shared", "5:both"]);

const exceptDistinct = await db.query(
  "SELECT id, tag FROM p3_test5_left EXCEPT SELECT id, tag FROM p3_test5_mid ORDER BY id ASC, tag ASC",
);
assert.deepEqual(asPairKey(exceptDistinct.rows), ["1:l1", "2:left_only", "3:left"]);

const exceptAll = await db.query(
  "SELECT id, tag FROM p3_test5_left EXCEPT ALL SELECT id, tag FROM p3_test5_mid ORDER BY id ASC, tag ASC",
);
assert.deepEqual(asPairKey(exceptAll.rows), ["1:l1", "2:left_only", "3:left"]);

const chainedIntersectAll = await db.query(
  "SELECT id FROM p3_test5_left UNION ALL SELECT id FROM p3_test5_mid INTERSECT ALL SELECT id FROM p3_test5_tail ORDER BY id ASC",
);
assert.deepEqual(chainedIntersectAll.rows.map((row) => row.id), [2, 2, 3, 5]);

const chainedExceptAllUnion = await db.query(
  "SELECT id FROM p3_test5_left EXCEPT ALL SELECT id FROM p3_test5_mid UNION SELECT id FROM p3_test5_tail WHERE id = 6 ORDER BY id ASC",
);
assert.deepEqual(chainedExceptAllUnion.rows.map((row) => row.id), [1, 3, 6]);

console.log("ok: integration P3-TEST-005 set-op full matrix (incl. ALL variants)");
