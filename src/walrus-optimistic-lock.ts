/**
 * Walrus Optimistic Lock Manager
 *
 * Detects concurrent modifications to the same object using version numbers.
 * On conflict, provides configurable resolution strategies:
 * - LAST_WRITE_WINS:  silently overwrite (default)
 * - FIRST_COMMIT_WINS: first writer commits, later writers fail
 * - CLIENT_MERGE:      SDK attempts three-way merge
 *
 * This is critical for multi-client scenarios where two clients may try
 * to modify the same row or page simultaneously.
 */

import { hashHex } from "./walrus-storage.js";

export type ConflictResolutionStrategy = "LAST_WRITE_WINS" | "FIRST_COMMIT_WINS" | "CLIENT_MERGE";

export interface OptimisticLockOptions {
  enabled: boolean;
  strategy: ConflictResolutionStrategy;
  maxRetries: number;
  lockTimeoutMs: number;
}

/** A single object version record */
export interface ObjectVersion {
  objectId: string;
  table: string;
  version: string;   // content hash of the object's state
  rowVersion: number; // monotonic counter
  committedAt: number;
  committedBy: string; // client/signer address
}

/** Conflict detected during commit */
export class OptimisticConflictError extends Error {
  constructor(
    public readonly table: string,
    public readonly objectId: string,
    public readonly expectedVersion: string,
    public readonly actualVersion: string,
    public readonly strategy: ConflictResolutionStrategy,
    message: string,
  ) {
    super(message);
    this.name = "OptimisticConflictError";
  }
}

export class OptimisticLockManager {
  /**
   * In-memory version registry.
   * Map<table, Map<objectId, ObjectVersion>>
   */
  private versionRegistry = new Map<string, Map<string, ObjectVersion>>();

  /**
   * Pending local modifications (not yet committed).
   * Used to detect conflicts BEFORE submitting to chain.
   */
  private pendingModifications = new Map<string, Map<string, string>>(); // table→objectId→pendingVersion

  constructor(private readonly options: OptimisticLockOptions) {}

  /** Record that we're about to modify an object (optimistic read) */
  recordRead(table: string, objectId: string, version: string): void {
    const tableMap = this.versionRegistry.get(table) ?? new Map();
    const existing = tableMap.get(objectId);
    if (!existing) {
      tableMap.set(objectId, {
        objectId,
        table,
        version,
        rowVersion: 1,
        committedAt: Date.now(),
        committedBy: "unknown",
      });
      this.versionRegistry.set(table, tableMap);
    }
  }

  /** Record a pending local modification (before commit) */
  recordPending(table: string, objectId: string, newVersion: string): void {
    const tableMap = this.pendingModifications.get(table) ?? new Map();
    tableMap.set(objectId, newVersion);
    this.pendingModifications.set(table, tableMap);
  }

  /** Confirm a commit succeeded — promote pending version to committed */
  confirmCommit(table: string, objectId: string, newVersion: string, signer: string): void {
    const tableMap = this.versionRegistry.get(table) ?? new Map();
    const existing = tableMap.get(objectId);
    const newRowVersion = (existing?.rowVersion ?? 0) + 1;

    tableMap.set(objectId, {
      objectId,
      table,
      version: newVersion,
      rowVersion: newRowVersion,
      committedAt: Date.now(),
      committedBy: signer,
    });
    this.versionRegistry.set(table, tableMap);

    // Clear pending
    const pendingMap = this.pendingModifications.get(table);
    if (pendingMap) {
      pendingMap.delete(objectId);
    }
  }

  /**
   * Check if a local pending modification conflicts with the current
   * committed version on chain.
   *
   * Called before submitting a commit to detect conflicts early.
   *
   * @param table Table name
   * @param objectId Object/page ID
   * @param onchainVersion Latest version from the chain
   * @returns null if no conflict, or throws OptimisticConflictError
   */
  detectConflict(
    table: string,
    objectId: string,
    onchainVersion: string,
  ): OptimisticConflictError | null {
    const tableMap = this.versionRegistry.get(table);
    const localVersion = tableMap?.get(objectId);

    if (!localVersion) {
      // No local record — check pending
      const pendingMap = this.pendingModifications.get(table);
      const pendingVersion = pendingMap?.get(objectId);
      if (pendingVersion && pendingVersion !== onchainVersion) {
        return this.buildConflict(table, objectId, pendingVersion, onchainVersion);
      }
      return null; // No conflict
    }

    if (localVersion.version !== onchainVersion) {
      return this.buildConflict(table, objectId, localVersion.version, onchainVersion);
    }

    return null;
  }

  /** Get the local version for an object (for retry/conflict display) */
  getLocalVersion(table: string, objectId: string): ObjectVersion | undefined {
    return this.versionRegistry.get(table)?.get(objectId);
  }

  /** Clear all pending modifications (rollback) */
  rollbackPending(table?: string): void {
    if (table) {
      this.pendingModifications.delete(table);
    } else {
      this.pendingModifications.clear();
    }
  }

  /** Compact registry to reduce memory (keep only recent N versions per table) */
  pruneRegistry(maxVersionsPerTable = 1000): void {
    for (const [table, objectMap] of this.versionRegistry.entries()) {
      if (objectMap.size > maxVersionsPerTable) {
        const sorted = [...objectMap.values()].sort((a, b) => b.committedAt - a.committedAt);
        const pruned = new Map(sorted.slice(0, maxVersionsPerTable).map((v) => [v.objectId, v]));
        this.versionRegistry.set(table, pruned);
      }
    }
  }

  private buildConflict(
    table: string,
    objectId: string,
    expected: string,
    actual: string,
  ): OptimisticConflictError {
    return new OptimisticConflictError(
      table,
      objectId,
      expected,
      actual,
      this.options.strategy,
      `Optimistic lock conflict on ${table}.${objectId}: expected ${expected}, found ${actual} (strategy=${this.options.strategy})`,
    );
  }
}

/**
 * Three-way merge for row-level conflicts.
 * Returns merged row if auto-merge is possible, or null if manual resolution needed.
 *
 * precondition: all three versions descended from the same common ancestor
 */
export function threeWayMerge(
  base: Record<string, unknown>,
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
): Record<string, unknown> | null {
  const merged: Record<string, unknown> = { ...base };
  let hasConflict = false;

  const allKeys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);

  for (const key of allKeys) {
    const baseVal = base[key];
    const localVal = local[key];
    const remoteVal = remote[key];

    if (localVal === remoteVal) {
      merged[key] = localVal; // Both changed the same way
    } else if (localVal === baseVal) {
      merged[key] = remoteVal; // Only remote changed
    } else if (remoteVal === baseVal) {
      merged[key] = localVal; // Only local changed
    } else {
      // Both changed differently — conflict
      hasConflict = true;
    }
  }

  return hasConflict ? null : merged;
}

/** Build a version hash from a row's content */
export function buildRowVersionHash(row: Record<string, unknown>): string {
  return hashHex(JSON.stringify(row));
}
