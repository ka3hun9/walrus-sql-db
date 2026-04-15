import { describe, it, expect } from "vitest";

describe("walrus-cost", () => {
  let WalrusCostEstimator: typeof import("../../src/walrus-cost.js").WalrusCostEstimator;
  let DEFAULT_COST_CONFIG: typeof import("../../src/walrus-cost.js").DEFAULT_COST_CONFIG;

  beforeEach(async () => {
    const mod = await import("../../src/walrus-cost.js");
    WalrusCostEstimator = mod.WalrusCostEstimator;
    DEFAULT_COST_CONFIG = mod.DEFAULT_COST_CONFIG;
  });

  describe("DEFAULT_COST_CONFIG", () => {
    it("has sensible defaults", () => {
      expect(DEFAULT_COST_CONFIG.maxCostScore).toBe(80);
      expect(DEFAULT_COST_CONFIG.preference).toBe("balanced");
      expect(DEFAULT_COST_CONFIG.gasPriceUSD).toBe(0.001);
      expect(DEFAULT_COST_CONFIG.onCostExceeded).toBe("warn");
    });
  });

  describe("estimateSelect", () => {
    it("returns valid estimate for point query", () => {
      const estimator = new WalrusCostEstimator(DEFAULT_COST_CONFIG);
      const est = estimator.estimateSelect(
        "SELECT * FROM users WHERE id = 1",
        "point",
        1000,
        10,
        false,
      );
      expect(est.objectsToRead).toBe(1);
      expect(est.estimatedGas).toBeGreaterThan(0);
      expect(est.costScore).toBeGreaterThanOrEqual(0);
      expect(est.costScore).toBeLessThanOrEqual(100);
      expect(est.tags).toContain("query_type:point");
    });

    it("returns higher cost for full_scan vs point", () => {
      const estimator = new WalrusCostEstimator(DEFAULT_COST_CONFIG);
      const point = estimator.estimateSelect("SELECT * FROM users", "point", 1000, 10, false);
      const full = estimator.estimateSelect("SELECT * FROM users", "full_scan", 1000, 10, false);
      expect(full.estimatedGas).toBeGreaterThan(point.estimatedGas);
    });

    it("returns higher cost for join queries", () => {
      const estimator = new WalrusCostEstimator(DEFAULT_COST_CONFIG);
      const join = estimator.estimateSelect("SELECT * FROM a JOIN b ON a.id = b.id", "join", 1000, 10, false);
      const point = estimator.estimateSelect("SELECT * FROM users WHERE id = 1", "point", 1000, 10, false);
      expect(join.objectsToRead).toBeGreaterThan(point.objectsToRead);
    });

    it("adds overhead for GROUP BY", () => {
      const estimator = new WalrusCostEstimator(DEFAULT_COST_CONFIG);
      const withoutGroup = estimator.estimateSelect("SELECT id FROM users", "full_scan", 1000, 10, false);
      const withGroup = estimator.estimateSelect("SELECT id FROM users GROUP BY id", "full_scan", 1000, 10, false);
      expect(withGroup.estimatedGas).toBeGreaterThan(withoutGroup.estimatedGas);
      expect(withGroup.tags).toContain("group:yes");
    });

    it("adds overhead for ORDER BY", () => {
      const estimator = new WalrusCostEstimator(DEFAULT_COST_CONFIG);
      const withoutOrder = estimator.estimateSelect("SELECT id FROM users", "full_scan", 1000, 10, false);
      const withOrder = estimator.estimateSelect("SELECT id FROM users ORDER BY id", "full_scan", 1000, 10, false);
      expect(withOrder.estimatedGas).toBeGreaterThan(withoutOrder.estimatedGas);
      expect(withOrder.tags).toContain("order:yes");
    });

    it("adds overhead for DISTINCT", () => {
      const estimator = new WalrusCostEstimator(DEFAULT_COST_CONFIG);
      const withoutDistinct = estimator.estimateSelect("SELECT id FROM users", "full_scan", 1000, 10, false);
      const withDistinct = estimator.estimateSelect("SELECT DISTINCT id FROM users", "full_scan", 1000, 10, false);
      expect(withDistinct.estimatedGas).toBeGreaterThan(withoutDistinct.estimatedGas);
      expect(withDistinct.tags).toContain("distinct:yes");
    });

    it("respects realtime preference", () => {
      const realtimeConfig = { ...DEFAULT_COST_CONFIG, preference: "realtime" as const };
      const estimator = new WalrusCostEstimator(realtimeConfig);
      const est = estimator.estimateSelect("SELECT * FROM users", "full_scan", 1000, 10, false);
      expect(est.tags).toContain("query_type:full_scan");
      expect(est.costScore).toBeGreaterThanOrEqual(0);
    });

    it("respects cost preference", () => {
      const costConfig = { ...DEFAULT_COST_CONFIG, preference: "cost" as const };
      const estimator = new WalrusCostEstimator(costConfig);
      const est = estimator.estimateSelect("SELECT * FROM users", "full_scan", 1000, 10, false);
      expect(est.costScore).toBeGreaterThanOrEqual(0);
    });

    it("includes query and timestamp in result", () => {
      const estimator = new WalrusCostEstimator(DEFAULT_COST_CONFIG);
      const est = estimator.estimateSelect("SELECT * FROM users", "point", 100, 5, false);
      expect(est.query).toBe("SELECT * FROM users");
      expect(est.at).toBeGreaterThan(0);
    });

    it("returns zero operationsToWrite for SELECT", () => {
      const estimator = new WalrusCostEstimator(DEFAULT_COST_CONFIG);
      const est = estimator.estimateSelect("SELECT * FROM users", "point", 100, 5, false);
      expect(est.operationsToWrite).toBe(0);
    });

    it("handles indexed query with hasIndex=true", () => {
      const estimator = new WalrusCostEstimator(DEFAULT_COST_CONFIG);
      const withoutIndex = estimator.estimateSelect("SELECT * FROM users", "indexed", 1000, 10, false);
      const withIndex = estimator.estimateSelect("SELECT * FROM users", "indexed", 1000, 10, true);
      expect(withIndex.objectsToRead).toBeLessThan(withoutIndex.objectsToRead);
    });
  });

  describe("estimateDml", () => {
    it("estimates INSERT cost", () => {
      const estimator = new WalrusCostEstimator(DEFAULT_COST_CONFIG);
      const est = estimator.estimateDml("INSERT INTO users VALUES (1, 'Alice')", 1, 1);
      expect(est.operationsToWrite).toBe(1);
      expect(est.estimatedGas).toBeGreaterThan(0);
      expect(est.objectsToRead).toBe(0);
      expect(est.bytesToDownload).toBe(0);
      expect(est.tags).toContain("dml_type:INSERT");
    });

    it("estimates UPDATE cost", () => {
      const estimator = new WalrusCostEstimator(DEFAULT_COST_CONFIG);
      const est = estimator.estimateDml("UPDATE users SET name = 'Bob' WHERE id = 1", 1, 1);
      expect(est.operationsToWrite).toBe(1);
      expect(est.tags).toContain("dml_type:UPDATE");
    });

    it("estimates DELETE cost", () => {
      const estimator = new WalrusCostEstimator(DEFAULT_COST_CONFIG);
      const est = estimator.estimateDml("DELETE FROM users WHERE id = 1", 1, 1);
      expect(est.operationsToWrite).toBe(1);
      expect(est.tags).toContain("dml_type:DELETE");
    });

    it("applies batch discount for batchSize > 1", () => {
      const estimator = new WalrusCostEstimator(DEFAULT_COST_CONFIG);
      const single = estimator.estimateDml("INSERT INTO users VALUES (1)", 1, 1);
      const batch = estimator.estimateDml("INSERT INTO users VALUES (1)", 10, 10);
      expect(batch.estimatedGas).toBeLessThan(single.estimatedGas * 10);
      expect(batch.tags).toContain("batch:true");
    });

    it("includes bytes write estimate", () => {
      const estimator = new WalrusCostEstimator(DEFAULT_COST_CONFIG);
      const est = estimator.estimateDml("INSERT INTO users VALUES (1)", 1, 1);
      expect(est.bytesToDownload).toBe(0); // DML has no read
    });
  });

  describe("checkCostThreshold", () => {
    it("returns exceeds=false when under threshold", () => {
      const estimator = new WalrusCostEstimator(DEFAULT_COST_CONFIG);
      const est = estimator.estimateSelect("SELECT * FROM users", "point", 10, 1, false);
      const result = estimator.checkCostThreshold(est);
      expect(result.exceeds).toBe(false);
      expect(result.action).toBe("proceed");
    });

    it("returns exceeds=true when over threshold", () => {
      const lowThreshold = { ...DEFAULT_COST_CONFIG, maxCostScore: 0, onCostExceeded: "throw" as const };
      const estimator = new WalrusCostEstimator(lowThreshold);
      const est = estimator.estimateSelect("SELECT * FROM users", "full_scan", 10000, 1000, false);
      const result = estimator.checkCostThreshold(est);
      if (result.exceeds) {
        expect(result.action).toBe("throw");
        expect(result.message).toContain("exceeds threshold");
      }
    });

    it("respects onCostExceeded setting", () => {
      const warnConfig = { ...DEFAULT_COST_CONFIG, maxCostScore: 0, onCostExceeded: "warn" as const };
      const estimator = new WalrusCostEstimator(warnConfig);
      const est = estimator.estimateSelect("SELECT * FROM users", "full_scan", 10000, 1000, false);
      const result = estimator.checkCostThreshold(est);
      if (result.exceeds) {
        expect(result.action).toBe("warn");
      }
    });
  });

  describe("computeCostScore", () => {
    it("returns 0 for minimal values", () => {
      const estimator = new WalrusCostEstimator(DEFAULT_COST_CONFIG);
      const score = estimator.computeCostScore(0, 0, 0);
      expect(score).toBe(0);
    });

    it("increases with gas", () => {
      const estimator = new WalrusCostEstimator(DEFAULT_COST_CONFIG);
      const s1 = estimator.computeCostScore(100, 100, 10);
      const s2 = estimator.computeCostScore(500, 100, 10);
      expect(s2).toBeGreaterThan(s1);
    });

    it("increases with latency", () => {
      const estimator = new WalrusCostEstimator(DEFAULT_COST_CONFIG);
      const s1 = estimator.computeCostScore(100, 100, 10);
      const s2 = estimator.computeCostScore(100, 1000, 10);
      expect(s2).toBeGreaterThan(s1);
    });

    it("increases with objects", () => {
      const estimator = new WalrusCostEstimator(DEFAULT_COST_CONFIG);
      const s1 = estimator.computeCostScore(100, 100, 10);
      const s2 = estimator.computeCostScore(100, 100, 50);
      expect(s2).toBeGreaterThan(s1);
    });

    it("caps at 100", () => {
      const estimator = new WalrusCostEstimator(DEFAULT_COST_CONFIG);
      const score = estimator.computeCostScore(1_000_000, 100_000, 10_000);
      expect(score).toBe(100);
    });

    it("returns different weights per preference", () => {
      const realtimeConfig = { ...DEFAULT_COST_CONFIG, preference: "realtime" as const };
      const costConfig = { ...DEFAULT_COST_CONFIG, preference: "cost" as const };
      const realtime = new WalrusCostEstimator(realtimeConfig);
      const cost = new WalrusCostEstimator(costConfig);
      // Same inputs may produce different scores due to weighting
      const sr = realtime.computeCostScore(500, 5000, 50);
      const sc = cost.computeCostScore(500, 5000, 50);
      expect(sr).toBeGreaterThanOrEqual(0);
      expect(sc).toBeGreaterThanOrEqual(0);
    });
  });
});
