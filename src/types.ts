import { createHash } from "node:crypto";

export const SQL_RUNTIME_TYPE_CANONICAL_NAMES = [
  "NULL",
  "SMALLINT",
  "INT",
  "BIGINT",
  "DECIMAL",
  "FLOAT",
  "DOUBLE",
  "CHAR",
  "VARCHAR",
  "DATE",
  "TIME",
  "TIMESTAMP",
  "BOOLEAN",
  "BLOB",
  "TEXT",
  "STRING",
  "U64",
] as const;

export type SqlRuntimeTypeName = (typeof SQL_RUNTIME_TYPE_CANONICAL_NAMES)[number];
export type SqlRuntimeTypeFamily = "NULL" | "INTEGER" | "NUMERIC" | "CHARACTER" | "TEMPORAL" | "BOOLEAN" | "BINARY";

export interface SqlRuntimeTypeMetadata {
  min?: number | string;
  max?: number | string;
  precision?: number;
  scale?: number;
  scaleOverflowPolicy?: "reject" | "round";
  length?: number;
  fixedLength?: boolean;
  lengthOverflowPolicy?: "reject" | "truncate";
  padCharacter?: string;
  unsigned?: boolean;
  hasTimeZone?: boolean;
  encoding?: "utf8" | "binary";
  finiteOnly?: boolean;
  arithmeticModel?: "ieee754-double";
  format?: string;
  timezonePolicy?: string;
  serializationFormat?: string;
  acceptedLiterals?: string[];
  storageEncoding?: string;
}

export interface SqlRuntimeTypeModel {
  name: SqlRuntimeTypeName;
  family: SqlRuntimeTypeFamily;
  acceptsParameters: boolean;
  metadata: SqlRuntimeTypeMetadata;
}

export const SqlRuntimeType = {
  NULL: "NULL",
  SMALLINT: "SMALLINT",
  INT: "INT",
  INTEGER: "INT",
  BIGINT: "BIGINT",
  DECIMAL: "DECIMAL",
  FLOAT: "FLOAT",
  DOUBLE: "DOUBLE",
  CHAR: "CHAR",
  VARCHAR: "VARCHAR",
  DATE: "DATE",
  TIME: "TIME",
  TIMESTAMP: "TIMESTAMP",
  BOOLEAN: "BOOLEAN",
  BLOB: "BLOB",
  TEXT: "TEXT",
  STRING: "STRING",
  U64: "U64",
} as const satisfies Record<string, SqlRuntimeTypeName>;

export const SQL_RUNTIME_TYPE_ALIASES: Readonly<Record<string, SqlRuntimeTypeName>> = {
  INTEGER: "INT",
  REAL: "DOUBLE",
  NUMERIC: "DECIMAL",
};

export function normalizeRuntimeTypeName(raw: string): SqlRuntimeTypeName | null {
  const key = raw.trim().toUpperCase();
  if (!key) return null;

  if ((SQL_RUNTIME_TYPE_CANONICAL_NAMES as readonly string[]).includes(key)) {
    return key as SqlRuntimeTypeName;
  }

  if (Object.prototype.hasOwnProperty.call(SQL_RUNTIME_TYPE_ALIASES, key)) {
    return SQL_RUNTIME_TYPE_ALIASES[key]!;
  }

  if (Object.prototype.hasOwnProperty.call(SqlRuntimeType, key)) {
    return SqlRuntimeType[key as keyof typeof SqlRuntimeType];
  }

  return null;
}

const BASE_RUNTIME_TYPE_MODELS: Readonly<Record<SqlRuntimeTypeName, Omit<SqlRuntimeTypeModel, "name">>> = {
  NULL: { family: "NULL", acceptsParameters: false, metadata: {} },
  SMALLINT: { family: "INTEGER", acceptsParameters: false, metadata: { min: -32768, max: 32767 } },
  INT: { family: "INTEGER", acceptsParameters: false, metadata: { min: -2147483648, max: 2147483647 } },
  BIGINT: {
    family: "INTEGER",
    acceptsParameters: false,
    metadata: { min: "-9223372036854775808", max: "9223372036854775807" },
  },
  DECIMAL: {
    family: "NUMERIC",
    acceptsParameters: true,
    metadata: { precision: 38, scale: 0, scaleOverflowPolicy: "reject" },
  },
  FLOAT: {
    family: "NUMERIC",
    acceptsParameters: false,
    metadata: { precision: 24, finiteOnly: true, arithmeticModel: "ieee754-double" },
  },
  DOUBLE: {
    family: "NUMERIC",
    acceptsParameters: false,
    metadata: { precision: 53, finiteOnly: true, arithmeticModel: "ieee754-double" },
  },
  CHAR: {
    family: "CHARACTER",
    acceptsParameters: true,
    metadata: {
      length: 1,
      fixedLength: true,
      lengthOverflowPolicy: "reject",
      padCharacter: " ",
      encoding: "utf8",
    },
  },
  VARCHAR: {
    family: "CHARACTER",
    acceptsParameters: true,
    metadata: { length: 255, fixedLength: false, lengthOverflowPolicy: "reject", encoding: "utf8" },
  },
  DATE: {
    family: "TEMPORAL",
    acceptsParameters: false,
    metadata: { format: "YYYY-MM-DD" },
  },
  TIME: {
    family: "TEMPORAL",
    acceptsParameters: false,
    metadata: { format: "HH:MM:SS" },
  },
  TIMESTAMP: {
    family: "TEMPORAL",
    acceptsParameters: false,
    metadata: {
      hasTimeZone: true,
      format: "YYYY-MM-DD[ T]HH:MM:SS[Z|±HH:MM]",
      timezonePolicy: "assume-utc-if-absent normalize-to-utc",
      serializationFormat: "YYYY-MM-DDTHH:MM:SSZ",
    },
  },
  BOOLEAN: {
    family: "BOOLEAN",
    acceptsParameters: false,
    metadata: { acceptedLiterals: ["true", "false", "1", "0"] },
  },
  BLOB: {
    family: "BINARY",
    acceptsParameters: false,
    metadata: { encoding: "binary", storageEncoding: "base64-prefixed" },
  },
  TEXT: {
    family: "CHARACTER",
    acceptsParameters: false,
    metadata: { encoding: "utf8" },
  },
  STRING: {
    family: "CHARACTER",
    acceptsParameters: false,
    metadata: { encoding: "utf8" },
  },
  U64: {
    family: "INTEGER",
    acceptsParameters: false,
    metadata: { min: 0, max: "18446744073709551615", unsigned: true },
  },
};

function validateRuntimeTypeMetadata(name: SqlRuntimeTypeName, metadata: SqlRuntimeTypeMetadata): void {
  if ((name === "CHAR" || name === "VARCHAR") && metadata.length !== undefined) {
    if (!Number.isInteger(metadata.length) || metadata.length <= 0) {
      throw new TypeError(`${name} length must be a positive integer`);
    }
  }

  if (name === "DECIMAL") {
    const precision = metadata.precision;
    const scale = metadata.scale;
    if (precision !== undefined && (!Number.isInteger(precision) || precision <= 0)) {
      throw new TypeError("DECIMAL precision must be a positive integer");
    }
    if (scale !== undefined && (!Number.isInteger(scale) || scale < 0)) {
      throw new TypeError("DECIMAL scale must be a non-negative integer");
    }
    if (precision !== undefined && scale !== undefined && scale > precision) {
      throw new TypeError("DECIMAL scale cannot exceed precision");
    }
  }
}

function freezeRuntimeTypeMetadata(metadata: SqlRuntimeTypeMetadata): Readonly<SqlRuntimeTypeMetadata> {
  const frozen: SqlRuntimeTypeMetadata = { ...metadata };
  for (const key of Object.keys(frozen) as Array<keyof SqlRuntimeTypeMetadata>) {
    const field = frozen[key];
    if (Array.isArray(field)) {
      (frozen as Record<string, unknown>)[key] = Object.freeze([...field]);
    }
  }
  return Object.freeze(frozen);
}

export function createRuntimeTypeModel(
  name: SqlRuntimeTypeName,
  metadata: Partial<SqlRuntimeTypeMetadata> = {},
): SqlRuntimeTypeModel {
  const base = BASE_RUNTIME_TYPE_MODELS[name];
  const mergedMetadata: SqlRuntimeTypeMetadata = { ...base.metadata, ...metadata };
  validateRuntimeTypeMetadata(name, mergedMetadata);
  return Object.freeze({
    name,
    family: base.family,
    acceptsParameters: base.acceptsParameters,
    metadata: freezeRuntimeTypeMetadata(mergedMetadata),
  });
}

export function listRuntimeTypeModels(): SqlRuntimeTypeModel[] {
  return SQL_RUNTIME_TYPE_CANONICAL_NAMES.map((name) => createRuntimeTypeModel(name));
}

export type SqlCastMode = "implicit" | "explicit";
export type SqlCastPolicy = "allow" | "reject";

const NUMERIC_RUNTIME_TYPES = new Set<SqlRuntimeTypeName>([
  "SMALLINT",
  "INT",
  "BIGINT",
  "DECIMAL",
  "FLOAT",
  "DOUBLE",
  "U64",
]);

const TEXT_RUNTIME_TYPES = new Set<SqlRuntimeTypeName>(["TEXT", "STRING", "CHAR", "VARCHAR"]);
const TEMPORAL_RUNTIME_TYPES = new Set<SqlRuntimeTypeName>(["DATE", "TIME", "TIMESTAMP"]);

export function resolveCastPolicy(
  source: SqlRuntimeTypeName,
  target: SqlRuntimeTypeName,
  mode: SqlCastMode,
): SqlCastPolicy {
  if (source === "NULL" || source === target) return "allow";

  if (TEXT_RUNTIME_TYPES.has(target)) return "allow";
  if (target === "BLOB") return "allow";

  if (NUMERIC_RUNTIME_TYPES.has(target)) {
    if (NUMERIC_RUNTIME_TYPES.has(source)) return "allow";
    if (TEXT_RUNTIME_TYPES.has(source)) return "allow";
    if (source === "BOOLEAN") return mode === "explicit" ? "allow" : "reject";
    return "reject";
  }

  if (target === "BOOLEAN") {
    if (source === "BOOLEAN") return "allow";
    if (NUMERIC_RUNTIME_TYPES.has(source)) return "allow";
    if (TEXT_RUNTIME_TYPES.has(source)) return "allow";
    return "reject";
  }

  if (TEMPORAL_RUNTIME_TYPES.has(target)) {
    if (TEXT_RUNTIME_TYPES.has(source)) return "allow";
    return "reject";
  }

  return "reject";
}

const BLOB_BASE64_PREFIX = "base64:";
const BLOB_HEX_PREFIX = "hex:";

function normalizeBase64(payload: string): string {
  const trimmed = payload.trim();
  if (!trimmed) throw new TypeError("BLOB base64 payload cannot be empty");
  const raw = Buffer.from(trimmed, "base64");
  if (raw.length === 0) throw new TypeError("BLOB base64 payload is invalid");
  const canonical = raw.toString("base64");
  if (canonical.replace(/=+$/, "") !== trimmed.replace(/=+$/, "")) {
    throw new TypeError("BLOB base64 payload is invalid");
  }
  return canonical;
}

function hexToBytes(payload: string): Uint8Array {
  const hex = payload.trim();
  if (!hex || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new TypeError("BLOB hex payload is invalid");
  }
  return Buffer.from(hex, "hex");
}

export function encodeBlob(value: string | Uint8Array): string {
  if (value instanceof Uint8Array) return `${BLOB_BASE64_PREFIX}${Buffer.from(value).toString("base64")}`;

  const trimmed = value.trim();
  if (trimmed.toLowerCase().startsWith(BLOB_BASE64_PREFIX)) {
    const payload = trimmed.slice(BLOB_BASE64_PREFIX.length);
    return `${BLOB_BASE64_PREFIX}${normalizeBase64(payload)}`;
  }

  if (trimmed.toLowerCase().startsWith(BLOB_HEX_PREFIX)) {
    const payload = trimmed.slice(BLOB_HEX_PREFIX.length);
    return `${BLOB_BASE64_PREFIX}${Buffer.from(hexToBytes(payload)).toString("base64")}`;
  }

  return `${BLOB_BASE64_PREFIX}${Buffer.from(value, "utf8").toString("base64")}`;
}

export function decodeBlob(encoded: string): Uint8Array {
  const trimmed = encoded.trim();
  if (!trimmed.toLowerCase().startsWith(BLOB_BASE64_PREFIX)) {
    throw new TypeError("BLOB value must use base64: prefix");
  }
  const payload = trimmed.slice(BLOB_BASE64_PREFIX.length);
  return Buffer.from(normalizeBase64(payload), "base64");
}

export type SqlPrimitive = string | number | boolean | null;
export type SqlRow = Record<string, SqlPrimitive>;

export function inferRuntimeTypeModel(value: SqlPrimitive): SqlRuntimeTypeModel {
  if (value === null) return createRuntimeTypeModel(SqlRuntimeType.NULL);
  if (typeof value === "boolean") return createRuntimeTypeModel(SqlRuntimeType.BOOLEAN);
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      if (!Number.isSafeInteger(value)) return createRuntimeTypeModel(SqlRuntimeType.DOUBLE);
      const intType = value >= -2147483648 && value <= 2147483647 ? SqlRuntimeType.INT : SqlRuntimeType.BIGINT;
      return createRuntimeTypeModel(intType);
    }
    return createRuntimeTypeModel(SqlRuntimeType.FLOAT);
  }
  return createRuntimeTypeModel(SqlRuntimeType.TEXT, { length: value.length });
}

export function inferRuntimeType(value: SqlPrimitive): SqlRuntimeTypeName {
  return inferRuntimeTypeModel(value).name;
}

export type SqlTypedValueSource = "js" | "literal" | "storage" | "computed";

export interface SqlTypedValueMetadata {
  runtimeType: SqlRuntimeTypeModel;
  source: SqlTypedValueSource;
  sourceContext?: string;
}

export interface SqlTypedValue {
  type: SqlRuntimeTypeName;
  value: SqlPrimitive;
  metadata: Readonly<SqlTypedValueMetadata>;
  // Compatibility alias for existing callers; points to metadata.runtimeType.
  runtimeType: SqlRuntimeTypeModel;
}

function parseIntegerString(value: string): bigint | null {
  const trimmed = value.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  return BigInt(trimmed);
}

function parseDecimalString(value: string): boolean {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim());
}

const SMALLINT_MIN = -32768;
const SMALLINT_MAX = 32767;
const INT_MIN = -2147483648;
const INT_MAX = 2147483647;
const BIGINT_MIN = BigInt("-9223372036854775808");
const BIGINT_MAX = BigInt("9223372036854775807");
const U64_MIN = BigInt(0);
const U64_MAX = BigInt("18446744073709551615");
const MIN_SAFE_INTEGER_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function validateIntegerRange(value: number, min: number, max: number, typeName: string): void {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${typeName} value must be an integer`);
  }
  if (value < min || value > max) {
    throw new TypeError(`${typeName} value out of range`);
  }
}

function validateBigIntRange(value: number | string, min: bigint, max: bigint, typeName: string): void {
  let normalized: bigint;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new TypeError(`${typeName} value must be an integer`);
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`${typeName} numeric input must be a safe integer; use a string for large integers`);
    }
    normalized = BigInt(value);
  } else {
    const parsed = parseIntegerString(value);
    if (parsed === null) throw new TypeError(`${typeName} string value must be an integer`);
    normalized = parsed;
  }
  if (normalized < min || normalized > max) {
    throw new TypeError(`${typeName} value out of range`);
  }
}

export function validateTypedValue(value: SqlPrimitive, runtimeType: SqlRuntimeTypeModel): void {
  const type = runtimeType.name;
  if (type === "NULL") {
    if (value !== null) throw new TypeError("NULL typed value must be null");
    return;
  }
  if (value === null) return;

  switch (type) {
    case "SMALLINT":
      if (typeof value !== "number") throw new TypeError("SMALLINT value must be a number");
      validateIntegerRange(value, SMALLINT_MIN, SMALLINT_MAX, "SMALLINT");
      return;
    case "INT":
      if (typeof value !== "number") throw new TypeError("INT value must be a number");
      validateIntegerRange(value, INT_MIN, INT_MAX, "INT");
      return;
    case "BIGINT":
      if (typeof value !== "number" && typeof value !== "string") {
        throw new TypeError("BIGINT value must be a number or integer string");
      }
      validateBigIntRange(value, BIGINT_MIN, BIGINT_MAX, "BIGINT");
      return;
    case "U64":
      if (typeof value !== "number" && typeof value !== "string") {
        throw new TypeError("U64 value must be a number or integer string");
      }
      validateBigIntRange(value, U64_MIN, U64_MAX, "U64");
      return;
    case "DECIMAL":
      if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new TypeError("DECIMAL numeric value must be finite");
        return;
      }
      if (typeof value === "string" && parseDecimalString(value)) return;
      throw new TypeError("DECIMAL value must be a finite number or decimal string");
    case "FLOAT":
    case "DOUBLE":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(`${type} value must be a finite number`);
      }
      return;
    case "BOOLEAN":
      if (typeof value !== "boolean") throw new TypeError("BOOLEAN value must be true/false");
      return;
    case "CHAR":
    case "VARCHAR":
    case "TEXT":
    case "STRING":
    case "DATE":
    case "TIME":
    case "TIMESTAMP":
    case "BLOB":
      if (typeof value !== "string") throw new TypeError(`${type} value must be a string`);
      if ((type === "CHAR" || type === "VARCHAR") && runtimeType.metadata.length !== undefined) {
        if (value.length > runtimeType.metadata.length) {
          throw new TypeError(`${type} value exceeds max length ${runtimeType.metadata.length}`);
        }
      }
      return;
    default:
      // Exhaustive fallback for future types.
      throw new TypeError(`Unsupported runtime type validation: ${type as string}`);
  }
}

function createTypedValue(
  value: SqlPrimitive,
  source: SqlTypedValueSource,
  explicitType?: SqlRuntimeTypeName,
  runtimeTypeMetadata: Partial<SqlRuntimeTypeMetadata> = {},
  sourceContext?: string,
): SqlTypedValue {
  const runtimeType = explicitType ? createRuntimeTypeModel(explicitType, runtimeTypeMetadata) : inferRuntimeTypeModel(value);
  validateTypedValue(value, runtimeType);

  const typedMetadata: SqlTypedValueMetadata = {
    runtimeType,
    source,
  };
  if (sourceContext !== undefined) typedMetadata.sourceContext = sourceContext;

  const frozenMetadata = Object.freeze(typedMetadata);
  return Object.freeze({
    type: runtimeType.name,
    value,
    metadata: frozenMetadata,
    runtimeType: frozenMetadata.runtimeType,
  });
}

export function toTypedValue(
  value: SqlPrimitive,
  explicitType?: SqlRuntimeTypeName,
  metadata: Partial<SqlRuntimeTypeMetadata> = {},
): SqlTypedValue {
  return createTypedValue(value, "js", explicitType, metadata);
}

export function fromJs(
  value: SqlPrimitive,
  explicitType?: SqlRuntimeTypeName,
  metadata: Partial<SqlRuntimeTypeMetadata> = {},
  sourceContext?: string,
): SqlTypedValue {
  return createTypedValue(value, "js", explicitType, metadata, sourceContext);
}

export function fromLiteral(
  value: SqlPrimitive,
  explicitType?: SqlRuntimeTypeName,
  metadata: Partial<SqlRuntimeTypeMetadata> = {},
  sourceContext?: string,
): SqlTypedValue {
  return createTypedValue(value, "literal", explicitType, metadata, sourceContext);
}

export function fromStorage(
  value: SqlPrimitive,
  explicitType?: SqlRuntimeTypeName,
  metadata: Partial<SqlRuntimeTypeMetadata> = {},
  sourceContext?: string,
): SqlTypedValue {
  return createTypedValue(value, "storage", explicitType, metadata, sourceContext);
}

export interface SqlTypedValueConvertOptions {
  mode?: SqlCastMode;
  targetMetadata?: Partial<SqlRuntimeTypeMetadata>;
  sourceContext?: string;
}

function toFiniteNumber(value: SqlPrimitive, targetType: SqlRuntimeTypeName): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new TypeError(`invalid ${targetType} literal: ${String(value)}`);
  return n;
}

function toInteger(value: SqlPrimitive, targetType: SqlRuntimeTypeName): number {
  const n = toFiniteNumber(value, targetType);
  if (!Number.isInteger(n)) throw new TypeError(`expected integer for ${targetType}, got ${String(value)}`);
  return n;
}

function toBigInt(value: SqlPrimitive, targetType: SqlRuntimeTypeName): bigint {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new TypeError(`expected integer for ${targetType}, got ${String(value)}`);
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`unsafe integer literal for ${targetType}; use quoted digits for precise conversion`);
    }
    return BigInt(value);
  }

  const raw = String(value).trim();
  if (!/^[+-]?\d+$/.test(raw)) throw new TypeError(`expected integer for ${targetType}, got ${String(value)}`);
  return BigInt(raw);
}

function normalizeDecimal(value: SqlPrimitive, precision: number, scale: number): string {
  const s = String(value).trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(s)) throw new TypeError(`invalid DECIMAL literal: ${s}`);
  const sign = s.startsWith("-") ? "-" : "";
  const [intPartRaw, fracPartRaw = ""] = s.replace(/^[+-]/, "").split(".");
  const intPart = intPartRaw.replace(/^0+(?=\d)/, "") || "0";
  const fracPart = fracPartRaw;
  const maxIntegerDigits = precision - scale;

  if (fracPart.length > scale) {
    throw new TypeError(`DECIMAL(${precision},${scale}) scale overflow (rounding disabled): ${s}`);
  }
  if (intPart.length > maxIntegerDigits) {
    throw new TypeError(`DECIMAL(${precision},${scale}) overflow: ${s}`);
  }

  if (scale === 0) return `${sign}${intPart}`;
  const paddedFrac = fracPart.padEnd(scale, "0");
  const isZero = intPart === "0" && /^0*$/.test(paddedFrac);
  const normalizedSign = sign === "-" && !isZero ? "-" : "";
  return `${normalizedSign}${intPart}.${paddedFrac}`;
}

function coercePrimitiveToType(targetType: SqlRuntimeTypeName, value: SqlPrimitive, metadata: SqlRuntimeTypeMetadata): SqlPrimitive {
  if (value === null) return null;

  if (targetType === "TEXT" || targetType === "STRING") return String(value);

  if (targetType === "CHAR" || targetType === "VARCHAR") {
    const str = String(value);
    const maxLen = metadata.length ?? str.length;
    if (str.length > maxLen) {
      throw new TypeError(`${targetType}(${maxLen}) length overflow: ${str.length}`);
    }
    return targetType === "CHAR" ? str.padEnd(maxLen, metadata.padCharacter ?? " ") : str;
  }

  if (targetType === "SMALLINT") {
    const n = toInteger(value, targetType);
    if (n < SMALLINT_MIN || n > SMALLINT_MAX) throw new TypeError(`SMALLINT out of range: ${n}`);
    return n;
  }
  if (targetType === "INT") {
    const n = toInteger(value, targetType);
    if (n < INT_MIN || n > INT_MAX) throw new TypeError(`INT out of range: ${n}`);
    return n;
  }
  if (targetType === "BIGINT") {
    const n = toBigInt(value, targetType);
    if (n < BIGINT_MIN || n > BIGINT_MAX) throw new TypeError(`BIGINT out of range: ${n.toString()}`);
    if (n < MIN_SAFE_INTEGER_BIGINT || n > MAX_SAFE_INTEGER_BIGINT) return n.toString();
    return Number(n);
  }
  if (targetType === "U64") {
    const n = toBigInt(value, targetType);
    if (n < U64_MIN || n > U64_MAX) throw new TypeError(`U64 out of range: ${n.toString()}`);
    if (n > MAX_SAFE_INTEGER_BIGINT) return n.toString();
    return Number(n);
  }
  if (targetType === "DECIMAL") {
    return normalizeDecimal(value, metadata.precision ?? 38, metadata.scale ?? 0);
  }
  if (targetType === "FLOAT" || targetType === "DOUBLE") {
    return toFiniteNumber(value, targetType);
  }
  if (targetType === "BOOLEAN") {
    if (typeof value === "boolean") return value;
    const v = String(value).trim().toLowerCase();
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
    throw new TypeError(`invalid BOOLEAN: ${String(value)}`);
  }
  if (targetType === "DATE") {
    const s = String(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new TypeError(`invalid DATE: ${s}`);
    const d = new Date(`${s}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new TypeError(`invalid DATE: ${s}`);
    return s;
  }
  if (targetType === "TIME") {
    const s = String(value);
    if (!/^\d{2}:\d{2}:\d{2}$/.test(s)) throw new TypeError(`invalid TIME: ${s}`);
    const [hh, mm, ss] = s.split(":").map((x) => Number(x));
    if (hh > 23 || mm > 59 || ss > 59) throw new TypeError(`invalid TIME: ${s}`);
    return s;
  }
  if (targetType === "TIMESTAMP") {
    const s = String(value).trim();
    const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\s*(Z|[+-]\d{2}:\d{2}))?$/i);
    if (!m) throw new TypeError(`invalid TIMESTAMP: ${s}`);

    const datePart = m[1]!;
    const timePart = m[2]!;
    const zonePart = (m[3] ?? "Z").toUpperCase();

    const dateCheck = new Date(`${datePart}T00:00:00.000Z`);
    if (Number.isNaN(dateCheck.getTime()) || dateCheck.toISOString().slice(0, 10) !== datePart) {
      throw new TypeError(`invalid TIMESTAMP: ${s}`);
    }

    const [hh, mm, ss] = timePart.split(":").map((x) => Number(x));
    if (hh > 23 || mm > 59 || ss > 59) throw new TypeError(`invalid TIMESTAMP: ${s}`);

    if (zonePart !== "Z") {
      const [zh, zm] = zonePart.slice(1).split(":").map((x) => Number(x));
      if (zh > 23 || zm > 59) throw new TypeError(`invalid TIMESTAMP: ${s}`);
    }

    const dt = new Date(`${datePart}T${timePart}${zonePart}`);
    if (Number.isNaN(dt.getTime())) throw new TypeError(`invalid TIMESTAMP: ${s}`);
    return `${dt.toISOString().slice(0, 19)}Z`;
  }
  if (targetType === "BLOB") {
    return encodeBlob(typeof value === "string" ? value : String(value));
  }
  if (targetType === "NULL") {
    if (value !== null) throw new TypeError("NULL typed value must be null");
    return null;
  }

  throw new TypeError(`unsupported conversion target: ${targetType}`);
}

export function convertTypedValue(
  input: SqlTypedValue,
  targetType: SqlRuntimeTypeName,
  options: SqlTypedValueConvertOptions = {},
): SqlTypedValue {
  const mode = options.mode ?? "explicit";
  if (resolveCastPolicy(input.type, targetType, mode) === "reject") {
    if (mode === "implicit") {
      throw new TypeError(`implicit cast ${input.type} -> ${targetType} not allowed`);
    }
    throw new TypeError(`CAST ${input.type} -> ${targetType} not allowed`);
  }

  const targetRuntimeType = createRuntimeTypeModel(targetType, options.targetMetadata ?? {});
  if (input.value === null) {
    return createTypedValue(null, "computed", targetRuntimeType.name, targetRuntimeType.metadata, options.sourceContext);
  }

  const converted = coercePrimitiveToType(targetRuntimeType.name, input.value, targetRuntimeType.metadata);
  return createTypedValue(converted, "computed", targetRuntimeType.name, targetRuntimeType.metadata, options.sourceContext);
}

export interface TypedValueSerializationMetadataV1 {
  source?: SqlTypedValueSource;
  sourceContext?: string;
  runtimeTypeMetadata?: Partial<SqlRuntimeTypeMetadata>;
}

export interface SerializedTypedValueV1 {
  version: 1;
  type: SqlRuntimeTypeName;
  value: SqlPrimitive;
  metadata?: TypedValueSerializationMetadataV1;
}

export type SerializedTypedValue = SerializedTypedValueV1;

export interface LegacySerializedTypedValue {
  type: string;
  value: SqlPrimitive;
  runtimeType?: {
    metadata?: Partial<SqlRuntimeTypeMetadata>;
  };
  metadata?: {
    source?: SqlTypedValueSource;
    sourceContext?: string;
    runtimeTypeMetadata?: Partial<SqlRuntimeTypeMetadata>;
  };
}

function isSqlPrimitiveValue(value: unknown): value is SqlPrimitive {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isTypedValueSource(value: unknown): value is SqlTypedValueSource {
  return value === "js" || value === "literal" || value === "storage" || value === "computed";
}

export function serializeTypedValue(value: SqlTypedValue): SerializedTypedValueV1 {
  return {
    version: 1,
    type: value.type,
    value: value.value,
    metadata: {
      source: value.metadata.source,
      sourceContext: value.metadata.sourceContext,
      runtimeTypeMetadata: { ...value.runtimeType.metadata },
    },
  };
}

export function deserializeTypedValue(payload: SerializedTypedValue | LegacySerializedTypedValue): SqlTypedValue {
  const version = "version" in payload ? payload.version : undefined;
  if (version !== undefined && version !== 1) {
    throw new TypeError(`unsupported TypedValue serialization version: ${String(version)}`);
  }

  if (!isSqlPrimitiveValue(payload.value)) {
    throw new TypeError("serialized TypedValue value must be SQL primitive");
  }

  const normalizedType = normalizeRuntimeTypeName(payload.type);
  if (!normalizedType) throw new TypeError(`invalid serialized TypedValue type: ${String(payload.type)}`);

  const metadata = payload.metadata;
  const source = isTypedValueSource(metadata?.source) ? metadata!.source : "storage";
  const sourceContext = metadata?.sourceContext;
  const legacyRuntimeTypeMetadata = "runtimeType" in payload ? payload.runtimeType?.metadata : undefined;
  const runtimeTypeMetadata = metadata?.runtimeTypeMetadata ?? legacyRuntimeTypeMetadata ?? {};
  return createTypedValue(payload.value, source, normalizedType, runtimeTypeMetadata, sourceContext);
}

export function fromTypedValue(v: SqlTypedValue): SqlPrimitive {
  return v.value;
}

export type SqlThreeValuedLogic = true | false | null;

export interface SqlTypedValueComparator {
  eq: (left: SqlTypedValue, right: SqlTypedValue) => SqlThreeValuedLogic;
  lt: (left: SqlTypedValue, right: SqlTypedValue) => SqlThreeValuedLogic;
  lte: (left: SqlTypedValue, right: SqlTypedValue) => SqlThreeValuedLogic;
  gt: (left: SqlTypedValue, right: SqlTypedValue) => SqlThreeValuedLogic;
  gte: (left: SqlTypedValue, right: SqlTypedValue) => SqlThreeValuedLogic;
}

function isNumericType(type: SqlRuntimeTypeName): boolean {
  return (
    type === "SMALLINT" ||
    type === "INT" ||
    type === "BIGINT" ||
    type === "DECIMAL" ||
    type === "FLOAT" ||
    type === "DOUBLE" ||
    type === "U64"
  );
}

function isTextualType(type: SqlRuntimeTypeName): boolean {
  return (
    type === "CHAR" ||
    type === "VARCHAR" ||
    type === "TEXT" ||
    type === "STRING" ||
    type === "DATE" ||
    type === "TIME" ||
    type === "TIMESTAMP" ||
    type === "BLOB"
  );
}

function normalizeNumericTypedValue(value: SqlTypedValue): number {
  if (value.value === null) throw new TypeError("cannot normalize NULL for numeric comparison");

  if (typeof value.value === "number") return value.value;
  if (typeof value.value === "string" && parseDecimalString(value.value)) return Number(value.value);

  throw new TypeError(`numeric comparison requires numeric value, received ${typeof value.value}`);
}

function compareNonNullTypedValue(left: SqlTypedValue, right: SqlTypedValue): number {
  const leftType = left.type;
  const rightType = right.type;

  if (isNumericType(leftType) && isNumericType(rightType)) {
    const lv = normalizeNumericTypedValue(left);
    const rv = normalizeNumericTypedValue(right);
    if (lv === rv) return 0;
    return lv < rv ? -1 : 1;
  }

  if (leftType === "BOOLEAN" && rightType === "BOOLEAN") {
    if (left.value === right.value) return 0;
    return left.value === false ? -1 : 1;
  }

  if (isTextualType(leftType) && isTextualType(rightType)) {
    const lv = left.value as string;
    const rv = right.value as string;
    if (lv === rv) return 0;
    return lv < rv ? -1 : 1;
  }

  throw new TypeError(`incompatible typed comparison: ${leftType} vs ${rightType}`);
}

function compareTypedValuesInternal(left: SqlTypedValue, right: SqlTypedValue): number | null {
  if (left.value === null || right.value === null) return null;
  return compareNonNullTypedValue(left, right);
}

export function typedValueEq(left: SqlTypedValue, right: SqlTypedValue): SqlThreeValuedLogic {
  const cmp = compareTypedValuesInternal(left, right);
  if (cmp === null) return null;
  return cmp === 0;
}

export function typedValueLt(left: SqlTypedValue, right: SqlTypedValue): SqlThreeValuedLogic {
  const cmp = compareTypedValuesInternal(left, right);
  if (cmp === null) return null;
  return cmp < 0;
}

export function typedValueLte(left: SqlTypedValue, right: SqlTypedValue): SqlThreeValuedLogic {
  const cmp = compareTypedValuesInternal(left, right);
  if (cmp === null) return null;
  return cmp <= 0;
}

export function typedValueGt(left: SqlTypedValue, right: SqlTypedValue): SqlThreeValuedLogic {
  const cmp = compareTypedValuesInternal(left, right);
  if (cmp === null) return null;
  return cmp > 0;
}

export function typedValueGte(left: SqlTypedValue, right: SqlTypedValue): SqlThreeValuedLogic {
  const cmp = compareTypedValuesInternal(left, right);
  if (cmp === null) return null;
  return cmp >= 0;
}

export const typedValueComparator: SqlTypedValueComparator = Object.freeze({
  eq: typedValueEq,
  lt: typedValueLt,
  lte: typedValueLte,
  gt: typedValueGt,
  gte: typedValueGte,
});

export interface SqlTypedValueOperators {
  add: (left: SqlTypedValue, right: SqlTypedValue) => SqlTypedValue;
  sub: (left: SqlTypedValue, right: SqlTypedValue) => SqlTypedValue;
  mul: (left: SqlTypedValue, right: SqlTypedValue) => SqlTypedValue;
  div: (left: SqlTypedValue, right: SqlTypedValue) => SqlTypedValue;
  and: (left: SqlTypedValue, right: SqlTypedValue) => SqlTypedValue;
  or: (left: SqlTypedValue, right: SqlTypedValue) => SqlTypedValue;
  not: (value: SqlTypedValue) => SqlTypedValue;
}

function numericPromotionRank(type: SqlRuntimeTypeName): number {
  switch (type) {
    case "SMALLINT":
      return 1;
    case "INT":
      return 2;
    case "BIGINT":
    case "U64":
      return 3;
    case "DECIMAL":
      return 4;
    case "FLOAT":
      return 5;
    case "DOUBLE":
      return 6;
    default:
      return -1;
  }
}

function assertNumericTypedValue(value: SqlTypedValue, side: "left" | "right"): void {
  if (!isNumericType(value.type)) {
    throw new TypeError(`${side} operand must be numeric typed value, received ${value.type}`);
  }
}

function promoteArithmeticType(
  leftType: SqlRuntimeTypeName,
  rightType: SqlRuntimeTypeName,
  op: "add" | "sub" | "mul" | "div",
): SqlRuntimeTypeName {
  if (op === "div") return "DOUBLE";

  const leftRank = numericPromotionRank(leftType);
  const rightRank = numericPromotionRank(rightType);
  if (leftRank < 0 || rightRank < 0) throw new TypeError(`numeric promotion requires numeric types: ${leftType}, ${rightType}`);

  const rank = Math.max(leftRank, rightRank);
  switch (rank) {
    case 1:
      return "SMALLINT";
    case 2:
      return "INT";
    case 3:
      return leftType === "BIGINT" || rightType === "BIGINT" ? "BIGINT" : "U64";
    case 4:
      return "DECIMAL";
    case 5:
      return "FLOAT";
    default:
      return "DOUBLE";
  }
}

function arithmeticBinaryOp(
  left: SqlTypedValue,
  right: SqlTypedValue,
  op: "add" | "sub" | "mul" | "div",
  operation: (left: number, right: number) => number,
): SqlTypedValue {
  assertNumericTypedValue(left, "left");
  assertNumericTypedValue(right, "right");

  const promotedType = promoteArithmeticType(left.type, right.type, op);
  if (left.value === null || right.value === null) {
    return createTypedValue(null, "computed", promotedType, {}, op);
  }

  const leftNumber = normalizeNumericTypedValue(left);
  const rightNumber = normalizeNumericTypedValue(right);
  const raw = operation(leftNumber, rightNumber);
  if (!Number.isFinite(raw)) throw new TypeError(`${op} produced non-finite numeric result`);

  return createTypedValue(raw, "computed", promotedType, {}, op);
}

function toLogicalTruthValue(value: SqlTypedValue): SqlThreeValuedLogic {
  if (value.value === null) return null;
  if (value.type !== "BOOLEAN") throw new TypeError(`logical operand must be BOOLEAN typed value, received ${value.type}`);
  if (typeof value.value !== "boolean") throw new TypeError("logical BOOLEAN typed value must be true/false");
  return value.value;
}

export function typedValueAdd(left: SqlTypedValue, right: SqlTypedValue): SqlTypedValue {
  return arithmeticBinaryOp(left, right, "add", (l, r) => l + r);
}

export function typedValueSub(left: SqlTypedValue, right: SqlTypedValue): SqlTypedValue {
  return arithmeticBinaryOp(left, right, "sub", (l, r) => l - r);
}

export function typedValueMul(left: SqlTypedValue, right: SqlTypedValue): SqlTypedValue {
  return arithmeticBinaryOp(left, right, "mul", (l, r) => l * r);
}

export function typedValueDiv(left: SqlTypedValue, right: SqlTypedValue): SqlTypedValue {
  return arithmeticBinaryOp(left, right, "div", (l, r) => l / r);
}

export function typedValueAnd(left: SqlTypedValue, right: SqlTypedValue): SqlTypedValue {
  const lv = toLogicalTruthValue(left);
  const rv = toLogicalTruthValue(right);
  if (lv === false || rv === false) return createTypedValue(false, "computed", "BOOLEAN", {}, "and");
  if (lv === true && rv === true) return createTypedValue(true, "computed", "BOOLEAN", {}, "and");
  return createTypedValue(null, "computed", "BOOLEAN", {}, "and");
}

export function typedValueOr(left: SqlTypedValue, right: SqlTypedValue): SqlTypedValue {
  const lv = toLogicalTruthValue(left);
  const rv = toLogicalTruthValue(right);
  if (lv === true || rv === true) return createTypedValue(true, "computed", "BOOLEAN", {}, "or");
  if (lv === false && rv === false) return createTypedValue(false, "computed", "BOOLEAN", {}, "or");
  return createTypedValue(null, "computed", "BOOLEAN", {}, "or");
}

export function typedValueNot(value: SqlTypedValue): SqlTypedValue {
  const truth = toLogicalTruthValue(value);
  if (truth === null) return createTypedValue(null, "computed", "BOOLEAN", {}, "not");
  return createTypedValue(!truth, "computed", "BOOLEAN", {}, "not");
}

export const typedValueOperators: SqlTypedValueOperators = Object.freeze({
  add: typedValueAdd,
  sub: typedValueSub,
  mul: typedValueMul,
  div: typedValueDiv,
  and: typedValueAnd,
  or: typedValueOr,
  not: typedValueNot,
});

export type SessionTransactionState = "idle" | "active" | "committing" | "aborted";

export interface ExecuteResult {
  txDigest: string;
  statementType: "CREATE" | "INSERT" | "UPDATE" | "DELETE" | "SELECT" | "BEGIN" | "COMMIT" | "ROLLBACK" | "SAVEPOINT" | "RELEASE" | "CURSOR" | "GRANT" | "REVOKE" | "SET" | "UNKNOWN";
  affectedRows?: number;
  /** For INSERT/UPDATE/DELETE with RETURNING clause */
  returningRows?: SqlRow[];
  tableObjectId?: string;
  raw?: unknown;
  moveCall?: {
    target: string;
    arguments: string[];
    typeArguments?: string[];
    tableName?: string;
  };
}

export interface QueryResult {
  rows: SqlRow[];
}

export interface QueryProofResult extends QueryResult {
  proof: {
    manifestHash: string;
    indexRoot: string;
    blockHeight: number;
    txDigest: string;
  };
}

export type StorageWriteOperation =
  | "CREATE_TABLE"
  | "DROP_TABLE"
  | "ALTER_TABLE"
  | "INSERT_ROW"
  | "UPDATE_ROW"
  | "DELETE_ROW"
  | "INDEX_REBUILD";

export interface StorageWriteEvent {
  table: string;
  op: StorageWriteOperation;
  affectedRows: number;
  mode: "simulator" | "onchain";
  at: number;
}

export type TransactionLogWriteOperation = "INSERT" | "UPDATE" | "DELETE";

export interface TransactionLogWriteEntry {
  table: string;
  op: TransactionLogWriteOperation;
  key: Record<string, SqlPrimitive>;
  preImage: SqlRow | null;
  postImage: SqlRow | null;
}

export interface TransactionLogRecordPayload {
  txnId: string;
  writeSet: TransactionLogWriteEntry[];
  at: number;
}

export interface TransactionLogRecord extends TransactionLogRecordPayload {
  checksum: string;
}

export type TransactionWalEntryPhase = "PREPARE" | "COMMIT" | "ROLLBACK";

export interface TransactionWalEntry {
  phase: TransactionWalEntryPhase;
  txnId: string;
  at: number;
  record?: TransactionLogRecord;
}

export interface TransactionCommitBatchPayload {
  txnId: string;
  writeSet: TransactionLogWriteEntry[];
  checksum: string;
  at: number;
}

export interface TransactionCommitBatchResult {
  digest: string;
  raw?: unknown;
}

export interface VersionedStorageObject {
  table: string;
  objectId: string;
  version: number;
  prevVersion: number | null;
  currentVersion: number;
  commitDigest: string;
  createdAt: number;
  confirmationStatus: "pending" | "confirmed";
  immutable: true;
  rows: ReadonlyArray<Readonly<SqlRow>>;
}

export type IndexStorageObjectType = "HASH" | "BTREE";

export interface IndexHashStorageBucket {
  encodedKey: string;
  rowKeys: ReadonlyArray<string>;
}

export interface IndexBtreeStorageEntry {
  key: SqlPrimitive;
  rowKeys: ReadonlyArray<string>;
}

export type IndexStoragePayload =
  | {
      indexType: "HASH";
      buckets: ReadonlyArray<IndexHashStorageBucket>;
    }
  | {
      indexType: "BTREE";
      entries: ReadonlyArray<IndexBtreeStorageEntry>;
    };

export interface IndexVersionedStorageObject {
  table: string;
  indexName: string;
  column: string;
  indexType: IndexStorageObjectType;
  objectId: string;
  version: number;
  prevVersion: number | null;
  currentVersion: number;
  commitDigest: string;
  createdAt: number;
  confirmationStatus: "pending" | "confirmed";
  immutable: true;
  keyCount: number;
  rowCount: number;
  payload: IndexStoragePayload;
}

export interface DurabilityRecoverySummary {
  strategy: "rollback" | "replay";
  restoredTables: string[];
  pendingBefore: string[];
  pendingAfter: string[];
}

export interface TransactionObservabilityStats {
  started: number;
  committed: number;
  aborted: number;
  abortRatio: number;
  avgTxnLatencyMs: number;
  maxTxnLatencyMs: number;
  totalTxnLatencyMs: number;
  totalLockWaitMs: number;
  lockWaitEvents: number;
}

function stableSerializeJson(value: unknown): string {
  if (value === null) return "null";

  const valueType = typeof value;
  if (valueType === "string" || valueType === "number" || valueType === "boolean") {
    return JSON.stringify(value);
  }

  if (valueType !== "object") return "null";

  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? "null" : stableSerializeJson(item))).join(",")}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((key) => obj[key] !== undefined)
    .sort();
  const pairs = keys.map((key) => `${JSON.stringify(key)}:${stableSerializeJson(obj[key])}`);
  return `{${pairs.join(",")}}`;
}

function sanitizeRow(row: SqlRow | null): SqlRow | null {
  if (row === null) return null;
  const out: SqlRow = {};
  for (const [key, value] of Object.entries(row)) out[key] = value;
  return out;
}

function sanitizeWriteKey(key: Record<string, SqlPrimitive>): Record<string, SqlPrimitive> {
  const out: Record<string, SqlPrimitive> = {};
  for (const [name, value] of Object.entries(key)) out[name] = value;
  return out;
}

function normalizeWriteSetEntry(entry: TransactionLogWriteEntry): TransactionLogWriteEntry {
  if (!entry.table?.trim()) throw new TypeError("transaction log write entry table must be non-empty");
  if (!entry.op) throw new TypeError("transaction log write entry op is required");
  if (!entry.key || typeof entry.key !== "object") throw new TypeError("transaction log write entry key must be an object");

  const preImage = sanitizeRow(entry.preImage);
  const postImage = sanitizeRow(entry.postImage);

  if (entry.op === "INSERT" && preImage !== null) {
    throw new TypeError("transaction log INSERT entry must use preImage=null");
  }
  if (entry.op === "INSERT" && postImage === null) {
    throw new TypeError("transaction log INSERT entry must include postImage");
  }
  if (entry.op === "DELETE" && postImage !== null) {
    throw new TypeError("transaction log DELETE entry must use postImage=null");
  }
  if (entry.op === "DELETE" && preImage === null) {
    throw new TypeError("transaction log DELETE entry must include preImage");
  }
  if (entry.op === "UPDATE" && (preImage === null || postImage === null)) {
    throw new TypeError("transaction log UPDATE entry must include both preImage and postImage");
  }

  return {
    table: entry.table,
    op: entry.op,
    key: sanitizeWriteKey(entry.key),
    preImage,
    postImage,
  };
}

function normalizeTransactionLogPayload(payload: TransactionLogRecordPayload): TransactionLogRecordPayload {
  const txnId = payload.txnId?.trim();
  if (!txnId) throw new TypeError("transaction log txnId must be non-empty");
  if (!Array.isArray(payload.writeSet)) throw new TypeError("transaction log writeSet must be an array");
  if (!Number.isFinite(payload.at)) throw new TypeError("transaction log at must be a finite number");

  return {
    txnId,
    writeSet: payload.writeSet.map((entry) => normalizeWriteSetEntry(entry)),
    at: payload.at,
  };
}

export function computeTransactionLogChecksum(payload: TransactionLogRecordPayload): string {
  const normalized = normalizeTransactionLogPayload(payload);
  return createHash("sha256").update(stableSerializeJson(normalized)).digest("hex");
}

export function createTransactionLogRecord(payload: TransactionLogRecordPayload): TransactionLogRecord {
  const normalized = normalizeTransactionLogPayload(payload);
  return {
    ...normalized,
    checksum: computeTransactionLogChecksum(normalized),
  };
}

export function verifyTransactionLogRecordChecksum(record: TransactionLogRecord): boolean {
  return record.checksum === computeTransactionLogChecksum(record);
}

export interface OnchainQueryRequest {
  sql: string;
  table: string;
  fields: string[] | ["*"];
  where?: string;
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: "ASC" | "DESC";
  orderByList?: Array<{ field: string; direction: "ASC" | "DESC" }>;
  aggregate?: "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";
  aggregateField?: string;
  groupBy?: string[];
  having?: string;
  explain?: boolean;
  join?: {
    type: "INNER" | "LEFT" | "RIGHT" | "FULL";
    table: string;
    leftField: string;
    rightField: string;
  };
  joins?: Array<{
    type: "INNER" | "LEFT" | "RIGHT" | "FULL";
    table: string;
    leftField: string;
    rightField: string;
  }>;
}

export type OnchainQueryExecutor = (req: OnchainQueryRequest) => Promise<QueryResult>;

export interface WalrusSqlViewPolicyOptions {
  allowCreate?: boolean;
  allowDrop?: boolean;
  allowSelect?: boolean;
  allowedViewNames?: string[];
}

export interface WalrusSqlClientOptions {
  packageId: string;
  network: "sui-mainnet" | "sui-testnet" | "sui-devnet" | string;
  signerAddress?: string;
  authUsername?: string;  // for SQL-layer permission checks (simulator only)
  mode?: "simulator" | "onchain";
  isolationLevel?: "read_committed" | "serializable" | "repeatable_read";
  transactionTimeoutMs?: number;
  moduleName?: string;
  dialect?: "ansi" | "sqlite" | "postgres" | "mysql" | "sqlserver";
  onchainExecutor?: import("./onchain.js").OnchainExecutor;
  onchainQueryExecutor?: OnchainQueryExecutor;
  readCache?: {
    enabled?: boolean;
    maxEntries?: number;
    ttlMs?: number;
  };
  walrusRetry?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
  wal?: {
    enabled?: boolean;
    filePath?: string;
    maxEntries?: number;
    archivePath?: string;
    checkpointPath?: string;
  };
  transactionCommitExecutor?: (payload: TransactionCommitBatchPayload) => Promise<TransactionCommitBatchResult>;
  logging?: {
    level?: import("./logger.js").LogLevel;
    sink?: import("./logger.js").LogSink;
  };
  joinExecution?: {
    memoryBudgetRows?: number;
    spillChunkRows?: number;
  };
  viewPolicy?: WalrusSqlViewPolicyOptions;
}
