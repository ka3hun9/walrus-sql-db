import { spawnSync } from "node:child_process";
import { WalrusSqlClient } from "../src/index.js";

type Row = Record<string, unknown>;

type Case = {
  name: string;
  walrusSql: string;
  sqliteSql?: string;
};

const setupSql = [
  "CREATE TABLE users (id TEXT, tier INT, name TEXT)",
  "CREATE TABLE orders (id TEXT, user_id TEXT, amount INT, note TEXT)",
  "INSERT INTO users (id, tier, name) VALUES ('u1', 3, 'Alice')",
  "INSERT INTO users (id, tier, name) VALUES ('u2', 1, 'Bob')",
  "INSERT INTO users (id, tier, name) VALUES ('u3', NULL, 'A_100')",
  "INSERT INTO orders (id, user_id, amount, note) VALUES ('o1', 'u1', 10, 'A_1')",
  "INSERT INTO orders (id, user_id, amount, note) VALUES ('o2', 'u2', 20, 'A%2')",
  "INSERT INTO orders (id, user_id, amount, note) VALUES ('o3', 'u9', 30, NULL)",
];

const cases: Case[] = [
  {
    name: "NOT IN + NULL",
    walrusSql: "SELECT id FROM orders WHERE user_id NOT IN ('u2', NULL) ORDER BY id",
  },
  {
    name: "LIKE ESCAPE",
    walrusSql: "SELECT id FROM orders WHERE note LIKE 'A\\_%' ESCAPE '\\' ORDER BY id",
  },
  {
    name: "IS NOT DISTINCT FROM",
    walrusSql: "SELECT id FROM users WHERE tier IS NOT DISTINCT FROM NULL ORDER BY id",
  },
  {
    name: "EXISTS",
    walrusSql: "SELECT id FROM orders WHERE EXISTS (SELECT id FROM users WHERE tier >= 3) ORDER BY id",
  },
  {
    name: "ANY/SOME (dialect gap, mapped)",
    walrusSql: "SELECT id FROM orders WHERE amount > SOME (SELECT tier FROM users) ORDER BY id",
    sqliteSql: "SELECT id FROM orders WHERE amount > (SELECT MIN(tier) FROM users) ORDER BY id",
  },
  {
    name: "FROM subquery",
    walrusSql: "SELECT d.id FROM (SELECT id, amount FROM orders WHERE amount >= 20) d WHERE d.amount > 20 ORDER BY d.id",
    sqliteSql:
      "SELECT d.id AS \"d.id\" FROM (SELECT id, amount FROM orders WHERE amount >= 20) d WHERE d.amount > 20 ORDER BY d.id",
  },
  {
    name: "correlated IN (outer ref mapping)",
    walrusSql: "SELECT id FROM orders WHERE user_id IN (SELECT id FROM users WHERE tier > 1 AND id = outer.user_id) ORDER BY id",
    sqliteSql:
      "SELECT o.id FROM orders o WHERE o.user_id IN (SELECT u.id FROM users u WHERE u.tier > 1 AND u.id = o.user_id) ORDER BY o.id",
  },
];

function normalizeRows(rows: Row[]): string[] {
  return rows
    .map((r) => {
      const sorted = Object.keys(r)
        .sort()
        .reduce((acc, k) => ({ ...acc, [k]: r[k] }), {} as Row);
      return JSON.stringify(sorted);
    })
    .sort();
}

function rowsEqual(a: Row[], b: Row[]): boolean {
  const na = normalizeRows(a);
  const nb = normalizeRows(b);
  return JSON.stringify(na) === JSON.stringify(nb);
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
rows = [dict(r) for r in cur.fetchall()]
print(json.dumps(rows, ensure_ascii=False))
`;

  const candidates: Array<[string, string[]]> = [
    ["python", ["-c", py, payload]],
    ["py", ["-3", "-c", py, payload]],
  ];

  let lastErr = "";
  for (const [cmd, args] of candidates) {
    const out = spawnSync(cmd, args, { encoding: "utf8" });
    if (out.error) {
      lastErr = out.error.message;
      continue;
    }
    if (out.status !== 0) {
      lastErr = out.stderr || out.stdout || `exit=${out.status}`;
      continue;
    }
    return JSON.parse(out.stdout.trim() || "[]") as Row[];
  }

  throw new Error(`Unable to execute SQLite via Python: ${lastErr}`);
}

async function main() {
  const db = new WalrusSqlClient({ packageId: "0xdev", network: "sui-testnet", mode: "simulator" });
  for (const s of setupSql) await db.execute(s);

  let failed = 0;
  for (const c of cases) {
    const walrusRows = (await db.query(c.walrusSql)).rows as Row[];
    const sqliteRows = runSqlite(setupSql, c.sqliteSql ?? c.walrusSql);
    const ok = rowsEqual(walrusRows, sqliteRows);

    console.log(`${ok ? "PASS" : "FAIL"} :: ${c.name}`);
    if (!ok) {
      failed++;
      console.log("  walrus =>", walrusRows);
      console.log("  sqlite =>", sqliteRows);
      console.log("  walrusSql =>", c.walrusSql);
      if (c.sqliteSql) console.log("  sqliteSql =>", c.sqliteSql);
    }
  }

  if (failed > 0) {
    throw new Error(`SQLite compare failed: ${failed} case(s)`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
