import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

await db.execute("CREATE TABLE t_ts (id INT PRIMARY KEY, ts TIMESTAMP)");

await db.execute("INSERT INTO t_ts (id, ts) VALUES (1, '2024-01-02 03:04:05')");
await db.execute("INSERT INTO t_ts (id, ts) VALUES (2, '2024-01-02T03:04:05Z')");
await db.execute("INSERT INTO t_ts (id, ts) VALUES (3, '2024-01-02T11:04:05+08:00')");
await db.execute("INSERT INTO t_ts (id, ts) VALUES (4, '2024-01-02T00:34:05-02:30')");

const q = await db.query("SELECT id, ts FROM t_ts ORDER BY id");
assert.equal(q.rows.length, 4);
assert.equal(q.rows[0]!.ts, "2024-01-02T03:04:05Z");
assert.equal(q.rows[1]!.ts, "2024-01-02T03:04:05Z");
assert.equal(q.rows[2]!.ts, "2024-01-02T03:04:05Z");
assert.equal(q.rows[3]!.ts, "2024-01-02T03:04:05Z");

await assert.rejects(
  db.execute("INSERT INTO t_ts (id, ts) VALUES (5, '2024-02-30 03:04:05')"),
  /ERR_TYPE_CONSTRAINT: invalid TIMESTAMP: 2024-02-30 03:04:05/,
);
await assert.rejects(
  db.execute("INSERT INTO t_ts (id, ts) VALUES (6, '2024-01-02T25:00:00')"),
  /ERR_TYPE_CONSTRAINT: invalid TIMESTAMP: 2024-01-02T25:00:00/,
);
await assert.rejects(
  db.execute("INSERT INTO t_ts (id, ts) VALUES (7, '2024-01-02T03:04:05+24:00')"),
  /ERR_TYPE_CONSTRAINT: invalid TIMESTAMP: 2024-01-02T03:04:05\+24:00/,
);
await assert.rejects(
  db.execute("INSERT INTO t_ts (id, ts) VALUES (8, '2024/01/02 03:04:05')"),
  /ERR_TYPE_CONSTRAINT: invalid TIMESTAMP: 2024\/01\/02 03:04:05/,
);

console.log("ok: A-TYPE-012 TIMESTAMP format, timezone policy, serialization");
