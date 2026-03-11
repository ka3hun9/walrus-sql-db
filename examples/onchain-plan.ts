import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({
    packageId: "0xYOUR_PACKAGE_ID",
    network: "sui-testnet",
    mode: "onchain",
  });

  const planned = await db.execute(`CREATE TABLE orders (id STRING PRIMARY KEY, status STRING, amount U64)`);
  console.log("Planned move call:", planned.moveCall);

  const plannedInsert = await db.execute(`INSERT INTO orders (id, status, amount) VALUES ('ord_1', 'paid', 99)`);
  console.log("Planned move call:", plannedInsert.moveCall);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
