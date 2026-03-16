import { strict as assert } from "node:assert";
import { SqlRuntimeType, toTypedValue } from "../src/types.js";

const implicit = toTypedValue(7);
assert.equal(implicit.type, SqlRuntimeType.INT);
assert.equal(implicit.value, 7);
assert.equal(implicit.runtimeType, implicit.metadata.runtimeType);
assert.equal(implicit.metadata.runtimeType.name, SqlRuntimeType.INT);
assert.equal(implicit.metadata.source, "js");

assert.equal(Object.isFrozen(implicit), true);
assert.equal(Object.isFrozen(implicit.metadata), true);
assert.equal(Object.isFrozen(implicit.runtimeType), true);
assert.equal(Object.isFrozen(implicit.runtimeType.metadata), true);

assert.throws(() => {
  (implicit as { type: string }).type = SqlRuntimeType.TEXT;
}, /(read only|Cannot assign)/i);

const explicit = toTypedValue("abc", SqlRuntimeType.VARCHAR, { length: 8 });
assert.equal(explicit.type, SqlRuntimeType.VARCHAR);
assert.equal(explicit.metadata.runtimeType.metadata.length, 8);

assert.throws(() => {
  (explicit.metadata.runtimeType.metadata as { length: number }).length = 64;
}, /(read only|Cannot assign)/i);

console.log("ok: K-TVAL-001 typed value core");
