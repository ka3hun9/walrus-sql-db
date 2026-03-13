import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { WalrusSqlClient } from "../src/index.js";
import { mapSqliteSql, type SqliteMapKind } from "./sql-compare-dialect.js";

type Row = Record<string, unknown>;
type Profile = "pr" | "nightly";

type Case = {
  category: string;
  name: string;
  walrusSql: string;
  sqliteSql?: string;
  sqliteMap?: SqliteMapKind;
  dialect?: "ansi" | "sqlite" | "postgres" | "mysql" | "sqlserver";
  xfailReason?: string;
};

const setupSql = [
  "CREATE TABLE users (id TEXT, tier INT, name TEXT, city TEXT)",
  "CREATE TABLE orders (id TEXT, user_id TEXT, amount INT, note TEXT, status TEXT)",
  "INSERT INTO users (id, tier, name, city) VALUES ('u1', 3, 'Alice', 'Shanghai')",
  "INSERT INTO users (id, tier, name, city) VALUES ('u2', 1, 'Bob', 'Suzhou')",
  "INSERT INTO users (id, tier, name, city) VALUES ('u3', NULL, 'A_100', NULL)",
  "INSERT INTO users (id, tier, name, city) VALUES ('u4', 2, 'Ann', 'Shanghai')",
  "INSERT INTO orders (id, user_id, amount, note, status) VALUES ('o1', 'u1', 10, 'A_1', 'paid')",
  "INSERT INTO orders (id, user_id, amount, note, status) VALUES ('o2', 'u2', 20, 'A%2', 'shipped')",
  "INSERT INTO orders (id, user_id, amount, note, status) VALUES ('o3', 'u9', 30, NULL, 'paid')",
  "INSERT INTO orders (id, user_id, amount, note, status) VALUES ('o4', 'u4', 25, 'AB', 'draft')",
  "INSERT INTO orders (id, user_id, amount, note, status) VALUES ('o5', 'u1', 60, 'A_9', 'shipped')",
];

const baseCases: Case[] = [
  { category: "compare", name: "basic >", walrusSql: "SELECT id FROM orders WHERE amount > 20 ORDER BY id" },
  { category: "compare", name: "basic <=", walrusSql: "SELECT id FROM orders WHERE amount <= 20 ORDER BY id" },
  { category: "compare", name: "not equal", walrusSql: "SELECT id FROM orders WHERE status <> 'paid' ORDER BY id" },

  { category: "null-3vl", name: "NOT IN + NULL", walrusSql: "SELECT id FROM orders WHERE user_id NOT IN ('u2', NULL) ORDER BY id" },
  { category: "null-3vl", name: "IS NOT DISTINCT FROM", walrusSql: "SELECT id FROM users WHERE tier IS NOT DISTINCT FROM NULL ORDER BY id" },
  { category: "null-3vl", name: "IS DISTINCT FROM", walrusSql: "SELECT id FROM users WHERE tier IS DISTINCT FROM NULL ORDER BY id" },
  { category: "null-3vl", name: "IS NULL", walrusSql: "SELECT id FROM users WHERE city IS NULL ORDER BY id" },

  { category: "like", name: "LIKE ESCAPE _", walrusSql: "SELECT id FROM orders WHERE note LIKE 'A\\_%' ESCAPE '\\' ORDER BY id" },
  { category: "like", name: "LIKE ESCAPE %", walrusSql: "SELECT id FROM orders WHERE note LIKE 'A\\%%' ESCAPE '\\' ORDER BY id" },
  { category: "like", name: "NOT LIKE", walrusSql: "SELECT id FROM orders WHERE note NOT LIKE 'A%' ORDER BY id" },

  { category: "in-between", name: "IN literal", walrusSql: "SELECT id FROM orders WHERE status IN ('paid', 'draft') ORDER BY id" },
  { category: "in-between", name: "BETWEEN", walrusSql: "SELECT id FROM orders WHERE amount BETWEEN 20 AND 30 ORDER BY id" },
  { category: "in-between", name: "NOT BETWEEN", walrusSql: "SELECT id FROM orders WHERE amount NOT BETWEEN 20 AND 30 ORDER BY id" },

  { category: "subquery", name: "EXISTS", walrusSql: "SELECT id FROM orders WHERE EXISTS (SELECT id FROM users WHERE tier >= 3) ORDER BY id" },
  {
    category: "subquery",
    name: "SOME mapped",
    walrusSql: "SELECT id FROM orders WHERE amount > SOME (SELECT tier FROM users) ORDER BY id",
    sqliteMap: "SOME_GT",
  },
  {
    category: "subquery",
    name: "ALL mapped",
    walrusSql: "SELECT id FROM orders WHERE amount > ALL (SELECT tier FROM users) ORDER BY id",
    sqliteMap: "ALL_GT_NULLSAFE",
  },
  {
    category: "subquery",
    name: "FROM subquery",
    walrusSql: "SELECT d.id FROM (SELECT id, amount FROM orders WHERE amount >= 20) d WHERE d.amount > 20 ORDER BY d.id",
    sqliteMap: "DERIVED_ALIAS_DOT",
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
    category: "g3b-fixture",
    name: "correlated exists by outer id",
    walrusSql: "SELECT id FROM users WHERE EXISTS (SELECT id FROM orders WHERE orders.user_id = outer.id AND amount >= 20) ORDER BY id",
    sqliteSql: "SELECT u.id AS id FROM users u WHERE EXISTS (SELECT o.id FROM orders o WHERE o.user_id = u.id AND o.amount >= 20) ORDER BY u.id",
  },
  {
    category: "g3b-fixture",
    name: "expr composed cast nullif",
    walrusSql: "SELECT id FROM orders WHERE CAST(amount AS INT) >= 20 AND NULLIF(status, 'draft') IS NOT NULL ORDER BY id",
  },
  {
    category: "g3b-fixture",
    name: "not in subquery paid users",
    walrusSql: "SELECT id FROM users WHERE id NOT IN (SELECT user_id FROM orders WHERE status = 'paid') ORDER BY id",
  },

  {
    category: "g3d-fixture",
    name: "setop distinct outer order limit offset",
    walrusSql: "SELECT amount AS v FROM orders WHERE amount <= 25 UNION SELECT amount AS x FROM orders WHERE amount >= 25 ORDER BY v DESC LIMIT 3 OFFSET 1",
  },
  {
    category: "g3d-fixture",
    name: "setop all outer order limit offset",
    walrusSql: "SELECT amount AS v FROM orders WHERE amount <= 25 UNION ALL SELECT amount AS x FROM orders WHERE amount >= 25 ORDER BY v ASC LIMIT 4 OFFSET 1",
  },
  {
    category: "g3d-fixture",
    name: "setop window combo derived",
    walrusSql:
      "SELECT uid, amt, ROW_NUMBER() OVER (PARTITION BY uid ORDER BY amt DESC) AS rn FROM (SELECT user_id AS uid, amount AS amt FROM orders WHERE user_id IN ('u1','u4') UNION ALL SELECT user_id AS uid, amount AS amt FROM orders WHERE id='o1') u ORDER BY uid, rn",
    sqliteMap: "ROW_NUMBER_DERIVED",
  },

  { category: "expr", name: "arith precedence", walrusSql: "SELECT id FROM orders WHERE amount + 5 * 2 >= 30 ORDER BY id" },
  { category: "expr", name: "coalesce", walrusSql: "SELECT id FROM orders WHERE COALESCE(note, 'x') = 'x' ORDER BY id" },
  { category: "expr", name: "nullif", walrusSql: "SELECT id FROM users WHERE NULLIF(name, 'Bob') IS NULL ORDER BY id" },
  { category: "expr", name: "cast int", walrusSql: "SELECT id FROM orders WHERE CAST(amount / 10 AS INT) >= 2 ORDER BY id" },
  { category: "expr", name: "case in where", walrusSql: "SELECT id FROM orders WHERE CASE WHEN amount >= 25 THEN 1 ELSE 0 END = 1 ORDER BY id" },
  { category: "expr", name: "unary minus", walrusSql: "SELECT id FROM orders WHERE -amount < -20 ORDER BY id" },

  { category: "logic", name: "AND/OR precedence", walrusSql: "SELECT id FROM orders WHERE (status = 'paid' OR status = 'shipped') AND amount >= 20 ORDER BY id" },
  { category: "logic", name: "NOT", walrusSql: "SELECT id FROM orders WHERE NOT (status = 'paid') ORDER BY id" },

  {
    category: "having",
    name: "having alias compare",
    walrusSql: "SELECT user_id, SUM(amount) AS sum FROM orders GROUP BY user_id HAVING sum >= 30 ORDER BY user_id",
  },
  {
    category: "g5-fixture",
    name: "mysql backtick quoting",
    walrusSql: "SELECT `id` FROM `users` WHERE `city` IS NULL ORDER BY `id`",
    sqliteSql: "SELECT id FROM users WHERE city IS NULL ORDER BY id",
    dialect: "mysql",
  },
  {
    category: "g5-fixture",
    name: "postgres fetch first",
    walrusSql: "SELECT id FROM users ORDER BY id FETCH FIRST 2 ROWS ONLY",
    sqliteSql: "SELECT id FROM users ORDER BY id LIMIT 2",
    dialect: "postgres",
  },
  {
    category: "g5-fixture",
    name: "sqlserver top + bracket quoting",
    walrusSql: "SELECT TOP 2 [id] FROM [orders] ORDER BY [amount] DESC",
    sqliteSql: "SELECT id FROM orders ORDER BY amount DESC LIMIT 2",
    dialect: "sqlserver",
  },
];

const nightlyCases: Case[] = [
  { category: "compare", name: "compare >=", walrusSql: "SELECT id FROM orders WHERE amount >= 25 ORDER BY id" },
  { category: "compare", name: "compare <", walrusSql: "SELECT id FROM orders WHERE amount < 25 ORDER BY id" },
  { category: "null-3vl", name: "city IS NOT NULL", walrusSql: "SELECT id FROM users WHERE city IS NOT NULL ORDER BY id" },
  { category: "like", name: "like plain", walrusSql: "SELECT id FROM orders WHERE note LIKE 'A%' ORDER BY id" },
  { category: "in-between", name: "NOT IN literal", walrusSql: "SELECT id FROM orders WHERE status NOT IN ('paid') ORDER BY id" },
  { category: "expr", name: "cast real", walrusSql: "SELECT id FROM orders WHERE CAST(amount / 4 AS REAL) > 5 ORDER BY id" },
  { category: "expr", name: "coalesce in where nightly", walrusSql: "SELECT id FROM orders WHERE COALESCE(note, 'x') LIKE 'A%' ORDER BY id" },
  { category: "logic", name: "nested boolean", walrusSql: "SELECT id FROM orders WHERE (status='paid' AND amount>20) OR (status='draft' AND amount>=25) ORDER BY id" },
  {
    category: "having",
    name: "having coalesce",
    walrusSql: "SELECT user_id, SUM(amount) AS sum FROM orders GROUP BY user_id HAVING COALESCE(sum, 0) > 20 ORDER BY user_id",
  },
  {
    category: "subquery",
    name: "scalar subquery compare",
    walrusSql: "SELECT id FROM orders WHERE amount > (SELECT MIN(tier) FROM users) ORDER BY id",
    sqliteSql: "SELECT id FROM orders WHERE amount > (SELECT MIN(tier) FROM users WHERE tier IS NOT NULL) ORDER BY id",
  },
];


function makeSafeName(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "case";
}

function buildMreSql(caseName: string, setup: string[], walrusSql: string, sqliteSql: string): string {
  const lines: string[] = [];
  lines.push(`-- MRE for: ${caseName}`);
  lines.push("-- Setup");
  for (const s of setup) lines.push(`${s};`);
  lines.push("");
  lines.push("-- Walrus SQL");
  lines.push(`${walrusSql};`);
  lines.push("");
  lines.push("-- SQLite SQL (mapped when needed)");
  lines.push(`${sqliteSql};`);
  lines.push("");
  lines.push("-- Hint: run both queries after setup and compare ordered JSON rows.");
  return lines.join("\n");
}

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

  const out = spawnSync("python", ["-c", py, payload], { encoding: "utf8" });
  if (out.error) throw new Error(`SQLite runner unavailable: ${out.error.message}`);
  if (out.status !== 0) throw new Error(out.stderr || out.stdout || "sqlite runner failed");
  return JSON.parse(out.stdout.trim() || "[]") as Row[];
}

function printCategorySummary(
  profile: Profile,
  categorySummary: Array<{ category: string; total: number; passed: number; failed: number; xfail: number; xpass: number }>,
): void {
  console.log(`Category summary (${profile}):`);
  for (const s of categorySummary) {
    console.log(
      `  - ${s.category}: total=${s.total}, passed=${s.passed}, failed=${s.failed}, xfail=${s.xfail}, xpass=${s.xpass}`,
    );
  }
}

function parseCategoriesArg(raw?: string): Set<string> | null {
  if (!raw) return null;
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? new Set(items) : null;
}

async function main() {
  const reportPath = process.argv[2] ?? "reports/sql-compare-report.json";
  const mreDir = process.argv[3] ?? "reports/mre";
  const profile = ((process.argv[4] ?? "pr").toLowerCase() as Profile);
  const categoryFilter = parseCategoriesArg(process.argv[5]);
  const selectedRaw = profile === "nightly" ? [...baseCases, ...nightlyCases] : baseCases;
  const selected = categoryFilter ? selectedRaw.filter((c) => categoryFilter.has(c.category)) : selectedRaw;

  const db = new WalrusSqlClient({ packageId: "0xdev", network: "sui-testnet", mode: "simulator" });
  for (const s of setupSql) await db.execute(s);

  const results: Array<Record<string, unknown>> = [];
  let failed = 0;

  mkdirSync(dirname(reportPath), { recursive: true });
  mkdirSync(mreDir, { recursive: true });

  for (const c of selected) {
    const walrusDb = c.dialect
      ? new WalrusSqlClient({ packageId: "0xdev", network: "sui-testnet", mode: "simulator", dialect: c.dialect })
      : db;

    if (c.dialect) {
      for (const s of setupSql) await walrusDb.execute(s);
    }

    const walrusRows = (await walrusDb.query(c.walrusSql)).rows as Row[];
    const sqliteSql = mapSqliteSql(c.walrusSql, c.sqliteSql, c.sqliteMap);
    const sqliteRows = runSqlite(setupSql, sqliteSql);
    const ok = rowsEqual(walrusRows, sqliteRows);
    const expectedFail = Boolean(c.xfailReason);
    const pass = expectedFail ? !ok : ok;

    if (!pass) {
      failed++;
      const safe = makeSafeName(`${c.category}-${c.name}`);
      const mrePath = join(mreDir, `${safe}.sql`);
      writeFileSync(mrePath, buildMreSql(`${c.category}/${c.name}`, setupSql, c.walrusSql, sqliteSql), "utf8");
      console.log(`  MRE written: ${mrePath}`);
    }

    const tag = expectedFail ? (ok ? "XPASS" : "XFAIL") : (ok ? "PASS" : "FAIL");
    console.log(`${tag} :: [${c.category}] ${c.name}`);

    results.push({
      category: c.category,
      name: c.name,
      ok,
      pass,
      expectedFail,
      xfailReason: c.xfailReason ?? null,
      walrusSql: c.walrusSql,
      sqliteSql,
      walrusRows,
      sqliteRows,
    });
  }

  const categories = [...new Set(selected.map((c) => c.category))];
  const categorySummary = categories.map((cat) => {
    const slice = results.filter((r) => r.category === cat);
    const pass = slice.filter((r) => r.pass).length;
    const xfail = slice.filter((r) => r.expectedFail && !r.ok).length;
    const xpass = slice.filter((r) => r.expectedFail && r.ok).length;
    return { category: cat, total: slice.length, passed: pass, failed: slice.length - pass, xfail, xpass };
  });

  const summary = {
    profile,
    categoryFilter: categoryFilter ? [...categoryFilter] : null,
    total: selected.length,
    passed: selected.length - failed,
    failed,
  };

  writeFileSync(reportPath, JSON.stringify({ summary, categorySummary, results }, null, 2), "utf8");
  printCategorySummary(profile, categorySummary);
  console.log(`Report written: ${reportPath}`);

  if (failed) throw new Error(`SQLite matrix compare failed: ${failed}/${selected.length}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
