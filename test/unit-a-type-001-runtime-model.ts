import { strict as assert } from "node:assert";
import {
  SQL_RUNTIME_TYPE_CANONICAL_NAMES,
  SqlRuntimeType,
  createRuntimeTypeModel,
  inferRuntimeTypeModel,
  listRuntimeTypeModels,
  toTypedValue,
} from "../src/types.js";

const allModels = listRuntimeTypeModels();
assert.equal(allModels.length, SQL_RUNTIME_TYPE_CANONICAL_NAMES.length);
for (const name of SQL_RUNTIME_TYPE_CANONICAL_NAMES) {
  assert.ok(allModels.some((m) => m.name === name), `missing runtime type model: ${name}`);
}

const decimal = createRuntimeTypeModel(SqlRuntimeType.DECIMAL, { precision: 18, scale: 6 });
assert.equal(decimal.family, "NUMERIC");
assert.equal(decimal.acceptsParameters, true);
assert.equal(decimal.metadata.precision, 18);
assert.equal(decimal.metadata.scale, 6);
assert.equal(decimal.metadata.scaleOverflowPolicy, "reject");

const float = createRuntimeTypeModel(SqlRuntimeType.FLOAT);
assert.equal(float.metadata.finiteOnly, true);
assert.equal(float.metadata.arithmeticModel, "ieee754-double");

const double = createRuntimeTypeModel(SqlRuntimeType.DOUBLE);
assert.equal(double.metadata.precision, 53);
assert.equal(double.metadata.finiteOnly, true);
assert.equal(double.metadata.arithmeticModel, "ieee754-double");

const charType = createRuntimeTypeModel(SqlRuntimeType.CHAR);
assert.equal(charType.metadata.fixedLength, true);
assert.equal(charType.metadata.lengthOverflowPolicy, "reject");
assert.equal(charType.metadata.padCharacter, " ");

const varcharType = createRuntimeTypeModel(SqlRuntimeType.VARCHAR);
assert.equal(varcharType.metadata.fixedLength, false);
assert.equal(varcharType.metadata.lengthOverflowPolicy, "reject");

const dateType = createRuntimeTypeModel(SqlRuntimeType.DATE);
assert.equal(dateType.metadata.format, "YYYY-MM-DD");

const timeType = createRuntimeTypeModel(SqlRuntimeType.TIME);
assert.equal(timeType.metadata.format, "HH:MM:SS");

const timestampType = createRuntimeTypeModel(SqlRuntimeType.TIMESTAMP);
assert.equal(timestampType.metadata.serializationFormat, "YYYY-MM-DDTHH:MM:SSZ");
assert.equal(timestampType.metadata.timezonePolicy, "assume-utc-if-absent normalize-to-utc");

assert.throws(() => createRuntimeTypeModel(SqlRuntimeType.DECIMAL, { precision: 4, scale: 5 }), /scale cannot exceed precision/);
assert.throws(() => createRuntimeTypeModel(SqlRuntimeType.CHAR, { length: 0 }), /positive integer/);

assert.equal(inferRuntimeTypeModel(null).name, SqlRuntimeType.NULL);
assert.equal(inferRuntimeTypeModel(true).name, SqlRuntimeType.BOOLEAN);
assert.equal(inferRuntimeTypeModel(123).name, SqlRuntimeType.INT);
assert.equal(inferRuntimeTypeModel(3_000_000_000).name, SqlRuntimeType.BIGINT);
assert.equal(inferRuntimeTypeModel(1.5).name, SqlRuntimeType.FLOAT);
const inferredText = inferRuntimeTypeModel("hello");
assert.equal(inferredText.name, SqlRuntimeType.TEXT);
assert.equal(inferredText.metadata.length, 5);

const explicit = toTypedValue("abc", SqlRuntimeType.VARCHAR, { length: 32 });
assert.equal(explicit.type, SqlRuntimeType.VARCHAR);
assert.equal(explicit.runtimeType.metadata.length, 32);

console.log("ok: A-TYPE-001 runtime type model");
