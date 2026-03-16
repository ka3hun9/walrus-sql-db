import { strict as assert } from "node:assert";
import {
  computeTransactionLogChecksum,
  createTransactionLogRecord,
  verifyTransactionLogRecordChecksum,
  type TransactionLogRecord,
} from "../src/types.js";

const basePayload = {
  txnId: "txn_1001",
  at: 1_700_000_000_000,
  writeSet: [
    {
      table: "accounts",
      op: "UPDATE" as const,
      key: { id: 1, tenant: "tenant_a" },
      preImage: { id: 1, tenant: "tenant_a", balance: 90 },
      postImage: { id: 1, tenant: "tenant_a", balance: 120 },
    },
    {
      table: "accounts",
      op: "INSERT" as const,
      key: { id: 2, tenant: "tenant_a" },
      preImage: null,
      postImage: { id: 2, tenant: "tenant_a", balance: 50 },
    },
  ],
};

const record = createTransactionLogRecord(basePayload);
assert.equal(record.txnId, "txn_1001");
assert.equal(record.writeSet.length, 2);
assert.equal(record.checksum.length, 64);
assert.equal(record.checksum, computeTransactionLogChecksum(basePayload));
assert.equal(verifyTransactionLogRecordChecksum(record), true);

const sameDataDifferentKeyOrder = createTransactionLogRecord({
  txnId: "txn_1001",
  at: 1_700_000_000_000,
  writeSet: [
    {
      table: "accounts",
      op: "UPDATE",
      key: { tenant: "tenant_a", id: 1 },
      preImage: { balance: 90, tenant: "tenant_a", id: 1 },
      postImage: { tenant: "tenant_a", id: 1, balance: 120 },
    },
    {
      table: "accounts",
      op: "INSERT",
      key: { tenant: "tenant_a", id: 2 },
      preImage: null,
      postImage: { tenant: "tenant_a", balance: 50, id: 2 },
    },
  ],
});

assert.equal(record.checksum, sameDataDifferentKeyOrder.checksum);

const tamperedRecord: TransactionLogRecord = {
  ...record,
  writeSet: record.writeSet.map((entry, index) =>
    index === 0
      ? {
          ...entry,
          postImage: { ...(entry.postImage ?? {}), balance: 121 },
        }
      : entry,
  ),
};
assert.equal(verifyTransactionLogRecordChecksum(tamperedRecord), false);

assert.throws(
  () =>
    createTransactionLogRecord({
      txnId: "  ",
      at: Date.now(),
      writeSet: [],
    }),
  /txnId must be non-empty/,
);

assert.throws(
  () =>
    createTransactionLogRecord({
      txnId: "txn_bad_insert",
      at: Date.now(),
      writeSet: [
        {
          table: "accounts",
          op: "INSERT",
          key: { id: 9 },
          preImage: { id: 9, balance: 1 },
          postImage: { id: 9, balance: 2 },
        },
      ],
    }),
  /INSERT entry must use preImage=null/,
);

console.log("ok: G-STOR-006 transaction log schema/checksum");
