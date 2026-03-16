import { strict as assert } from "node:assert";
import { SqlRuntimeType, deserializeTypedValue, fromStorage, serializeTypedValue } from "../src/types.js";

const legacyVarchar = deserializeTypedValue({
  type: "VARCHAR",
  value: "abc",
  runtimeType: {
    metadata: { length: 8 },
  },
});
assert.equal(legacyVarchar.type, SqlRuntimeType.VARCHAR);
assert.equal(legacyVarchar.value, "abc");
assert.equal(legacyVarchar.metadata.runtimeType.metadata.length, 8);
assert.equal(legacyVarchar.metadata.source, "storage");

const legacyWithMeta = deserializeTypedValue({
  type: "INT",
  value: 7,
  metadata: {
    source: "literal",
    sourceContext: "legacy.payload",
  },
});
assert.equal(legacyWithMeta.type, SqlRuntimeType.INT);
assert.equal(legacyWithMeta.value, 7);
assert.equal(legacyWithMeta.metadata.source, "literal");
assert.equal(legacyWithMeta.metadata.sourceContext, "legacy.payload");

const v1 = serializeTypedValue(fromStorage("hello", SqlRuntimeType.TEXT, {}, "v1.source"));
const restoredV1 = deserializeTypedValue(v1);
assert.equal(restoredV1.type, SqlRuntimeType.TEXT);
assert.equal(restoredV1.value, "hello");
assert.equal(restoredV1.metadata.source, "storage");
assert.equal(restoredV1.metadata.sourceContext, "v1.source");

assert.throws(
  () => deserializeTypedValue({ version: 9, type: "INT", value: 1 } as never),
  /unsupported TypedValue serialization version/,
);

console.log("ok: K-TVAL-017 legacy + v1 typed value deserialization");
