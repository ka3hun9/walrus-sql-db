import { strict as assert } from "node:assert";
import { WalrusSqlClient } from "../src/client.js";

const db = new WalrusSqlClient({
  packageId: "0x1",
  network: "sui-testnet",
  mode: "simulator",
});

await db.execute("CREATE TABLE view006_base (id INT PRIMARY KEY, qty INT)");
await db.execute("CREATE TABLE view006_sink (id INT PRIMARY KEY, qty INT)");
await db.execute("INSERT INTO view006_base (id, qty) VALUES (1, 10)");
await db.execute("INSERT INTO view006_sink (id, qty) VALUES (1, 99)");
await db.execute("CREATE VIEW view006_readonly AS SELECT id, qty FROM view006_base");

await assert.rejects(
  db.execute("INSERT INTO view006_readonly (id, qty) VALUES (2, 20)"),
  /ERR_UNSUPPORTED_INSERT: updatable view is deferred in Phase 3: INSERT target cannot reference view VIEW006_READONLY/i,
);

await assert.rejects(
  db.execute("UPDATE view006_readonly SET qty = 20 WHERE id = 1"),
  /ERR_UNSUPPORTED_UPDATE: updatable view is deferred in Phase 3: UPDATE target cannot reference view VIEW006_READONLY/i,
);

await assert.rejects(
  db.execute("DELETE FROM view006_readonly WHERE id = 1"),
  /ERR_UNSUPPORTED_DELETE: updatable view is deferred in Phase 3: DELETE target cannot reference view VIEW006_READONLY/i,
);

await assert.rejects(
  db.execute(
    "UPDATE view006_sink AS s INNER JOIN view006_readonly AS v ON s.id = v.id SET s.qty = 0 WHERE v.id = 1",
  ),
  /ERR_UNSUPPORTED_UPDATE: updatable view is deferred in Phase 3: UPDATE source cannot reference view VIEW006_READONLY/i,
);

await assert.rejects(
  db.execute(
    "DELETE s FROM view006_sink AS s INNER JOIN view006_readonly AS v ON s.id = v.id WHERE v.id = 1",
  ),
  /ERR_UNSUPPORTED_DELETE: updatable view is deferred in Phase 3: DELETE source cannot reference view VIEW006_READONLY/i,
);

{
  const baseRows = await db.query("SELECT id, qty FROM view006_base ORDER BY id ASC");
  assert.deepEqual(baseRows.rows, [{ id: 1, qty: 10 }]);
}

{
  const sinkRows = await db.query("SELECT id, qty FROM view006_sink ORDER BY id ASC");
  assert.deepEqual(sinkRows.rows, [{ id: 1, qty: 99 }]);
}

{
  const viewRows = await db.query("SELECT id, qty FROM view006_readonly ORDER BY id ASC");
  assert.deepEqual(viewRows.rows, [{ id: 1, qty: 10 }]);
}

console.log("ok: P3-VIEW-006 updatable-view deferred boundary and error-code contract");
