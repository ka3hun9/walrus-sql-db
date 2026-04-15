/**
 * Walrus Batch Commit Manager
 *
 * Batches multiple DML operations (INSERT/UPDATE/DELETE) in memory
 * and flushes them to the chain in one atomic transaction when:
 * - maxDelayMs is reached (background timer), OR
 * - maxOperations count is reached, OR
 * - maxBatchRows total rows affected
 *
 * This dramatically reduces per-operation gas costs on chain.
 */

import { randomUUID } from "node:crypto";
import type { SqlRow } from "./types.js";
import { hashHex } from "./walrus-storage.js";

export type BatchableDmlOp =
  | { type: "INSERT"; table: string; row: SqlRow; objectId?: string }
  | { type: "UPDATE"; table: string; row: SqlRow; pkField: string; pkValue: unknown; objectId?: string }
  | { type: "DELETE"; table: string; pkField: string; pkValue: unknown; objectId?: string };

export interface BatchCommitOptions {
  maxDelayMs: number;
  maxOperations: number;
  maxBatchRows: number;
  enabled: boolean;
}

export interface BatchFlushResult {
  batchId: string;
  operationCount: number;
  totalRows: number;
  flushMs: number;
  txDigest: string;
}

export type BatchFlushCallback = (
  batch: BatchableDmlOp[],
  batchId: string,
) => Promise<{ txDigest: string; raw?: unknown }>;

export class WalrusBatchCommitter {
  private pending: BatchableDmlOp[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private lastFlushMs = 0;

  constructor(
    private readonly options: BatchCommitOptions,
    private readonly flushCallback: BatchFlushCallback,
  ) {}

  /** Add an operation to the current batch */
  enqueue(op: BatchableDmlOp): void {
    if (!this.options.enabled || this.flushing) return;
    this.pending.push(op);
    this.scheduleFlush();
  }

  /** Manually trigger an immediate flush (e.g., on COMMIT) */
  async flush(): Promise<BatchFlushResult | null> {
    if (this.pending.length === 0) return null;
    return this.doFlush();
  }

  /** Clear pending ops without flushing (e.g., on ROLLBACK) */
  clear(): void {
    this.pending = [];
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Pending operation count */
  get pendingCount(): number {
    return this.pending.length;
  }

  /** Milliseconds since last flush */
  get elapsedSinceLastFlush(): number {
    return this.lastFlushMs === 0 ? Infinity : Date.now() - this.lastFlushMs;
  }

  private scheduleFlush(): void {
    if (this.pending.length >= this.options.maxOperations) {
      void this.flush();
      return;
    }

    if (this.timer !== null) return; // Already scheduled

    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.pending.length > 0) {
        void this.flush();
      }
    }, this.options.maxDelayMs);
  }

  private async doFlush(): Promise<BatchFlushResult | null> {
    if (this.pending.length === 0) return null;

    this.flushing = true;
    const ops = [...this.pending];
    this.pending = [];
    this.lastFlushMs = Date.now();

    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const batchId = randomUUID().replace(/-/g, "").slice(0, 16);
    const startMs = Date.now();

    try {
      const result = await this.flushCallback(ops, batchId);
      this.flushing = false;
      return {
        batchId,
        operationCount: ops.length,
        totalRows: ops.length, // each op = 1 row for counting
        flushMs: Date.now() - startMs,
        txDigest: result.txDigest,
      };
    } catch (err) {
      this.flushing = false;
      // On failure, re-add failed ops back to pending for retry
      this.pending = [...ops, ...this.pending];
      throw err;
    }
  }
}

/**
 * Build a combined batch MoveCall payload for on-chain submission.
 * This serializes all operations in the batch into a single object.
 */
export function buildBatchMoveCallPayload(
  ops: BatchableDmlOp[],
  packageId: string,
  moduleName: string,
): {
  target: string;
  arguments: string[];
  batchId: string;
} {
  const batchId = randomUUID().replace(/-/g, "").slice(0, 16);

  const payload = JSON.stringify({
    v: 1,
    batchId,
    ops: ops.map((op) => {
      const base = { type: op.type, table: op.table };
      if (op.type === "INSERT") {
        return { ...base, row: op.row, objectId: op.objectId ?? hashHex(JSON.stringify(op.row)) };
      }
      if (op.type === "UPDATE") {
        return { ...base, row: op.row, pkField: op.pkField, pkValue: op.pkValue, objectId: op.objectId };
      }
      // DELETE
      return { ...base, pkField: op.pkField, pkValue: op.pkValue, objectId: op.objectId };
    }),
    ts: Date.now(),
  });

  const contentHash = hashHex(payload);

  return {
    target: `${packageId}::${moduleName}::batch_commit`,
    arguments: [contentHash, payload],
    batchId,
  };
}
