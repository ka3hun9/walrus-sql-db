import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

function createClient(memoryBudgetRows?: number): WalrusSqlClient {
  return new WalrusSqlClient({
    packageId: "0x1",
    network: "sui-testnet",
    mode: "simulator",
    readCache: { enabled: false },
    joinExecution: memoryBudgetRows === undefined
      ? undefined
      : { memoryBudgetRows },
  });
}

async function seedJoinPair(db: WalrusSqlClient, prefix: string, rows: number): Promise<void> {
  await db.execute(`CREATE TABLE ${prefix}_left (id INT PRIMARY KEY, k INT, payload TEXT)`);
  await db.execute(`CREATE TABLE ${prefix}_right (id INT PRIMARY KEY, k INT, tag TEXT)`);
  for (let i = 1; i <= rows; i += 1) {
    await db.execute(`INSERT INTO ${prefix}_left (id, k, payload) VALUES (${i}, ${i}, 'l${i}')`);
    await db.execute(`INSERT INTO ${prefix}_right (id, k, tag) VALUES (${i}, ${i}, 'r${i}')`);
  }
}

async function explainAlgorithm(db: WalrusSqlClient, sql: string): Promise<Record<string, unknown>> {
  const row = (await db.query(`EXPLAIN ${sql}`)).rows[0]!;
  assert.equal(row.physicalJoinCount, 1);
  return row;
}

const baselineDb = createClient();
await seedJoinPair(baselineDb, "p3_exe2_baseline", 80);
const baselineSql =
  "SELECT p3_exe2_baseline_left.id AS id FROM p3_exe2_baseline_left INNER JOIN p3_exe2_baseline_right ON p3_exe2_baseline_left.k = p3_exe2_baseline_right.k";
const baselineExplain = await explainAlgorithm(baselineDb, baselineSql);
assert.equal(baselineExplain.physicalJoinAlgorithms, "SORT_MERGE_JOIN");
assert.equal(baselineExplain.physicalJoinMemoryBudgetRows, 4096);
assert.match(String(baselineExplain.physicalJoinPlan ?? ""), /SORT_MERGE_JOIN/);
assert.match(String(baselineExplain.physicalJoinPlan ?? ""), /budgetConstrained=false/);

const baselineRows = (await baselineDb.query(
  `${baselineSql} ORDER BY p3_exe2_baseline_left.id ASC`,
)).rows;
assert.equal(baselineRows.length, 80);
assert.deepEqual(baselineRows[0], { id: 1 });
assert.deepEqual(baselineRows[79], { id: 80 });

const constrainedHashDb = createClient(96);
await seedJoinPair(constrainedHashDb, "p3_exe2_hash_budget", 80);
const constrainedHashSql =
  "SELECT p3_exe2_hash_budget_left.id AS id FROM p3_exe2_hash_budget_left INNER JOIN p3_exe2_hash_budget_right ON p3_exe2_hash_budget_left.k = p3_exe2_hash_budget_right.k";
const constrainedHashExplain = await explainAlgorithm(constrainedHashDb, constrainedHashSql);
assert.equal(constrainedHashExplain.physicalJoinAlgorithms, "HASH_JOIN");
assert.equal(constrainedHashExplain.physicalJoinMemoryBudgetRows, 96);
assert.match(String(constrainedHashExplain.physicalJoinPlan ?? ""), /HASH_JOIN/);
assert.match(String(constrainedHashExplain.physicalJoinPlan ?? ""), /budgetConstrained=true/);

const constrainedHashRows = (await constrainedHashDb.query(
  `${constrainedHashSql} ORDER BY p3_exe2_hash_budget_left.id ASC`,
)).rows;
assert.equal(constrainedHashRows.length, 80);
assert.deepEqual(constrainedHashRows[0], { id: 1 });
assert.deepEqual(constrainedHashRows[79], { id: 80 });

const constrainedNestedDb = createClient(16);
await seedJoinPair(constrainedNestedDb, "p3_exe2_nested_budget", 20);
const constrainedNestedSql =
  "SELECT p3_exe2_nested_budget_left.id AS id FROM p3_exe2_nested_budget_left INNER JOIN p3_exe2_nested_budget_right ON p3_exe2_nested_budget_left.k = p3_exe2_nested_budget_right.k";
const constrainedNestedExplain = await explainAlgorithm(constrainedNestedDb, constrainedNestedSql);
assert.equal(constrainedNestedExplain.physicalJoinAlgorithms, "NESTED_LOOP");
assert.equal(constrainedNestedExplain.physicalJoinMemoryBudgetRows, 16);
assert.match(String(constrainedNestedExplain.physicalJoinPlan ?? ""), /NESTED_LOOP/);
assert.match(String(constrainedNestedExplain.physicalJoinPlan ?? ""), /budgetConstrained=true/);

const constrainedNestedRows = (await constrainedNestedDb.query(
  `${constrainedNestedSql} ORDER BY p3_exe2_nested_budget_left.id ASC`,
)).rows;
assert.equal(constrainedNestedRows.length, 20);
assert.deepEqual(constrainedNestedRows[0], { id: 1 });
assert.deepEqual(constrainedNestedRows[19], { id: 20 });

console.log("ok: P3-EXE-002 join executor algorithm switching with memory budget control");
