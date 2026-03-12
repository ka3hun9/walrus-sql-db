import { WalrusSqlClient } from "../src/index.js";

type Row = Record<string, unknown>;

function norm(rows: Row[]): string[] {
  return rows
    .map((r) => JSON.stringify(Object.keys(r).sort().reduce((acc, k) => ({ ...acc, [k]: r[k] }), {} as Row)))
    .sort();
}

function diffRows(label: string, got: Row[], expect: Row[]) {
  const a = norm(got);
  const b = norm(expect);
  const ok = JSON.stringify(a) === JSON.stringify(b);
  console.log(`${ok ? "PASS" : "FAIL"} :: ${label}`);
  if (!ok) {
    console.log("  got   =>", got);
    console.log("  expect=>", expect);
  }
}

async function main() {
  const db = new WalrusSqlClient({ packageId: "0xdev", network: "sui-testnet", mode: "simulator" });

  await db.execute("CREATE TABLE users (id TEXT, tier INT, name TEXT)");
  await db.execute("CREATE TABLE orders (id TEXT, user_id TEXT, amount INT, note TEXT)");

  await db.execute("INSERT INTO users (id, tier, name) VALUES ('u1', 3, 'Alice')");
  await db.execute("INSERT INTO users (id, tier, name) VALUES ('u2', 1, 'Bob')");
  await db.execute("INSERT INTO users (id, tier, name) VALUES ('u3', NULL, 'A_100')");

  await db.execute("INSERT INTO orders (id, user_id, amount, note) VALUES ('o1', 'u1', 10, 'A_1')");
  await db.execute("INSERT INTO orders (id, user_id, amount, note) VALUES ('o2', 'u2', 20, 'A%2')");
  await db.execute("INSERT INTO orders (id, user_id, amount, note) VALUES ('o3', 'u9', 30, NULL)");

  const c1 = await db.query("SELECT id FROM orders WHERE user_id NOT IN ('u2', NULL) ORDER BY id");
  diffRows("NOT IN + NULL", c1.rows as Row[], []);

  const c2 = await db.query("SELECT id FROM orders WHERE note LIKE 'A\\_%' ESCAPE '\\' ORDER BY id");
  diffRows("LIKE ESCAPE _", c2.rows as Row[], [{ id: "o1" }]);

  const c3 = await db.query("SELECT id FROM orders WHERE user_id IN (SELECT id FROM users WHERE tier > 1 AND id = outer.user_id) ORDER BY id");
  diffRows("correlated IN", c3.rows as Row[], [{ id: "o1" }]);

  const c4 = await db.query("SELECT d.id FROM (SELECT id, amount FROM orders WHERE amount >= 20) d WHERE d.amount > 20 ORDER BY d.id");
  diffRows("FROM subquery", c4.rows as Row[], [{ "d.id": "o3" }]);

  const c5 = await db.query("SELECT id FROM users WHERE tier IS NOT DISTINCT FROM NULL ORDER BY id");
  diffRows("IS NOT DISTINCT FROM", c5.rows as Row[], [{ id: "u3" }]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
