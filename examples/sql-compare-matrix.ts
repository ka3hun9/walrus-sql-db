import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { WalrusSqlClient } from "../src/index.js";

type Row = Record<string, unknown>;

type Case = {
  category: string;
  name: string;
  walrusSql: string;
  sqliteSql?: string;
};

const setupSql = [
  "CREATE TABLE users (id TEXT, tier INT, name TEXT)",
  "CREATE TABLE orders (id TEXT, user_id TEXT, amount INT, note TEXT, status TEXT)",
  "INSERT INTO users (id, tier, name) VALUES ('u1', 3, 'Alice')",
  "INSERT INTO users (id, tier, name) VALUES ('u2', 1, 'Bob')",
  "INSERT INTO users (id, tier, name) VALUES ('u3', NULL, 'A_100')",
  "INSERT INTO users (id, tier, name) VALUES ('u4', 2, 'Ann')",
  "INSERT INTO orders (id, user_id, amount, note, status) VALUES ('o1', 'u1', 10, 'A_1', 'paid')",
  "INSERT INTO orders (id, user_id, amount, note, status) VALUES ('o2', 'u2', 20, 'A%2', 'shipped')",
  "INSERT INTO orders (id, user_id, amount, note, status) VALUES ('o3', 'u9', 30, NULL, 'paid')",
  "INSERT INTO orders (id, user_id, amount, note, status) VALUES ('o4', 'u4', 25, 'AB', 'draft')",
];

const cases: Case[] = [
  { category: "compare", name: "basic >", walrusSql: "SELECT id FROM orders WHERE amount > 20 ORDER BY id" },
  { category: "compare", name: "basic <=", walrusSql: "SELECT id FROM orders WHERE amount <= 20 ORDER BY id" },
  { category: "null-3vl", name: "NOT IN + NULL", walrusSql: "SELECT id FROM orders WHERE user_id NOT IN ('u2', NULL) ORDER BY id" },
  { category: "null-3vl", name: "IS NOT DISTINCT FROM", walrusSql: "SELECT id FROM users WHERE tier IS NOT DISTINCT FROM NULL ORDER BY id" },
  { category: "null-3vl", name: "IS DISTINCT FROM", walrusSql: "SELECT id FROM users WHERE tier IS DISTINCT FROM NULL ORDER BY id" },
  { category: "like", name: "LIKE ESCAPE _", walrusSql: "SELECT id FROM orders WHERE note LIKE 'A\\_%' ESCAPE '\\' ORDER BY id" },
  { category: "like", name: "NOT LIKE", walrusSql: "SELECT id FROM orders WHERE note NOT LIKE 'A%' ORDER BY id" },
  { category: "subquery", name: "EXISTS", walrusSql: "SELECT id FROM orders WHERE EXISTS (SELECT id FROM users WHERE tier >= 3) ORDER BY id" },
  {
    category: "subquery",
    name: "SOME mapped",
    walrusSql: "SELECT id FROM orders WHERE amount > SOME (SELECT tier FROM users) ORDER BY id",
    sqliteSql: "SELECT id FROM orders WHERE amount > (SELECT MIN(tier) FROM users) ORDER BY id",
  },
  {
    category: "subquery",
    name: "ALL mapped",
    walrusSql: "SELECT id FROM orders WHERE amount > ALL (SELECT tier FROM users) ORDER BY id",
    sqliteSql:
      "SELECT id FROM orders WHERE (SELECT COUNT(*) FROM users) = 0 OR ((SELECT COUNT(*) FROM users WHERE tier IS NULL) = 0 AND amount > (SELECT MAX(tier) FROM users WHERE tier IS NOT NULL)) ORDER BY id",
  },
  {
    category: "subquery",
    name: "FROM subquery",
    walrusSql: "SELECT d.id FROM (SELECT id, amount FROM orders WHERE amount >= 20) d WHERE d.amount > 20 ORDER BY d.id",
    sqliteSql: "SELECT d.id AS \"d.id\" FROM (SELECT id, amount FROM orders WHERE amount >= 20) d WHERE d.amount > 20 ORDER BY d.id",
  },
  {
    category: "correlated",
    name: "correlated IN",
    walrusSql: "SELECT id FROM orders WHERE user_id IN (SELECT id FROM users WHERE tier > 1 AND id = outer.user_id) ORDER BY id",
    sqliteSql: "SELECT o.id AS id FROM orders o WHERE o.user_id IN (SELECT u.id FROM users u WHERE u.tier > 1 AND u.id = o.user_id) ORDER BY o.id",
  },
  {
    category: "correlated",
    name: "correlated EXISTS",
    walrusSql: "SELECT id FROM orders WHERE EXISTS (SELECT id FROM users WHERE id = outer.user_id AND tier >= 2) ORDER BY id",
    sqliteSql: "SELECT o.id AS id FROM orders o WHERE EXISTS (SELECT u.id FROM users u WHERE u.id = o.user_id AND u.tier >= 2) ORDER BY o.id",
  },
  {
    category: "logic",
    name: "AND/OR precedence",
    walrusSql: "SELECT id FROM orders WHERE (status = 'paid' OR status = 'shipped') AND amount >= 20 ORDER BY id",
  },
];

function normalizeRows(rows: Row[]): string[] {
  return rows
    .map((r) => JSON.stringify(Object.keys(r).sort().reduce((acc, k) => ({ ...acc, [k]: r[k] }), {} as Row)))
    .sort();
}

function rowsEqual(a: Row[], b: Row[]): boolean {
  return JSON.stringify(normalizeRows(a)) === JSON.stringify(normalizeRows(b));
}

function runSqlite(setup: string[], query: string): Row[] {
  const payload = Buffer.from(JSON.stringify({ setup, query }), "utf8").toString("base64");
  const py = String.raw`
import base64, json, sqlite3, sys
payload = json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))
conn = sqlite3.connect(":memory:")
conn.row_factory = sqlite3.Row
cur = conn.cursor()
for s in payload["setup"]:
    cur.execute(s)
cur.execute(payload["query"])
print(json.dumps([dict(r) for r in cur.fetchall()], ensure_ascii=False))
`;

  const tried: string[] = [];
  for (const [cmd, args] of [["python", ["-c", py, payload]] as const]) {
    tried.push(cmd);
    const out = spawnSync(cmd, args, { encoding: "utf8" });
    if (out.error) continue;
    if (out.status !== 0) throw new Error(out.stderr || out.stdout || `sqlite runner failed: ${cmd}`);
    return JSON.parse(out.stdout.trim() || "[]") as Row[];
  }

  throw new Error(`SQLite runner unavailable. Tried: ${tried.join(", ")}`);
}

async function main() {
  const reportPath = process.argv[2] ?? "reports/sql-compare-report.json";
  const db = new WalrusSqlClient({ packageId: "0xdev", network: "sui-testnet", mode: "simulator" });
  for (const s of setupSql) await db.execute(s);

  const results: Array<Record<string, unknown>> = [];
  let failed = 0;

  for (const c of cases) {
    const walrusRows = (await db.query(c.walrusSql)).rows as Row[];
    const sqliteRows = runSqlite(setupSql, c.sqliteSql ?? c.walrusSql);
    const ok = rowsEqual(walrusRows, sqliteRows);
    if (!ok) failed++;

    console.log(`${ok ? "PASS" : "FAIL"} :: [${c.category}] ${c.name}`);

    results.push({
      category: c.category,
      name: c.name,
      ok,
      walrusSql: c.walrusSql,
      sqliteSql: c.sqliteSql ?? c.walrusSql,
      walrusRows,
      sqliteRows,
    });
  }

  const summary = {
    total: cases.length,
    passed: cases.length - failed,
    failed,
  };

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ summary, results }, null, 2), "utf8");
  console.log(`Report written: ${reportPath}`);

  if (failed) throw new Error(`SQLite matrix compare failed: ${failed}/${cases.length}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
