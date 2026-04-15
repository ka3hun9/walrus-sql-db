import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SqlRow } from "../../src/types.js";

describe("walrus-batch", () => {
  // We need to import after vitest is configured
  let WalrusBatchCommitter: typeof import("../../src/walrus-batch.js").WalrusBatchCommitter;
  let buildBatchMoveCallPayload: typeof import("../../src/walrus-batch.js").buildBatchMoveCallPayload;

  beforeEach(async () => {
    const mod = await import("../../src/walrus-batch.js");
    WalrusBatchCommitter = mod.WalrusBatchCommitter;
    buildBatchMoveCallPayload = mod.buildBatchMoveCallPayload;
  });

  const makeRow = (id: number): SqlRow =>
    new Map(Object.entries({ id: String(id), name: `User${id}` }));

  describe("WalrusBatchCommitter", () => {
    it("enqueue increments pending count", async () => {
      const committer = new WalrusBatchCommitter(
        { maxDelayMs: 1000, maxOperations: 10, maxBatchRows: 1000, enabled: true },
        async () => ({ txDigest: "tx1" }),
      );
      committer.enqueue({ type: "INSERT", table: "users", row: makeRow(1) });
      expect(committer.pendingCount).toBe(1);
    });

    it("flush returns null when no pending ops", async () => {
      const committer = new WalrusBatchCommitter(
        { maxDelayMs: 1000, maxOperations: 10, maxBatchRows: 1000, enabled: true },
        async () => ({ txDigest: "tx1" }),
      );
      const result = await committer.flush();
      expect(result).toBeNull();
    });

    it("flush calls callback with all pending ops", async () => {
      const callback = vi.fn().mockResolvedValue({ txDigest: "tx123" });
      const committer = new WalrusBatchCommitter(
        { maxDelayMs: 1000, maxOperations: 10, maxBatchRows: 1000, enabled: true },
        callback,
      );
      committer.enqueue({ type: "INSERT", table: "users", row: makeRow(1) });
      committer.enqueue({ type: "INSERT", table: "users", row: makeRow(2) });

      const result = await committer.flush();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(result!.batchId).toBeDefined();
      expect(result!.operationCount).toBe(2);
      expect(result!.txDigest).toBe("tx123");
    });

    it("clear removes all pending ops", async () => {
      const committer = new WalrusBatchCommitter(
        { maxDelayMs: 1000, maxOperations: 10, maxBatchRows: 1000, enabled: true },
        async () => ({ txDigest: "tx1" }),
      );
      committer.enqueue({ type: "INSERT", table: "users", row: makeRow(1) });
      committer.enqueue({ type: "INSERT", table: "users", row: makeRow(2) });
      committer.clear();
      expect(committer.pendingCount).toBe(0);
    });

    it("does not enqueue when disabled", () => {
      const committer = new WalrusBatchCommitter(
        { maxDelayMs: 1000, maxOperations: 10, maxBatchRows: 1000, enabled: false },
        async () => ({ txDigest: "tx1" }),
      );
      committer.enqueue({ type: "INSERT", table: "users", row: makeRow(1) });
      expect(committer.pendingCount).toBe(0);
    });

    it("re-adds failed ops back to pending on flush error", async () => {
      const callback = vi
        .fn()
        .mockRejectedValueOnce(new Error("chain error"))
        .mockResolvedValue({ txDigest: "tx2" });
      const committer = new WalrusBatchCommitter(
        { maxDelayMs: 1000, maxOperations: 10, maxBatchRows: 1000, enabled: true },
        callback,
      );
      committer.enqueue({ type: "INSERT", table: "users", row: makeRow(1) });

      await expect(committer.flush()).rejects.toThrow("chain error");
      expect(committer.pendingCount).toBe(1); // Re-added
    });

    it("elapsedSinceLastFlush is Infinity before first flush", () => {
      const committer = new WalrusBatchCommitter(
        { maxDelayMs: 1000, maxOperations: 10, maxBatchRows: 1000, enabled: true },
        async () => ({ txDigest: "tx1" }),
      );
      expect(committer.elapsedSinceLastFlush).toBe(Infinity);
    });

    it("auto-flushes when maxOperations is reached", async () => {
      vi.useFakeTimers();
      const callback = vi.fn().mockResolvedValue({ txDigest: "tx1" });
      const committer = new WalrusBatchCommitter(
        { maxDelayMs: 60000, maxOperations: 3, maxBatchRows: 1000, enabled: true },
        callback,
      );
      committer.enqueue({ type: "INSERT", table: "users", row: makeRow(1) });
      committer.enqueue({ type: "INSERT", table: "users", row: makeRow(2) });
      expect(callback).not.toHaveBeenCalled();
      committer.enqueue({ type: "INSERT", table: "users", row: makeRow(3) });
      expect(callback).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("handles UPDATE operation type", async () => {
      const callback = vi.fn().mockResolvedValue({ txDigest: "tx1" });
      const committer = new WalrusBatchCommitter(
        { maxDelayMs: 1000, maxOperations: 10, maxBatchRows: 1000, enabled: true },
        callback,
      );
      committer.enqueue({
        type: "UPDATE",
        table: "users",
        row: makeRow(1),
        pkField: "id",
        pkValue: "1",
      });
      await committer.flush();
      expect(callback).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ type: "UPDATE", pkField: "id", pkValue: "1" }),
        ]),
        expect.any(String),
      );
    });

    it("handles DELETE operation type", async () => {
      const callback = vi.fn().mockResolvedValue({ txDigest: "tx1" });
      const committer = new WalrusBatchCommitter(
        { maxDelayMs: 1000, maxOperations: 10, maxBatchRows: 1000, enabled: true },
        callback,
      );
      committer.enqueue({ type: "DELETE", table: "users", pkField: "id", pkValue: "42" });
      await committer.flush();
      expect(callback).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ type: "DELETE", pkField: "id", pkValue: "42" }),
        ]),
        expect.any(String),
      );
    });
  });

  describe("buildBatchMoveCallPayload", () => {
    it("creates payload with correct target format", async () => {
      const { buildBatchMoveCallPayload: fn } = await import(
        "../../src/walrus-batch.js"
      );
      const ops: import("../../src/walrus-batch.js").BatchableDmlOp[] = [
        { type: "INSERT", table: "users", row: makeRow(1) },
      ];
      const payload = fn(ops, "0xABC123", "sql_engine");
      expect(payload.target).toBe("0xABC123::sql_engine::batch_commit");
    });

    it("includes batchId in payload", async () => {
      const { buildBatchMoveCallPayload: fn } = await import(
        "../../src/walrus-batch.js"
      );
      const ops: import("../../src/walrus-batch.js").BatchableDmlOp[] = [
        { type: "INSERT", table: "users", row: makeRow(1) },
      ];
      const payload = fn(ops, "0xABC123", "sql_engine");
      expect(payload.batchId).toBeDefined();
      expect(payload.batchId.length).toBeGreaterThan(0);
    });

    it("serializes INSERT row data", async () => {
      const { buildBatchMoveCallPayload: fn } = await import(
        "../../src/walrus-batch.js"
      );
      const row = makeRow(99);
      const ops: import("../../src/walrus-batch.js").BatchableDmlOp[] = [
        { type: "INSERT", table: "users", row },
      ];
      const payload = fn(ops, "0xABC123", "sql_engine");
      expect(payload.arguments.length).toBe(2); // contentHash + serialized payload
      expect(payload.arguments[1]).toContain("INSERT");
    });

    it("handles multiple ops of different types", async () => {
      const { buildBatchMoveCallPayload: fn } = await import(
        "../../src/walrus-batch.js"
      );
      const ops: import("../../src/walrus-batch.js").BatchableDmlOp[] = [
        { type: "INSERT", table: "users", row: makeRow(1) },
        { type: "UPDATE", table: "users", row: makeRow(2), pkField: "id", pkValue: "2" },
        { type: "DELETE", table: "users", pkField: "id", pkValue: "3" },
      ];
      const payload = fn(ops, "0xABC123", "sql_engine");
      expect(payload.arguments.length).toBe(2);
    });
  });
});
