import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE p3_opt4_users (id INT PRIMARY KEY, score INT, segment TEXT)");

const seedRows: Array<[number, number | null, string | null]> = [
  [1, 1, "A"],
  [2, 2, "A"],
  [3, 2, "B"],
  [4, 3, "B"],
  [5, 3, "C"],
  [6, 3, "C"],
  [7, 4, "C"],
  [8, 4, "D"],
  [9, 4, "D"],
  [10, 4, "E"],
  [11, null, null],
  [12, null, "E"],
];

for (const [id, score, segment] of seedRows) {
  const scoreValue = score === null ? "NULL" : String(score);
  const segmentValue = segment === null ? "NULL" : `'${segment}'`;
  await db.execute(`INSERT INTO p3_opt4_users (id, score, segment) VALUES (${id}, ${scoreValue}, ${segmentValue})`);
}

const explainScore = (await db.query("EXPLAIN SELECT id FROM p3_opt4_users WHERE score >= 3")).rows[0]!;
const explainSegment = (await db.query("EXPLAIN SELECT id FROM p3_opt4_users WHERE segment = 'D'")).rows[0]!;
const explainAnd = (await db.query("EXPLAIN SELECT id FROM p3_opt4_users WHERE score >= 3 AND segment = 'D'")).rows[0]!;
const explainOr = (await db.query("EXPLAIN SELECT id FROM p3_opt4_users WHERE score >= 3 OR segment = 'D'")).rows[0]!;
const explainNot = (await db.query("EXPLAIN SELECT id FROM p3_opt4_users WHERE NOT (score >= 3 AND segment = 'D')")).rows[0]!;

const scoreSel = Number(explainScore.statsPredicateSelectivity);
const segmentSel = Number(explainSegment.statsPredicateSelectivity);
const andSel = Number(explainAnd.statsPredicateSelectivity);
const orSel = Number(explainOr.statsPredicateSelectivity);
const notSel = Number(explainNot.statsPredicateSelectivity);

assert.ok(scoreSel > 0 && scoreSel <= 1);
assert.ok(segmentSel > 0 && segmentSel <= 1);
assert.ok(andSel > 0 && andSel <= 1);
assert.ok(orSel > 0 && orSel <= 1);
assert.ok(notSel > 0 && notSel <= 1);

assert.ok(andSel <= scoreSel + 1e-12);
assert.ok(andSel <= segmentSel + 1e-12);
assert.ok(orSel >= scoreSel - 1e-12);
assert.ok(orSel >= segmentSel - 1e-12);
assert.ok(Math.abs(notSel - (1 - andSel)) < 1e-12);

assert.equal(explainAnd.physicalAccessPath, "TABLE_SCAN");
const tableRows = Number(explainAnd.statsTableRowCount);
assert.equal(explainAnd.statsPredicateEstimatedRows, Math.ceil(tableRows * andSel));
assert.equal(explainAnd.physicalEstimatedRows, Math.ceil(tableRows * andSel));
assert.equal(explainOr.physicalEstimatedRows, Math.ceil(tableRows * orSel));

console.log("ok: P3-OPT-004 predicate/composite predicate selectivity estimation model");
