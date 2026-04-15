import { describe, it, expect } from "vitest";
import {
  hashHex,
  buildTablePageManifest,
  assignRowsToPages,
  estimateObjectReadsForQuery,
  DEFAULT_PAGE_SIZE,
  type SqlRow,
} from "../../src/walrus-storage.js";

describe("walrus-storage", () => {
  describe("hashHex", () => {
    it("returns consistent SHA-256 hex digest", () => {
      const input = "test content";
      const hash1 = hashHex(input);
      const hash2 = hashHex(input);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("returns different hashes for different inputs", () => {
      const hash1 = hashHex("input-a");
      const hash2 = hashHex("input-b");
      expect(hash1).not.toBe(hash2);
    });

    it("handles empty string", () => {
      const hash = hashHex("");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("handles unicode content", () => {
      const hash = hashHex("中文内容 🎉");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("handles large content", () => {
      const large = "x".repeat(100_000);
      const hash = hashHex(large);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("buildTablePageManifest", () => {
    const makeRow = (id: number, name: string): SqlRow =>
      new Map(Object.entries({ id: String(id), name, ts: String(Date.now()) }));

    it("creates manifest with correct page count for empty table", () => {
      const manifest = buildTablePageManifest("users", "users_id", [], 500);
      expect(manifest.pageCount).toBe(1); // At least 1 page even for empty
      expect(manifest.pages).toHaveLength(1);
      expect(manifest.pages[0]!.rowCount).toBe(0);
    });

    it("creates one page when rows fit within pageSize", () => {
      const rows = [makeRow(1, "Alice"), makeRow(2, "Bob")];
      const manifest = buildTablePageManifest("users", "users_id", rows, 500);
      expect(manifest.pageCount).toBe(1);
      expect(manifest.pages).toHaveLength(1);
      expect(manifest.pages[0]!.rowCount).toBe(2);
    });

    it("splits rows across multiple pages when exceeding pageSize", () => {
      const rows = Array.from({ length: 1200 }, (_, i) => makeRow(i, `User${i}`));
      const manifest = buildTablePageManifest("users", "users_id", rows, 500);
      expect(manifest.pageCount).toBe(3); // ceil(1200/500) = 3
      expect(manifest.pages).toHaveLength(3);
      expect(manifest.pages[0]!.rowCount).toBe(500);
      expect(manifest.pages[1]!.rowCount).toBe(500);
      expect(manifest.pages[2]!.rowCount).toBe(200);
    });

    it("sets correct startRowIndex for each page", () => {
      const rows = Array.from({ length: 1500 }, (_, i) => makeRow(i, `User${i}`));
      const manifest = buildTablePageManifest("users", "users_id", rows, 500);
      expect(manifest.pages[0]!.startRowIndex).toBe(0);
      expect(manifest.pages[1]!.startRowIndex).toBe(500);
      expect(manifest.pages[2]!.startRowIndex).toBe(1000);
    });

    it("chains pages via prevPageHash", () => {
      const rows = Array.from({ length: 1200 }, (_, i) => makeRow(i, `User${i}`));
      const manifest = buildTablePageManifest("users", "users_id", rows, 500);
      expect(manifest.pages[0]!.prevPageHash).toBeNull();
      expect(manifest.pages[1]!.prevPageHash).toBe(manifest.pages[0]!.objectId);
      expect(manifest.pages[2]!.prevPageHash).toBe(manifest.pages[1]!.objectId);
    });

    it("computes unique objectId per page", () => {
      const rows = [makeRow(1, "A"), makeRow(2, "B")];
      const manifest = buildTablePageManifest("users", "users_id", rows, 500);
      const pageIds = manifest.pages.map((p) => p.objectId);
      const uniqueIds = new Set(pageIds);
      expect(uniqueIds.size).toBe(pageIds.length);
    });

    it("computes keyMerkleRoot for non-empty pages", () => {
      const rows = [makeRow(1, "Alice"), makeRow(2, "Bob")];
      const manifest = buildTablePageManifest("users", "users_id", rows, 500);
      expect(manifest.pages[0]!.keyMerkleRoot).not.toBeNull();
      expect(manifest.pages[0]!.keyMerkleRoot).toMatch(/^[a-f0-9]{64}$/);
    });

    it("returns null keyMerkleRoot for empty pages", () => {
      const manifest = buildTablePageManifest("users", "users_id", [], 500);
      expect(manifest.pages[0]!.keyMerkleRoot).toBeNull();
    });

    it("sets correct rowCount and pageCount in manifest", () => {
      const rows = Array.from({ length: 1200 }, (_, i) => makeRow(i, `User${i}`));
      const manifest = buildTablePageManifest("users", "users_id", rows, 500);
      expect(manifest.rowCount).toBe(1200);
      expect(manifest.pageCount).toBe(3);
    });

    it("uses DEFAULT_PAGE_SIZE when not specified", () => {
      const rows = Array.from({ length: DEFAULT_PAGE_SIZE + 100 }, (_, i) =>
        makeRow(i, `User${i}`),
      );
      const manifest = buildTablePageManifest("users", "users_id", rows);
      expect(manifest.pageCount).toBe(2);
    });

    it("sets at timestamp on manifest", () => {
      const before = Date.now();
      const manifest = buildTablePageManifest("users", "users_id", []);
      const after = Date.now();
      expect(manifest.at).toBeGreaterThanOrEqual(before);
      expect(manifest.at).toBeLessThanOrEqual(after);
    });
  });

  describe("assignRowsToPages", () => {
    const makeRow = (id: number): SqlRow =>
      new Map(Object.entries({ id: String(id), name: `User${id}` }));

    it("creates new page list when adding rows to empty existing pages", () => {
      const existingPages: import("../../src/walrus-storage.js").PageRef[] = [];
      const existingRows: SqlRow[][] = [];
      const newRows = [makeRow(1), makeRow(2)];
      const result = assignRowsToPages(existingPages, existingRows, newRows, 500);
      expect(result.pages).toHaveLength(1);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toHaveLength(2);
    });

    it("merges new rows with existing rows", () => {
      const existingPage: import("../../src/walrus-storage.js").PageRef = {
        table: "users",
        pageIndex: 0,
        objectId: "abc",
        rowCount: 2,
        startRowIndex: 0,
        prevPageHash: null,
        keyMerkleRoot: "def",
      };
      const existingRows = [[makeRow(1), makeRow(2)]];
      const newRows = [makeRow(3), makeRow(4)];
      const result = assignRowsToPages([existingPage], existingRows, newRows, 500);
      expect(result.rows[0]).toHaveLength(4);
    });

    it("splits when merged rows exceed pageSize", () => {
      const existingPage: import("../../src/walrus-storage.js").PageRef = {
        table: "users",
        pageIndex: 0,
        objectId: "abc",
        rowCount: 400,
        startRowIndex: 0,
        prevPageHash: null,
        keyMerkleRoot: "def",
      };
      // 400 existing + 100 new = 500, exactly at limit, still 1 page
      // 400 existing + 101 new = 501, exceeds limit → 2 pages
      const existingRows = [Array.from({ length: 400 }, (_, i) => makeRow(i))];
      const newRows = Array.from({ length: 101 }, (_, i) => makeRow(400 + i));
      const result = assignRowsToPages([existingPage], existingRows, newRows, 500);
      expect(result.pages).toHaveLength(2);
      expect(result.pages[0]!.rowCount).toBe(500);
      expect(result.pages[1]!.rowCount).toBe(1);
    });

    it("preserves table name from existing pages", () => {
      const existingPage: import("../../src/walrus-storage.js").PageRef = {
        table: "orders",
        pageIndex: 0,
        objectId: "abc",
        rowCount: 0,
        startRowIndex: 0,
        prevPageHash: null,
        keyMerkleRoot: null,
      };
      const result = assignRowsToPages([existingPage], [[]], [makeRow(1)], 500);
      expect(result.pages[0]!.table).toBe("orders");
    });
  });

  describe("estimateObjectReadsForQuery", () => {
    const makeRow = (id: number, name: string): SqlRow =>
      new Map(Object.entries({ id: String(id), name, ts: String(Date.now()) }));

    it("returns 1 for point query", () => {
      const rows = Array.from({ length: 1000 }, (_, i) => makeRow(i, `User${i}`));
      const manifest = buildTablePageManifest("users", "users_id", rows, 500);
      expect(estimateObjectReadsForQuery(manifest, "point")).toBe(1);
    });

    it("returns all pages for full_scan", () => {
      const rows = Array.from({ length: 1500 }, (_, i) => makeRow(i, `User${i}`));
      const manifest = buildTablePageManifest("users", "users_id", rows, 500);
      expect(estimateObjectReadsForQuery(manifest, "full_scan")).toBe(manifest.pageCount);
    });

    it("returns ~10% of pages for indexed query", () => {
      const rows = Array.from({ length: 1000 }, (_, i) => makeRow(i, `User${i}`));
      const manifest = buildTablePageManifest("users", "users_id", rows, 500);
      const reads = estimateObjectReadsForQuery(manifest, "indexed");
      // ceil(pageCount * 0.1) = ceil(2 * 0.1) = 1
      expect(reads).toBe(1);
    });

    it("returns ~30% of pages for range query", () => {
      const rows = Array.from({ length: 1000 }, (_, i) => makeRow(i, `User${i}`));
      const manifest = buildTablePageManifest("users", "users_id", rows, 500);
      const reads = estimateObjectReadsForQuery(manifest, "range");
      // ceil(rowCount/pageCount * 0.3) = ceil(1000/2 * 0.3) = ceil(500 * 0.3) = 150
      expect(reads).toBe(150);
    });
  });
});
