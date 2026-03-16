import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const cycleDb = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
});

await cycleDb.execute(
  "CREATE TABLE fk7_a (id INT PRIMARY KEY, b_id INT, FOREIGN KEY (b_id) REFERENCES fk7_b(id) ON DELETE CASCADE)",
);
await assert.rejects(
  cycleDb.execute(
    "CREATE TABLE fk7_b (id INT PRIMARY KEY, a_id INT, FOREIGN KEY (a_id) REFERENCES fk7_a(id) ON DELETE CASCADE)",
  ),
  /ERR_CONSTRAINT_VIOLATION:FOREIGN_KEY: cascade cycle detected/,
);

const depthDb = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
});

const chainDepth = 18;
await depthDb.execute("CREATE TABLE fk7_chain_0 (id INT PRIMARY KEY)");
for (let i = 1; i <= chainDepth; i++) {
  await depthDb.execute(
    `CREATE TABLE fk7_chain_${i} (id INT PRIMARY KEY, parent_id INT, FOREIGN KEY (parent_id) REFERENCES fk7_chain_${i - 1}(id) ON DELETE CASCADE)`,
  );
}

await depthDb.execute("INSERT INTO fk7_chain_0 (id) VALUES (1)");
for (let i = 1; i <= chainDepth; i++) {
  await depthDb.execute(`INSERT INTO fk7_chain_${i} (id, parent_id) VALUES (1, 1)`);
}

await assert.rejects(
  depthDb.execute("DELETE FROM fk7_chain_0 WHERE id = 1"),
  /ERR_CONSTRAINT_VIOLATION:FOREIGN_KEY: cascade depth exceeded/,
);

const rootRows = await depthDb.query("SELECT * FROM fk7_chain_0");
assert.equal(rootRows.rows.length, 1);

console.log("ok: F-FK-007 cycle detection + cascade depth protection");
