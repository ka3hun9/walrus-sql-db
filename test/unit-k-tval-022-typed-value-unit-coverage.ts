import { strict as assert } from "node:assert";
import {
  SqlRuntimeType,
  convertTypedValue,
  fromJs,
  fromLiteral,
  fromStorage,
  toTypedValue,
  typedValueComparator,
  typedValueOperators,
} from "../src/types.js";

const jsVal = fromJs(7, SqlRuntimeType.INT, {}, "k22.fromJs");
assert.equal(jsVal.type, SqlRuntimeType.INT);
assert.equal(jsVal.value, 7);
assert.equal(jsVal.metadata.source, "js");
assert.equal(jsVal.metadata.sourceContext, "k22.fromJs");

const literalVal = fromLiteral("abc", SqlRuntimeType.TEXT, {}, "k22.fromLiteral");
assert.equal(literalVal.type, SqlRuntimeType.TEXT);
assert.equal(literalVal.metadata.source, "literal");

const storageVal = fromStorage("11", SqlRuntimeType.VARCHAR, { length: 16 }, "k22.fromStorage");
assert.equal(storageVal.type, SqlRuntimeType.VARCHAR);
assert.equal(storageVal.metadata.source, "storage");

const implicitTyped = toTypedValue(true);
assert.equal(implicitTyped.type, SqlRuntimeType.BOOLEAN);
assert.equal(implicitTyped.value, true);

assert.equal(typedValueComparator.eq(jsVal, fromLiteral(7, SqlRuntimeType.INT)), true);
assert.equal(typedValueComparator.lt(fromJs(1, SqlRuntimeType.INT), fromJs(2, SqlRuntimeType.INT)), true);
assert.equal(typedValueComparator.gte(fromJs(2, SqlRuntimeType.INT), fromJs(2, SqlRuntimeType.INT)), true);
assert.equal(typedValueComparator.eq(fromJs(null, SqlRuntimeType.INT), fromJs(1, SqlRuntimeType.INT)), null);
assert.throws(
  () => typedValueComparator.eq(fromJs(true, SqlRuntimeType.BOOLEAN), fromJs("x", SqlRuntimeType.TEXT)),
  /incompatible typed comparison/,
);

assert.equal(typedValueOperators.add(fromJs(1, SqlRuntimeType.INT), fromJs(2, SqlRuntimeType.INT)).value, 3);
assert.equal(typedValueOperators.sub(fromJs(10, SqlRuntimeType.INT), fromJs(3, SqlRuntimeType.INT)).value, 7);
assert.equal(typedValueOperators.mul(fromJs(3, SqlRuntimeType.INT), fromJs(4, SqlRuntimeType.INT)).value, 12);
assert.equal(typedValueOperators.div(fromJs(9, SqlRuntimeType.INT), fromJs(3, SqlRuntimeType.INT)).value, 3);
assert.equal(typedValueOperators.and(fromJs(true, SqlRuntimeType.BOOLEAN), fromJs(null, SqlRuntimeType.BOOLEAN)).value, null);
assert.equal(typedValueOperators.or(fromJs(false, SqlRuntimeType.BOOLEAN), fromJs(true, SqlRuntimeType.BOOLEAN)).value, true);
assert.equal(typedValueOperators.not(fromJs(true, SqlRuntimeType.BOOLEAN)).value, false);
assert.equal(typedValueOperators.add(fromJs(null, SqlRuntimeType.INT), fromJs(2, SqlRuntimeType.INT)).value, null);
assert.throws(
  () => typedValueOperators.add(fromJs(true, SqlRuntimeType.BOOLEAN), fromJs(1, SqlRuntimeType.INT)),
  /must be numeric typed value/,
);

const implicitInt = convertTypedValue(fromLiteral("42", SqlRuntimeType.TEXT), SqlRuntimeType.INT, {
  mode: "implicit",
  sourceContext: "k22.convert.implicit",
});
assert.equal(implicitInt.type, SqlRuntimeType.INT);
assert.equal(implicitInt.value, 42);

const explicitBool = convertTypedValue(fromLiteral("false", SqlRuntimeType.TEXT), SqlRuntimeType.BOOLEAN, {
  mode: "explicit",
  sourceContext: "k22.convert.explicit",
});
assert.equal(explicitBool.type, SqlRuntimeType.BOOLEAN);
assert.equal(explicitBool.value, false);

const nullToDouble = convertTypedValue(fromJs(null, SqlRuntimeType.INT), SqlRuntimeType.DOUBLE, {
  mode: "implicit",
});
assert.equal(nullToDouble.type, SqlRuntimeType.DOUBLE);
assert.equal(nullToDouble.value, null);

assert.throws(
  () => convertTypedValue(fromJs(true, SqlRuntimeType.BOOLEAN), SqlRuntimeType.INT, { mode: "implicit" }),
  /implicit cast BOOLEAN -> INT not allowed/,
);
assert.throws(
  () => convertTypedValue(fromLiteral("nope", SqlRuntimeType.TEXT), SqlRuntimeType.INT, { mode: "explicit" }),
  /invalid INT/,
);
assert.throws(
  () => fromJs("x", SqlRuntimeType.NULL),
  /NULL typed value must be null/,
);

console.log("ok: K-TVAL-022 typed value unit coverage (construct/compare/operator/convert/null/error)");
