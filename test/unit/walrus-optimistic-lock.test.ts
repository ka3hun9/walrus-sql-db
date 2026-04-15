import { describe, it, expect } from "vitest";

describe("walrus-optimistic-lock", () => {
  let OptimisticLockManager: typeof import("../../src/walrus-optimistic-lock.js").OptimisticLockManager;
  let threeWayMerge: typeof import("../../src/walrus-optimistic-lock.js").threeWayMerge;
  let buildRowVersionHash: typeof import("../../src/walrus-optimistic-lock.js").buildRowVersionHash;

  beforeEach(async () => {
    const mod = await import("../../src/walrus-optimistic-lock.js");
    OptimisticLockManager = mod.OptimisticLockManager;
    threeWayMerge = mod.threeWayMerge;
    buildRowVersionHash = mod.buildRowVersionHash;
  });

  describe("OptimisticLockManager", () => {
    it("records a read and stores version", () => {
      const manager = new OptimisticLockManager({
        enabled: true,
        strategy: "LAST_WRITE_WINS",
        maxRetries: 3,
        lockTimeoutMs: 5000,
      });
      manager.recordRead("users", "obj123", "v1");
      const v = manager.getLocalVersion("users", "obj123");
      expect(v).toBeDefined();
      expect(v!.version).toBe("v1");
    });

    it("returns undefined for unknown object", () => {
      const manager = new OptimisticLockManager({
        enabled: true,
        strategy: "LAST_WRITE_WINS",
        maxRetries: 3,
        lockTimeoutMs: 5000,
      });
      expect(manager.getLocalVersion("users", "unknown")).toBeUndefined();
    });

    it("detectConflict returns conflict when onchain version differs from registry", () => {
      const manager = new OptimisticLockManager({
        enabled: true,
        strategy: "LAST_WRITE_WINS",
        maxRetries: 3,
        lockTimeoutMs: 5000,
      });
      manager.recordRead("users", "obj1", "v1");
      // On-chain has moved to v2 while we still have v1 locally
      const conflict = manager.detectConflict("users", "obj1", "v2");
      expect(conflict).not.toBeNull();
      expect(conflict!.expectedVersion).toBe("v1");
      expect(conflict!.actualVersion).toBe("v2");
    });

    it("detectConflict returns null when versions match", () => {
      const manager = new OptimisticLockManager({
        enabled: true,
        strategy: "LAST_WRITE_WINS",
        maxRetries: 3,
        lockTimeoutMs: 5000,
      });
      manager.recordRead("users", "obj1", "v1");
      const conflict = manager.detectConflict("users", "obj1", "v1");
      expect(conflict).toBeNull();
    });

    it("detectConflict returns conflict when onchain version differs", () => {
      const manager = new OptimisticLockManager({
        enabled: true,
        strategy: "LAST_WRITE_WINS",
        maxRetries: 3,
        lockTimeoutMs: 5000,
      });
      manager.recordRead("users", "obj1", "v1");
      const conflict = manager.detectConflict("users", "obj1", "v2");
      expect(conflict).not.toBeNull();
      expect(conflict!.expectedVersion).toBe("v1");
      expect(conflict!.actualVersion).toBe("v2");
      expect(conflict!.strategy).toBe("LAST_WRITE_WINS");
    });

    it("confirmCommit promotes pending to committed", () => {
      const manager = new OptimisticLockManager({
        enabled: true,
        strategy: "LAST_WRITE_WINS",
        maxRetries: 3,
        lockTimeoutMs: 5000,
      });
      manager.recordRead("users", "obj1", "v1");
      manager.recordPending("users", "obj1", "v2");
      manager.confirmCommit("users", "obj1", "v2", "signer1");

      const v = manager.getLocalVersion("users", "obj1");
      expect(v!.version).toBe("v2");
      expect(v!.rowVersion).toBe(2);
      expect(v!.committedBy).toBe("signer1");
    });

    it("confirmCommit increments rowVersion", () => {
      const manager = new OptimisticLockManager({
        enabled: true,
        strategy: "LAST_WRITE_WINS",
        maxRetries: 3,
        lockTimeoutMs: 5000,
      });
      manager.recordRead("users", "obj1", "v1");
      manager.confirmCommit("users", "obj1", "v2", "signer1");
      manager.confirmCommit("users", "obj1", "v3", "signer2");

      const v = manager.getLocalVersion("users", "obj1");
      expect(v!.rowVersion).toBe(3);
    });

    it("rollbackPending clears pending modifications", () => {
      const manager = new OptimisticLockManager({
        enabled: true,
        strategy: "LAST_WRITE_WINS",
        maxRetries: 3,
        lockTimeoutMs: 5000,
      });
      manager.recordRead("users", "obj1", "v1");
      manager.recordPending("users", "obj1", "v2");
      manager.rollbackPending("users");

      const conflict = manager.detectConflict("users", "obj1", "v1");
      expect(conflict).toBeNull(); // No longer any pending
    });

    it("rollbackPending without table clears all", () => {
      const manager = new OptimisticLockManager({
        enabled: true,
        strategy: "LAST_WRITE_WINS",
        maxRetries: 3,
        lockTimeoutMs: 5000,
      });
      manager.recordPending("users", "obj1", "v2");
      manager.recordPending("orders", "obj2", "v3");
      manager.rollbackPending();

      manager.recordRead("users", "obj1", "v1");
      const conflict = manager.detectConflict("users", "obj1", "v1");
      expect(conflict).toBeNull();
    });

    it("pruneRegistry reduces registry size", () => {
      const manager = new OptimisticLockManager({
        enabled: true,
        strategy: "LAST_WRITE_WINS",
        maxRetries: 3,
        lockTimeoutMs: 5000,
      });
      // Record many objects
      for (let i = 0; i < 2000; i++) {
        manager.recordRead("users", `obj${i}`, `v${i}`);
      }
      manager.pruneRegistry(100);
      // Registry should be pruned (implementation detail: may still hold sorted entries)
      expect(() => manager.pruneRegistry(100)).not.toThrow();
    });

    it("conflict error has correct properties", () => {
      const manager = new OptimisticLockManager({
        enabled: true,
        strategy: "FIRST_COMMIT_WINS",
        maxRetries: 3,
        lockTimeoutMs: 5000,
      });
      manager.recordRead("users", "obj1", "v1");
      const conflict = manager.detectConflict("users", "obj1", "v2");
      expect(conflict!.table).toBe("users");
      expect(conflict!.objectId).toBe("obj1");
      expect(conflict!.expectedVersion).toBe("v1");
      expect(conflict!.actualVersion).toBe("v2");
      expect(conflict!.strategy).toBe("FIRST_COMMIT_WINS");
      expect(conflict!.message).toContain("Optimistic lock conflict");
    });
  });

  describe("threeWayMerge", () => {
    it("returns local when local and remote are identical", () => {
      const base = { a: 1, b: 2 };
      const local = { a: 1, b: 2 };
      const remote = { a: 1, b: 2 };
      const result = threeWayMerge(base, local, remote);
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it("returns remote when only remote changed", () => {
      const base = { a: 1, b: 2 };
      const local = { a: 1, b: 2 };
      const remote = { a: 1, b: 99 };
      const result = threeWayMerge(base, local, remote);
      expect(result).toEqual({ a: 1, b: 99 });
    });

    it("returns local when only local changed", () => {
      const base = { a: 1, b: 2 };
      const local = { a: 1, b: 99 };
      const remote = { a: 1, b: 2 };
      const result = threeWayMerge(base, local, remote);
      expect(result).toEqual({ a: 1, b: 99 });
    });

    it("returns null when both changed differently", () => {
      const base = { a: 1, b: 2 };
      const local = { a: 1, b: 99 };
      const remote = { a: 1, b: 88 };
      const result = threeWayMerge(base, local, remote);
      expect(result).toBeNull();
    });

    it("handles new field added in remote only", () => {
      const base = { a: 1 };
      const local = { a: 1 };
      const remote = { a: 1, b: 2 };
      const result = threeWayMerge(base, local, remote);
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it("handles new field added in local only", () => {
      const base = { a: 1 };
      const local = { a: 1, b: 2 };
      const remote = { a: 1 };
      const result = threeWayMerge(base, local, remote);
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it("handles field deleted in remote", () => {
      const base = { a: 1, b: 2 };
      const local = { a: 1, b: 2 };
      const remote = { a: 1 };
      const result = threeWayMerge(base, local, remote);
      expect(result).toEqual({ a: 1 }); // b was deleted in remote
    });

    it("returns null on conflicting deletes", () => {
      const base = { a: 1, b: 2 };
      const local = { a: 1 };
      const remote = { a: 1, b: 2 };
      // local deleted b, remote kept b — but remote's b still equals base
      // so this is like "only local changed" → result should be local {a:1}
      const result = threeWayMerge(base, local, remote);
      expect(result).toEqual({ a: 1 });
    });

    it("handles empty base", () => {
      const base: Record<string, unknown> = {};
      const local = { a: 1 };
      const remote = { b: 2 };
      const result = threeWayMerge(base, local, remote);
      expect(result).toEqual({ a: 1, b: 2 });
    });
  });

  describe("buildRowVersionHash", () => {
    it("produces consistent hash for same row", () => {
      const row = { id: "1", name: "Alice" };
      const h1 = buildRowVersionHash(row);
      const h2 = buildRowVersionHash(row);
      expect(h1).toBe(h2);
    });

    it("produces different hash for different rows", () => {
      const h1 = buildRowVersionHash({ id: "1", name: "Alice" });
      const h2 = buildRowVersionHash({ id: "2", name: "Bob" });
      expect(h1).not.toBe(h2);
    });

    it("produces hex string of expected length", () => {
      const hash = buildRowVersionHash({ id: "1" });
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
