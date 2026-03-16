import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator" });

const parsedDefault = (db as unknown as {
  parseDefaultLiteral: (raw: string, context: string) => { hasDefault: boolean; typedValue?: { value: unknown; metadata: { source: string; sourceContext?: string } } };
}).parseDefaultLiteral("NOT NULL DEFAULT 42", "ddl.default.create:t_bind.score");
assert.equal(parsedDefault.hasDefault, true);
assert.equal(parsedDefault.typedValue?.value, 42);
assert.equal(parsedDefault.typedValue?.metadata.source, "literal");
assert.equal(parsedDefault.typedValue?.metadata.sourceContext, "ddl.default.create:t_bind.score");

const parsedInsert = (db as unknown as {
  parseInsert: (sql: string) => {
    row: Record<string, unknown>;
    bindings: Record<string, { value: unknown; metadata: { source: string; sourceContext?: string } }>;
  };
}).parseInsert("INSERT INTO t_bind (id, name) VALUES (1, 'alice')");
assert.equal(parsedInsert.row.id, 1);
assert.equal(parsedInsert.bindings.id?.metadata.source, "literal");
assert.equal(parsedInsert.bindings.id?.metadata.sourceContext, "dml.insert.value:t_bind.id");
assert.equal(parsedInsert.bindings.name?.metadata.sourceContext, "dml.insert.value:t_bind.name");

await db.execute("CREATE TABLE t_bind (id INT PRIMARY KEY, name TEXT, score INT NOT NULL DEFAULT 7)");
await db.execute("INSERT INTO t_bind (id, name) VALUES (1, 'alice')");
await db.execute("UPDATE t_bind SET score = 9 WHERE id = 1");

const q = await db.query("SELECT id, name, score FROM t_bind ORDER BY id");
assert.deepEqual(q.rows, [{ id: 1, name: "alice", score: 9 }]);

console.log("ok: K-TVAL-006 parameter/default binding typed value context");
