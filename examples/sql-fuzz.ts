import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { WalrusSqlClient } from "../src/index.js";

type Row = Record<string, unknown>;

type FuzzCase = {
  id: number;
  sql: string;
};

type FuzzFailure = {
  id: number;
  sql: string;
  walrusRows: Row[];
  sqliteRows: Row[];
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

const fields = ["amount", "status", "user_id", "note"] as const;
const orderFields = ["id", "amount", "status"] as const;
const numLits = [10, 20, 25, 30, 60] as const;
const txtLits = ["'paid'", "'shipped'", "'draft'", "'u1'", "'u2'", "NULL"] as const;

let fuzzSeed = 1337;

function rand(): number {
  fuzzSeed = (fuzzSeed * 1103515245 + 12345) & 0x7fffffff;
  return fuzzSeed / 0x80000000;
}

function pick<T>(arr: readonly T[]): T {
  const idx = Math.floor(rand() * arr.length);
  return arr[idx]!;
}

function maybe(p = 0.5): boolean {
  return rand() < p;
}

function randPredicate(): string {
  const f = pick(fields);
  if (f === "amount") {
    const op = pick([">", ">=", "<", "<=", "=", "!="] as const);
    return `${f} ${op} ${pick(numLits)}`;
  }
  if (f === "status" || f === "user_id") {
    const op = pick(["=", "!="] as const);
    return `${f} ${op} ${pick(txtLits)}`;
  }
  // note
  const form = pick(["isnull", "like", "eq"] as const);
  if (form === "isnull") return `${f} IS ${maybe() ? "NOT " : ""}NULL`;
  if (form === "like") return `${f} ${maybe() ? "NOT " : ""}LIKE 'A%'`;
  return `${f} = ${pick(["'A_1'", "'AB'", "NULL"] as const)}`;
}

function randWhere(): string {
  const a = randPredicate();
  if (!maybe(0.6)) return a;
  const b = randPredicate();
  const op = pick(["AND", "OR"] as const);
  return `(${a}) ${op} (${b})`;
}

function genCase(id: number): FuzzCase {
  const cols = pick([
    "id",
    "id, amount",
    "id, status",
    "id, user_id",
    "id, amount, status",
  ] as const);
  const where = randWhere();
  const order = pick(orderFields);
  const dir = pick(["ASC", "DESC"] as const);
  const limit = maybe(0.7) ? ` LIMIT ${pick([2, 3, 4] as const)}` : "";
  const sql = `SELECT ${cols} FROM orders WHERE ${where} ORDER BY ${order} ${dir}${limit}`;
  return { id, sql };
}

function normalizeRows(rows: Row[]): string[] {
  return rows
    .map((r) => JSON.stringify(Object.keys(r).sort().reduce((acc, k) => ({ ...acc, [k]: r[k] }), {} as Row)))
    .sort();
}

function rowsEqual(a: Row[], b: Row[]): boolean {
  return JSON.stringify(normalizeRows(a)) === JSON.stringify(normalizeRows(b));
}

function runSqlite(query: string): Row[] {
  const payload = Buffer.from(JSON.stringify({ setup: setupSql, query }), "utf8").toString("base64");
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
  if (out.error) throw new Error(`sqlite runner unavailable: ${out.error.message}`);
  if (out.status !== 0) throw new Error(out.stderr || out.stdout || "sqlite failed");
  return JSON.parse(out.stdout.trim() || "[]") as Row[];
}

async function runWalrus(query: string): Promise<Row[]> {
  const db = new WalrusSqlClient({ packageId: "0xdev", network: "sui-testnet", mode: "simulator" });
  for (const s of setupSql) await db.execute(s);
  return (await db.query(query)).rows as Row[];
}

async function evaluate(caseItem: FuzzCase): Promise<FuzzFailure | null> {
  const walrusRows = await runWalrus(caseItem.sql);
  const sqliteRows = runSqlite(caseItem.sql);
  if (rowsEqual(walrusRows, sqliteRows)) return null;
  return { id: caseItem.id, sql: caseItem.sql, walrusRows, sqliteRows };
}

async function reduceFailure(f: FuzzFailure): Promise<FuzzFailure> {
  const tries: string[] = [];
  const mWhere = f.sql.match(/^(SELECT\s+.+?\s+FROM\s+orders\s+WHERE\s+)(.+?)(\s+ORDER\s+BY\s+.+)$/i);
  if (mWhere) {
    const w = mWhere[2]!;
    tries.push(`${mWhere[1]}${w}${mWhere[3]}`);
    const andParts = w.split(/\s+AND\s+/i);
    if (andParts.length > 1) {
      for (const p of andParts) tries.push(`${mWhere[1]}${p.trim()}${mWhere[3]}`);
    }
    const orParts = w.split(/\s+OR\s+/i);
    if (orParts.length > 1) {
      for (const p of orParts) tries.push(`${mWhere[1]}${p.trim()}${mWhere[3]}`);
    }
  }

  const mLimit = f.sql.match(/^(.*)\s+LIMIT\s+\d+\s*$/i);
  if (mLimit) tries.push(mLimit[1]!);

  for (const candidate of tries) {
    const fail = await evaluate({ id: f.id, sql: candidate });
    if (fail) return fail;
  }
  return f;
}

async function main() {
  const outPath = process.argv[2] ?? "reports/sql-fuzz-report.json";
  const mreDir = process.argv[3] ?? "reports/mre-fuzz";
  const rounds = Number(process.argv[4] ?? "50");
  fuzzSeed = Number(process.argv[5] ?? "1337");

  mkdirSync(dirname(outPath), { recursive: true });
  mkdirSync(mreDir, { recursive: true });

  const failures: FuzzFailure[] = [];
  for (let i = 0; i < rounds; i++) {
    const c = genCase(i + 1);
    try {
      const fail = await evaluate(c);
      if (fail) {
        const reduced = await reduceFailure(fail);
        failures.push(reduced);
        const p = join(mreDir, `fuzz-${String(reduced.id).padStart(3, "0")}.sql`);
        writeFileSync(
          p,
          `-- sql-fuzz mismatch #${reduced.id}\n${setupSql.map((s) => s + ";").join("\n")}\n\n-- query\n${reduced.sql};\n`,
          "utf8",
        );
      }
    } catch (e) {
      failures.push({ id: c.id, sql: c.sql, walrusRows: [{ error: String(e) }], sqliteRows: [] });
    }
  }

  const summary = {
    rounds,
    failed: failures.length,
    passed: rounds - failures.length,
  };

  writeFileSync(outPath, JSON.stringify({ summary, failures }, null, 2), "utf8");
  // eslint-disable-next-line no-console
  console.log(`[sql-fuzz] rounds=${rounds} passed=${summary.passed} failed=${summary.failed}`);

  if (failures.length > 0) {
    throw new Error(`[sql-fuzz] mismatches found: ${failures.length}`);
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
