import { WalrusSqlClient } from "../src/index.js";

async function main() {
  const db = new WalrusSqlClient({
    packageId: "0xYOUR_MOVE_PACKAGE",
    network: "sui-mainnet",
    signerAddress: "0xYOUR_SIGNER",
  });

  console.log("\n1) CREATE TABLE");
  console.log(
    await db.execute(`
      CREATE TABLE orders (
        id STRING PRIMARY KEY,
        buyer STRING,
        amount U64,
        status STRING,
        created_at U64
      )
    `),
  );

  console.log("\n2) INSERT");
  console.log(
    await db.execute(`
      INSERT INTO orders (id, buyer, amount, status, created_at)
      VALUES ('ord_1001', 'mt', 299, 'paid', 1773213600)
    `),
  );

  console.log("\n3) SELECT");
  console.log(
    await db.queryOne(`
      SELECT id, buyer, amount, status
      FROM orders
      WHERE id = 'ord_1001'
    `),
  );

  console.log("\n4) UPDATE");
  console.log(await db.execute(`UPDATE orders SET status = 'shipped' WHERE id = 'ord_1001'`));

  console.log("\n5) DELETE");
  console.log(await db.execute(`DELETE FROM orders WHERE id = 'ord_1001'`));

  console.log("\n6) QUERY WITH PROOF + VERIFY");
  const proofResult = await db.queryWithProof(`SELECT * FROM orders WHERE id = 'ord_1001'`);
  console.log(proofResult);
  console.log("proof valid:", await db.verify(proofResult));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
