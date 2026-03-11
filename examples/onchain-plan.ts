import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({
    packageId: "0x630e7563985686b50d05d20b73e2603b10578bbe76ce51f8b82e65c83638fe95",
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
