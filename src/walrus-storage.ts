/**
 * Walrus Decentralized Storage: Paged Storage Engine
 *
 * Key design principles:
 * - Data is split into pages (objects) to avoid oversized single objects
 * - Content-addressable: each page is identified by hash(content)
 * - Version chain: pages reference previous page hashes (like Git)
 * - Batch-friendly: multiple ops can be grouped into one on-chain transaction
 */

import { createHash } from "node:crypto";
import type { SqlRow } from "./types.js";

/** SHA-256 hex hash of content */
export type ContentHash = string;

/** Default rows per page; pages larger than this trigger a split */
export const DEFAULT_PAGE_SIZE = 500;

export interface PageRef {
  table: string;
  pageIndex: number;
  objectId: ContentHash;
  rowCount: number;
  startRowIndex: number;
  /** Previous page's objectId (null for first page) */
  prevPageHash: ContentHash | null;
  /** Hash of all row keys for integrity */
  keyMerkleRoot: ContentHash | null;
}

export interface TablePageManifest {
  table: string;
  tableId: string;
  version: ContentHash;
  /** All pages in this snapshot, ordered by pageIndex */
  pages: PageRef[];
  rowCount: number;
  pageCount: number;
  /** Timestamp of snapshot creation */
  at: number;
}

export interface PageWriteOperation {
  table: string;
  pageIndex: number;
  rows: SqlRow[];
  op: "PAGE_INSERT" | "PAGE_DELETE" | "PAGE_UPDATE";
  objectId: ContentHash;
  prevPageHash: ContentHash | null;
}

export interface VersionedCommit {
  version: ContentHash;
  operations: PageWriteOperation[];
  manifest: TablePageManifest;
  batchId: string;
  at: number;
}

/** Build a paged snapshot of a table's current rows */
export function buildTablePageManifest(
  table: string,
  tableId: string,
  rows: SqlRow[],
  pageSize: number = DEFAULT_PAGE_SIZE,
): TablePageManifest {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pages: PageRef[] = [];

  for (let i = 0; i < totalPages; i++) {
    const pageRows = rows.slice(i * pageSize, (i + 1) * pageSize);
    const prevPageHash = i > 0 ? pages[i - 1]!.objectId : null;
    const objectId = hashHex(JSON.stringify({ table, pageIndex: i, rows: pageRows }));
    const keyMerkleRoot = buildKeyMerkleRoot(pageRows);

    pages.push({
      table,
      pageIndex: i,
      objectId,
      rowCount: pageRows.length,
      startRowIndex: i * pageSize,
      prevPageHash,
      keyMerkleRoot,
    });
  }

  const version = hashHex(
    JSON.stringify({
      table,
      pageCount: pages.length,
      rowCount: rows.length,
      lastPageHash: pages[pages.length - 1]?.objectId ?? "GENESIS",
    }),
  );

  return {
    table,
    tableId,
    version,
    pages,
    rowCount: rows.length,
    pageCount: pages.length,
    at: Date.now(),
  };
}

/** Merkle root of row primary keys for integrity verification */
function buildKeyMerkleRoot(rows: SqlRow[]): ContentHash | null {
  if (rows.length === 0) return null;
  const keys = rows.map((r) => hashHex(JSON.stringify(r)));
  return merkleRoot(keys);
}

/** Simple pairwise merkle root (2-element chunks) */
function merkleRoot(hashes: string[]): ContentHash {
  if (hashes.length === 0) return hashHex("EMPTY");
  if (hashes.length === 1) return hashes[0]!;

  const level: string[] = [];
  for (let i = 0; i < hashes.length; i += 2) {
    const left = hashes[i]!;
    const right = hashes[i + 1] ?? left;
    level.push(hashHex(`L:${left}|R:${right}`));
  }
  return merkleRoot(level);
}

/** Compute SHA-256 hex digest */
export function hashHex(input: string): ContentHash {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Page assignment strategy: split large pages and rebalance
 *
 * Returns new page list after assigning `newRows` to the appropriate pages.
 * Pages are kept <= pageSize; overflow creates a new page.
 */
export function assignRowsToPages(
  existingPages: PageRef[],
  existingRows: SqlRow[][],
  newRows: SqlRow[],
  pageSize: number = DEFAULT_PAGE_SIZE,
): { pages: PageRef[]; rows: SqlRow[][] } {
  // Merge all rows and re-chunk
  const allRows = [...existingRows.flat(), ...newRows];
  const newPageRows: SqlRow[][] = [];

  for (let i = 0; i < allRows.length; i += pageSize) {
    newPageRows.push(allRows.slice(i, i + pageSize));
  }

  const newPages: PageRef[] = newPageRows.map((pageRows, pageIndex) => {
    const prevPageHash = pageIndex > 0 ? newPages[pageIndex - 1]!.objectId : null;
    const objectId = hashHex(JSON.stringify({ pageIndex, rows: pageRows }));
    return {
      table: existingPages[0]?.table ?? "",
      pageIndex,
      objectId,
      rowCount: pageRows.length,
      startRowIndex: pageIndex * pageSize,
      prevPageHash,
      keyMerkleRoot: buildKeyMerkleRoot(pageRows),
    };
  });

  return { pages: newPages, rows: newPageRows };
}

/** Calculate how many objects need to be read for a given query type */
export function estimateObjectReadsForQuery(
  manifest: TablePageManifest,
  queryType: "point" | "range" | "full_scan" | "indexed",
): number {
  switch (queryType) {
    case "point":
      return 1; // Single row → 1 page
    case "range":
      return Math.ceil(manifest.rowCount / manifest.pageCount * 0.3); // ~30% of pages
    case "indexed":
      return Math.ceil(manifest.pageCount * 0.1); // ~10% via index
    case "full_scan":
    default:
      return manifest.pageCount; // All pages
  }
}
