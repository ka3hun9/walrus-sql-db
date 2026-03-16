import { strict as assert } from "node:assert";
import { SqlRuntimeType, fromJs, fromLiteral, typedValueComparator } from "../src/types.js";

const intSeven = fromJs(7, SqlRuntimeType.INT);
const intTen = fromJs(10, SqlRuntimeType.INT);
assert.equal(typedValueComparator.eq(intSeven, fromLiteral(7, SqlRuntimeType.INT)), true);
assert.equal(typedValueComparator.lt(intSeven, intTen), true);
assert.equal(typedValueComparator.lte(intSeven, intSeven), true);
assert.equal(typedValueComparator.gt(intTen, intSeven), true);
assert.equal(typedValueComparator.gte(intTen, intTen), true);

const decimal = fromLiteral("10.50", SqlRuntimeType.DECIMAL);
assert.equal(typedValueComparator.gt(decimal, intTen), true);
assert.equal(typedValueComparator.eq(decimal, fromLiteral("10.5", SqlRuntimeType.DECIMAL)), true);

const boolFalse = fromJs(false, SqlRuntimeType.BOOLEAN);
const boolTrue = fromJs(true, SqlRuntimeType.BOOLEAN);
assert.equal(typedValueComparator.lt(boolFalse, boolTrue), true);

const textA = fromJs("a", SqlRuntimeType.TEXT);
const textB = fromJs("b", SqlRuntimeType.TEXT);
assert.equal(typedValueComparator.lt(textA, textB), true);

const nullInt = fromJs(null, SqlRuntimeType.INT);
assert.equal(typedValueComparator.eq(nullInt, intSeven), null);
assert.equal(typedValueComparator.lt(nullInt, intSeven), null);
assert.equal(typedValueComparator.eq(nullInt, fromJs(null, SqlRuntimeType.INT)), null);

assert.throws(() => typedValueComparator.eq(boolTrue, textA), /incompatible typed comparison/);

console.log("ok: K-TVAL-003 typed value compare 3VL");
