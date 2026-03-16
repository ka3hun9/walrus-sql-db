import { strict as assert } from "node:assert";
import { SqlRuntimeType, deserializeTypedValue, fromLiteral, serializeTypedValue } from "../src/types.js";

const typed = fromLiteral("abc", SqlRuntimeType.VARCHAR, { length: 8 }, "k16.source");
const serialized = serializeTypedValue(typed);

assert.equal(serialized.version, 1);
assert.equal(serialized.type, SqlRuntimeType.VARCHAR);
assert.equal(serialized.value, "abc");
assert.equal(serialized.metadata?.source, "literal");
assert.equal(serialized.metadata?.sourceContext, "k16.source");
assert.equal(serialized.metadata?.runtimeTypeMetadata?.length, 8);

const restored = deserializeTypedValue(serialized);
assert.equal(restored.type, SqlRuntimeType.VARCHAR);
assert.equal(restored.value, "abc");
assert.equal(restored.metadata.source, "literal");
assert.equal(restored.metadata.sourceContext, "k16.source");
assert.equal(restored.metadata.runtimeType.metadata.length, 8);

assert.throws(
  () => deserializeTypedValue({ version: 2, type: SqlRuntimeType.INT, value: 1 } as never),
  /unsupported TypedValue serialization version/,
);
assert.throws(
  () => deserializeTypedValue({ version: 1, type: "BAD_TYPE", value: 1 } as never),
  /invalid serialized TypedValue type/,
);

console.log("ok: K-TVAL-016 typed value serialization protocol v1");
