import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WalrusSqlClient } from "../src/client.js";

const table = "p3_mile1_users";
const scoreIndex = "idx_p3_mile1_score";

const walDir = await mkdtemp(join(tmpdir(), "walrus-sql-p3-mile-001-"));
const walPath = join(walDir, "txn.wal.ndjson");
let commitExecutorCalls = 0;

try {
  const db = new WalrusSqlClient({
    packageId: "0x1",
    network: "sui-testnet",
    mode: "simulator",
    readCache: { enabled: false },
    wal: { enabled: true, filePath: walPath },
    transactionCommitExecutor: async () => {
      commitExecutorCalls += 1;
      if (commitExecutorCalls === 2) throw new Error("milestone commit bridge interrupted");
      return { digest: `ok-${commitExecutorCalls}` };
    },
  });

  await db.execute(`CREATE TABLE ${table} (id INT PRIMARY KEY, score INT, email TEXT)`);
  await db.execute(`CREATE INDEX ${scoreIndex} ON ${table}(score)`);

  await db.execute(`INSERT INTO ${table} (id, score, email) VALUES (1, 10, 'u1@x.com')`);
  await db.execute(`INSERT INTO ${table} (id, score, email) VALUES (2, 20, 'u2@x.com')`);
  await db.execute(`INSERT INTO ${table} (id, score, email) VALUES (3, 30, 'u3@x.com')`);

  const catalog = db.getIndexCatalog(table);
  const btreeEntry = catalog.find((entry) => entry.name.toUpperCase() === scoreIndex.toUpperCase());
  assert.ok(btreeEntry);
  assert.equal(btreeEntry?.type, "BTREE");
  assert.equal(btreeEntry?.status, "ACTIVE");

  const explainPk = (await db.query(`EXPLAIN SELECT id FROM ${table} WHERE id = 2`)).rows[0]!;
  assert.equal(explainPk.physicalAccessPath, "HASH_INDEX_LOOKUP");
  assert.equal(explainPk.physicalIndexStrategy, "INDEX_SCAN");

  const explainScore = (await db.query(`EXPLAIN SELECT score FROM ${table} WHERE score >= 20`)).rows[0]!;
  assert.equal(explainScore.physicalAccessPath, "BTREE_INDEX_LOOKUP");
  assert.equal(explainScore.physicalIndexStrategy, "INDEX_SCAN");

  await db.execute("BEGIN");
  await db.execute(`UPDATE ${table} SET score = 15 WHERE id = 1`);
  await db.execute("COMMIT");

  await db.execute("BEGIN");
  await db.execute(`INSERT INTO ${table} (id, score, email) VALUES (4, 35, 'u4@x.com')`);
  await db.execute(`UPDATE ${table} SET score = 27 WHERE id = 2`);
  await assert.rejects(db.execute("COMMIT"), /milestone commit bridge interrupted/);

  const pendingBeforeRecovery = await db.recoverPendingTransactionLogsFromWal();
  assert.equal(pendingBeforeRecovery.length, 1);

  const internals = db as unknown as {
    tables: Map<string, Array<Record<string, unknown>>>;
    hashIndexes: Map<string, unknown>;
    hashIndexStats: Map<string, unknown>;
    btreeIndexes: Map<string, unknown>;
    btreeIndexStats: Map<string, unknown>;
  };
  internals.tables.set(table, [{ id: 999, score: 999, email: "corrupted" }]);
  internals.hashIndexes.delete(table);
  internals.hashIndexStats.delete(table);
  internals.btreeIndexes.delete(table);
  internals.btreeIndexStats.delete(table);

  const recovery = await db.recoverConsistentStateFromWalAndVersionChain({ pendingStrategy: "replay" });
  assert.equal(recovery.strategy, "replay");
  assert.equal(recovery.pendingBefore.length, 1);
  assert.deepEqual(recovery.pendingAfter, []);

  const recovered = (await db.query(`SELECT id, score FROM ${table} ORDER BY id ASC`)).rows;
  assert.deepEqual(recovered, [
    { id: 1, score: 15 },
    { id: 2, score: 27 },
    { id: 3, score: 30 },
    { id: 4, score: 35 },
  ]);

  const explainRecoveredScore = (await db.query(
    `EXPLAIN SELECT score FROM ${table} WHERE score >= 30 AND score < 36`,
  )).rows[0]!;
  assert.equal(explainRecoveredScore.physicalAccessPath, "BTREE_INDEX_LOOKUP");
  assert.equal(explainRecoveredScore.physicalIndexStrategy, "INDEX_SCAN");

  const btreeStats = db.getBtreeIndexStats(table);
  assert.equal(btreeStats.length, 1);
  assert.equal(btreeStats[0]?.rowsIndexed, 4);
}
finally {
  await rm(walDir, { recursive: true, force: true });
}

const checklist = readFileSync("docs/roadmap-100-checklist.md", "utf8");
assert.equal(/- \[ \] P3-MILE-001\b/.test(checklist), false, "P3-MILE-001 must be checked");

const report = readFileSync("docs/sql-p3-mile-001-index-system-acceptance-report.md", "utf8");
assert.ok(report.includes("## P3-MILE-001"));
assert.ok(report.includes("CREATE INDEX"));
assert.ok(report.includes("INDEX_SCAN"));
assert.ok(report.includes("recoverConsistentStateFromWalAndVersionChain"));
assert.ok(report.includes("PASS"));

console.log("ok: P3-MILE-001 index system acceptance (create index/hit/recovery consistency)");
