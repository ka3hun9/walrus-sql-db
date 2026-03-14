import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

async function main() {
  const db = new WalrusSqlClient({ packageId: "0xdev", network: "sui-testnet", mode: "simulator" });

  await db.execute("CREATE TABLE metrics (tenant INT, id INT, code VARCHAR(8) UNIQUE, val INT, PRIMARY KEY (tenant, id))");

  db.resetConstraintIndexCost("metrics");

  await db.execute("INSERT INTO metrics (tenant, id, code, val) VALUES (1, 1, 'A1', 10)");
  await db.execute("INSERT INTO metrics (tenant, id, code, val) VALUES (1, 2, 'A2', 20)");
  await db.execute("UPDATE metrics SET code = 'A2X' WHERE tenant = 1 AND id = 2");
  await db.execute("DELETE FROM metrics WHERE tenant = 1 AND id = 1");

  const cost = db.getConstraintIndexCost("metrics") as {
    insertOps: number;
    updateOps: number;
    deleteOps: number;
    rebuildOps: number;
    conflictChecks: number;
    rowsIndexed: number;
  };

  assert.ok(cost.insertOps > 0, `expected insertOps > 0, got ${cost.insertOps}`);
  assert.ok(cost.updateOps > 0, `expected updateOps > 0, got ${cost.updateOps}`);
  assert.ok(cost.deleteOps > 0, `expected deleteOps > 0, got ${cost.deleteOps}`);
  assert.equal(cost.rebuildOps, 0, `expected rebuildOps=0 on pure DML path, got ${cost.rebuildOps}`);
  assert.ok(cost.conflictChecks > 0, `expected conflictChecks > 0, got ${cost.conflictChecks}`);

  // schema change should trigger rebuild stats
  await db.execute("ALTER TABLE metrics ADD COLUMN extra INT");
  const afterAlter = db.getConstraintIndexCost("metrics") as typeof cost;
  assert.ok(afterAlter.rebuildOps > 0, `expected rebuildOps > 0 after ALTER, got ${afterAlter.rebuildOps}`);

  console.log("sql-phasea8-constraint-cost-regression ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
