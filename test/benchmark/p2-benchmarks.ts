import { performance } from "node:perf_hooks";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { WalrusSqlClient } from "./client.js";

export interface P2TpccMiniConfig {
  warehouses: number;
  districtsPerWarehouse: number;
  customersPerDistrict: number;
  ordersPerDistrict: number;
  linesPerOrder: number;
}

export interface P2ConflictBenchConfig {
  rounds: number;
}

export interface P2LongRunConfig {
  durationMs: number;
  writeEveryMs: number;
}

export interface P2BenchSample {
  name: string;
  operations: number;
  durationMs: number;
  opsPerSec: number;
  avgLatencyMs?: number;
  conflicts?: number;
}

export interface P2BenchReport {
  generatedAt: string;
  samples: P2BenchSample[];
  notes?: string[];
}

const defaultTpccMiniConfig: P2TpccMiniConfig = {
  warehouses: 1,
  districtsPerWarehouse: 2,
  customersPerDistrict: 20,
  ordersPerDistrict: 30,
  linesPerOrder: 3,
};

const defaultConflictConfig: P2ConflictBenchConfig = { rounds: 40 };
const defaultLongRunConfig: P2LongRunConfig = { durationMs: 8_000, writeEveryMs: 30 };

function mkClient(): WalrusSqlClient {
  return new WalrusSqlClient({ packageId: "0x1", network: "sui-testnet", mode: "simulator", isolationLevel: "read_committed" });
}

function toOpsPerSec(operations: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Number(((operations * 1000) / durationMs).toFixed(2));
}

function shareCommittedStore(source: WalrusSqlClient, target: WalrusSqlClient): void {
  const src = source as unknown as Record<string, unknown>;
  const dst = target as unknown as Record<string, unknown>;
  dst.tables = src.tables;
  dst.schemas = src.schemas;
  dst.uniqueIndexes = src.uniqueIndexes;
  dst.uniqueGroupsCache = src.uniqueGroupsCache;
  dst.constraintCost = src.constraintCost;
  dst.rowVersions = src.rowVersions;
}

export async function runP2TpccMiniBenchmark(config?: Partial<P2TpccMiniConfig>): Promise<P2BenchReport> {
  const c: P2TpccMiniConfig = {
    warehouses: Math.max(1, config?.warehouses ?? defaultTpccMiniConfig.warehouses),
    districtsPerWarehouse: Math.max(1, config?.districtsPerWarehouse ?? defaultTpccMiniConfig.districtsPerWarehouse),
    customersPerDistrict: Math.max(1, config?.customersPerDistrict ?? defaultTpccMiniConfig.customersPerDistrict),
    ordersPerDistrict: Math.max(1, config?.ordersPerDistrict ?? defaultTpccMiniConfig.ordersPerDistrict),
    linesPerOrder: Math.max(1, config?.linesPerOrder ?? defaultTpccMiniConfig.linesPerOrder),
  };

  const db = mkClient();
  await db.execute("CREATE TABLE wh (w_id INT PRIMARY KEY, w_name TEXT)");
  await db.execute("CREATE TABLE dist (d_id INT PRIMARY KEY, w_id INT, next_o_id INT)");
  await db.execute("CREATE TABLE cust (c_id INT PRIMARY KEY, d_id INT, balance INT)");
  await db.execute("CREATE TABLE ord (o_id INT PRIMARY KEY, d_id INT, c_id INT, total INT)");
  await db.execute("CREATE TABLE ord_line (ol_id INT PRIMARY KEY, o_id INT, amount INT)");

  let districtId = 1;
  let customerId = 1;
  for (let w = 1; w <= c.warehouses; w++) {
    await db.execute(`INSERT INTO wh (w_id, w_name) VALUES (${w}, 'W${w}')`);
    for (let d = 1; d <= c.districtsPerWarehouse; d++) {
      await db.execute(`INSERT INTO dist (d_id, w_id, next_o_id) VALUES (${districtId}, ${w}, 1)`);
      for (let i = 0; i < c.customersPerDistrict; i++) {
        await db.execute(`INSERT INTO cust (c_id, d_id, balance) VALUES (${customerId}, ${districtId}, 0)`);
        customerId += 1;
      }
      districtId += 1;
    }
  }

  let orderId = 1;
  let lineId = 1;
  const latencies: number[] = [];
  const txOps = c.warehouses * c.districtsPerWarehouse * c.ordersPerDistrict;
  const t0 = performance.now();

  for (let d = 1; d <= c.warehouses * c.districtsPerWarehouse; d++) {
    for (let i = 0; i < c.ordersPerDistrict; i++) {
      const cId = ((d - 1) * c.customersPerDistrict) + ((i % c.customersPerDistrict) + 1);
      const txStart = performance.now();
      await db.execute("BEGIN");
      const nextOrderIdRow = await db.query(`SELECT next_o_id FROM dist WHERE d_id = ${d}`);
      const nextOrderId = Number(nextOrderIdRow.rows[0]?.next_o_id ?? 1);
      await db.execute(`UPDATE dist SET next_o_id = ${nextOrderId + 1} WHERE d_id = ${d}`);
      let total = 0;
      for (let l = 1; l <= c.linesPerOrder; l++) {
        const amount = ((i + l) % 17) + 1;
        total += amount;
        await db.execute(`INSERT INTO ord_line (ol_id, o_id, amount) VALUES (${lineId}, ${orderId}, ${amount})`);
        lineId += 1;
      }
      await db.execute(`INSERT INTO ord (o_id, d_id, c_id, total) VALUES (${orderId}, ${d}, ${cId}, ${total})`);
      const balanceRow = await db.query(`SELECT balance FROM cust WHERE c_id = ${cId}`);
      const balance = Number(balanceRow.rows[0]?.balance ?? 0);
      await db.execute(`UPDATE cust SET balance = ${balance + total} WHERE c_id = ${cId}`);
      await db.execute("COMMIT");
      latencies.push(performance.now() - txStart);
      orderId += 1;
    }
  }

  const t1 = performance.now();
  const countOrders = await db.query("SELECT COUNT(*) FROM ord");
  const countLines = await db.query("SELECT COUNT(*) FROM ord_line");

  const avgLatencyMs = Number((latencies.reduce((a, b) => a + b, 0) / Math.max(1, latencies.length)).toFixed(3));
  const durationMs = Number((t1 - t0).toFixed(3));

  return {
    generatedAt: new Date().toISOString(),
    samples: [
      {
        name: "p2_tpcc_mini_new_order",
        operations: txOps,
        durationMs,
        opsPerSec: toOpsPerSec(txOps, durationMs),
        avgLatencyMs,
      },
    ],
    notes: [
      `orders=${countOrders.rows[0]?.count ?? 0}`,
      `order_lines=${countLines.rows[0]?.count ?? 0}`,
      `expected_order_lines=${txOps * c.linesPerOrder}`,
    ],
  };
}

export async function runP2ConflictBenchmark(config?: Partial<P2ConflictBenchConfig>): Promise<P2BenchReport> {
  const c: P2ConflictBenchConfig = { rounds: Math.max(1, config?.rounds ?? defaultConflictConfig.rounds) };
  const s1 = mkClient();
  const s2 = mkClient();
  shareCommittedStore(s1, s2);

  await s1.execute("CREATE TABLE tx_conf (id INT PRIMARY KEY, v INT)");
  await s1.execute("INSERT INTO tx_conf (id, v) VALUES (1, 0)");

  let conflicts = 0;
  const latencies: number[] = [];
  const t0 = performance.now();

  for (let i = 1; i <= c.rounds; i++) {
    await s1.execute("BEGIN");
    await s2.execute("BEGIN");
    await s1.execute(`UPDATE tx_conf SET v = ${i} WHERE id = 1`);
    await s2.execute(`UPDATE tx_conf SET v = ${i + 1000} WHERE id = 1`);

    const c1 = performance.now();
    await s1.execute("COMMIT");
    latencies.push(performance.now() - c1);

    const c2 = performance.now();
    try {
      await s2.execute("COMMIT");
    } catch {
      conflicts += 1;
      try {
        await s2.execute("ROLLBACK");
      } catch {
        // noop
      }
    }
    latencies.push(performance.now() - c2);
  }

  const t1 = performance.now();
  const durationMs = Number((t1 - t0).toFixed(3));
  const avgLatencyMs = Number((latencies.reduce((a, b) => a + b, 0) / Math.max(1, latencies.length)).toFixed(3));

  return {
    generatedAt: new Date().toISOString(),
    samples: [
      {
        name: "p2_tx_conflict_commit",
        operations: c.rounds * 2,
        durationMs,
        opsPerSec: toOpsPerSec(c.rounds * 2, durationMs),
        avgLatencyMs,
        conflicts,
      },
    ],
    notes: [`rounds=${c.rounds}`, `conflicts=${conflicts}`],
  };
}

export async function runP2LongRunStability(config?: Partial<P2LongRunConfig>): Promise<P2BenchReport> {
  const c: P2LongRunConfig = {
    durationMs: Math.max(2000, config?.durationMs ?? defaultLongRunConfig.durationMs),
    writeEveryMs: Math.max(5, config?.writeEveryMs ?? defaultLongRunConfig.writeEveryMs),
  };

  const db = mkClient();
  await db.execute("CREATE TABLE long_run (id INT PRIMARY KEY, v INT)");

  const start = performance.now();
  let nextId = 1;
  let writes = 0;
  let consistencyChecks = 0;
  let errors = 0;

  while (performance.now() - start < c.durationMs) {
    try {
      await db.execute("BEGIN");
      await db.execute(`INSERT INTO long_run (id, v) VALUES (${nextId}, ${nextId * 10})`);
      await db.execute("COMMIT");
      writes += 1;
      nextId += 1;

      if (writes % 10 === 0) {
        const out = await db.query("SELECT COUNT(*) FROM long_run");
        const count = Number(out.rows[0]?.count ?? -1);
        if (count !== writes) throw new Error(`count mismatch: expected=${writes} actual=${count}`);
        consistencyChecks += 1;
      }
    } catch {
      errors += 1;
      try {
        await db.execute("ROLLBACK");
      } catch {
        // noop
      }
    }

    if (c.writeEveryMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, c.writeEveryMs));
    }
  }

  const durationMs = Number((performance.now() - start).toFixed(3));
  return {
    generatedAt: new Date().toISOString(),
    samples: [
      {
        name: "p2_long_run_stability",
        operations: writes,
        durationMs,
        opsPerSec: toOpsPerSec(writes, durationMs),
      },
    ],
    notes: [`consistency_checks=${consistencyChecks}`, `errors=${errors}`],
  };
}

export async function writeP2BenchReport(path: string, report: P2BenchReport): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
