import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
  readCache: { enabled: false },
});

await db.execute("CREATE TABLE p3_opt6_orders (id INT PRIMARY KEY, customer_id INT, region_id INT)");
await db.execute("CREATE TABLE p3_opt6_customers (id INT PRIMARY KEY, tier INT)");
await db.execute("CREATE TABLE p3_opt6_regions (id INT PRIMARY KEY, region_name TEXT)");

for (let i = 1; i <= 100; i += 1) {
  const tier = i <= 10 ? 1 : 2;
  await db.execute(`INSERT INTO p3_opt6_customers (id, tier) VALUES (${i}, ${tier})`);
}

await db.execute("INSERT INTO p3_opt6_regions (id, region_name) VALUES (1, 'north')");
await db.execute("INSERT INTO p3_opt6_regions (id, region_name) VALUES (2, 'south')");

for (let i = 1; i <= 200; i += 1) {
  const customerId = ((i - 1) % 100) + 1;
  const regionId = i % 2 === 0 ? 1 : 2;
  await db.execute(
    `INSERT INTO p3_opt6_orders (id, customer_id, region_id) VALUES (${i}, ${customerId}, ${regionId})`,
  );
}

const reorderedExplain = (await db.query(
  "EXPLAIN SELECT id FROM p3_opt6_orders INNER JOIN p3_opt6_regions ON p3_opt6_orders.region_id = p3_opt6_regions.id INNER JOIN p3_opt6_customers ON p3_opt6_orders.customer_id = p3_opt6_customers.id WHERE p3_opt6_customers.tier = 1",
)).rows[0]!;

assert.equal(reorderedExplain.logicalJoinCount, 2);
assert.equal(reorderedExplain.logicalJoinReorderApplied, true);
assert.equal(reorderedExplain.logicalJoinReorderAlgorithm, "GREEDY_CBO");
assert.equal(reorderedExplain.logicalJoinOrderOriginal, "p3_opt6_regions -> p3_opt6_customers");
assert.equal(reorderedExplain.logicalJoinOrderFinal, "p3_opt6_customers -> p3_opt6_regions");
assert.match(String(reorderedExplain.logicalRewriteRules ?? ""), /RULE_COST_BASED_JOIN_REORDER/);
assert.ok(Number(reorderedExplain.logicalJoinReorderCost) > 0);

const reorderedRows = (await db.query(
  "SELECT id FROM p3_opt6_orders INNER JOIN p3_opt6_regions ON p3_opt6_orders.region_id = p3_opt6_regions.id INNER JOIN p3_opt6_customers ON p3_opt6_orders.customer_id = p3_opt6_customers.id WHERE p3_opt6_customers.tier = 1 ORDER BY p3_opt6_orders.id ASC",
)).rows;
assert.equal(reorderedRows.length, 20);
assert.equal(reorderedRows[0]?.id, 1);
assert.equal(reorderedRows[19]?.id, 110);

const nonInnerExplain = (await db.query(
  "EXPLAIN SELECT id FROM p3_opt6_orders LEFT JOIN p3_opt6_regions ON p3_opt6_orders.region_id = p3_opt6_regions.id INNER JOIN p3_opt6_customers ON p3_opt6_orders.customer_id = p3_opt6_customers.id",
)).rows[0]!;
assert.equal(nonInnerExplain.logicalJoinReorderApplied, false);
assert.equal(nonInnerExplain.logicalJoinReorderAlgorithm, "NONE");
assert.equal(nonInnerExplain.logicalJoinOrderOriginal, "p3_opt6_regions -> p3_opt6_customers");
assert.equal(nonInnerExplain.logicalJoinOrderFinal, "p3_opt6_regions -> p3_opt6_customers");

console.log("ok: P3-OPT-006 cost-based join reorder for INNER join chains");
