import { strict as assert } from "node:assert";
import { SqlRuntimeType, fromJs, fromLiteral, typedValueOperators } from "../src/types.js";

const one = fromJs(1, SqlRuntimeType.INT);
const two = fromJs(2, SqlRuntimeType.SMALLINT);

const add = typedValueOperators.add(one, two);
assert.equal(add.type, SqlRuntimeType.INT);
assert.equal(add.value, 3);
assert.equal(add.metadata.source, "computed");

const sub = typedValueOperators.sub(fromJs(10, SqlRuntimeType.INT), fromJs(4, SqlRuntimeType.INT));
assert.equal(sub.type, SqlRuntimeType.INT);
assert.equal(sub.value, 6);

const mul = typedValueOperators.mul(fromLiteral("2.5", SqlRuntimeType.DECIMAL), fromJs(2, SqlRuntimeType.INT));
assert.equal(mul.type, SqlRuntimeType.DECIMAL);
assert.equal(mul.value, 5);

const div = typedValueOperators.div(fromJs(7, SqlRuntimeType.INT), fromJs(2, SqlRuntimeType.INT));
assert.equal(div.type, SqlRuntimeType.DOUBLE);
assert.equal(div.value, 3.5);

const nullAdd = typedValueOperators.add(fromJs(null, SqlRuntimeType.INT), fromJs(1, SqlRuntimeType.INT));
assert.equal(nullAdd.type, SqlRuntimeType.INT);
assert.equal(nullAdd.value, null);

const andFalse = typedValueOperators.and(fromJs(false, SqlRuntimeType.BOOLEAN), fromJs(null, SqlRuntimeType.BOOLEAN));
assert.equal(andFalse.type, SqlRuntimeType.BOOLEAN);
assert.equal(andFalse.value, false);

const orNull = typedValueOperators.or(fromJs(null, SqlRuntimeType.BOOLEAN), fromJs(false, SqlRuntimeType.BOOLEAN));
assert.equal(orNull.value, null);

const notTrue = typedValueOperators.not(fromJs(true, SqlRuntimeType.BOOLEAN));
assert.equal(notTrue.value, false);

assert.throws(() => typedValueOperators.add(fromJs(true, SqlRuntimeType.BOOLEAN), fromJs(1, SqlRuntimeType.INT)), /must be numeric typed value/);
assert.throws(() => typedValueOperators.and(fromJs(1, SqlRuntimeType.INT), fromJs(true, SqlRuntimeType.BOOLEAN)), /must be BOOLEAN typed value/);
assert.throws(() => typedValueOperators.div(fromJs(1, SqlRuntimeType.INT), fromJs(0, SqlRuntimeType.INT)), /non-finite numeric result/);

console.log("ok: K-TVAL-004 typed value operators");
