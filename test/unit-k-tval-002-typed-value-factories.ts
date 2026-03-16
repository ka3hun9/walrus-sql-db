import { strict as assert } from "node:assert";
import { SqlRuntimeType, fromJs, fromLiteral, fromStorage } from "../src/types.js";

const fromJsValue = fromJs(12);
assert.equal(fromJsValue.type, SqlRuntimeType.INT);
assert.equal(fromJsValue.metadata.source, "js");

const fromLiteralValue = fromLiteral("abc", SqlRuntimeType.VARCHAR, { length: 8 }, "SELECT literal");
assert.equal(fromLiteralValue.type, SqlRuntimeType.VARCHAR);
assert.equal(fromLiteralValue.metadata.source, "literal");
assert.equal(fromLiteralValue.metadata.sourceContext, "SELECT literal");
assert.equal(fromLiteralValue.metadata.runtimeType.metadata.length, 8);

const fromStorageValue = fromStorage("base64:aGVsbG8=", SqlRuntimeType.BLOB, {}, "row payload");
assert.equal(fromStorageValue.type, SqlRuntimeType.BLOB);
assert.equal(fromStorageValue.metadata.source, "storage");
assert.equal(fromStorageValue.metadata.sourceContext, "row payload");

assert.throws(() => fromJs(true, SqlRuntimeType.INT), /INT value must be a number/);
assert.throws(() => fromLiteral("foo", SqlRuntimeType.INT), /INT value must be a number/);
assert.throws(() => fromStorage("100000", SqlRuntimeType.SMALLINT), /SMALLINT value must be a number/);
assert.throws(() => fromJs("abc", SqlRuntimeType.VARCHAR, { length: 2 }), /exceeds max length/);
assert.throws(() => fromStorage("1.2.3", SqlRuntimeType.DECIMAL), /DECIMAL value must be a finite number or decimal string/);

console.log("ok: K-TVAL-002 typed value factories");
