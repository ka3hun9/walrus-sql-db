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

export function createRuntimeTypeModel(
  name: SqlRuntimeTypeName,
  metadata: Partial<SqlRuntimeTypeMetadata> = {},
): SqlRuntimeTypeModel {
  const base = BASE_RUNTIME_TYPE_MODELS[name];
  const mergedMetadata: SqlRuntimeTypeMetadata = { ...base.metadata, ...metadata };
  validateRuntimeTypeMetadata(name, mergedMetadata);
  return {
    name,
    family: base.family,
    acceptsParameters: base.acceptsParameters,
    metadata: mergedMetadata,
  };
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

export interface SqlTypedValue {
  type: SqlRuntimeTypeName;
  value: SqlPrimitive;
  runtimeType: SqlRuntimeTypeModel;
}

export function toTypedValue(
  value: SqlPrimitive,
  explicitType?: SqlRuntimeTypeName,
  metadata: Partial<SqlRuntimeTypeMetadata> = {},
): SqlTypedValue {
  const runtimeType = explicitType ? createRuntimeTypeModel(explicitType, metadata) : inferRuntimeTypeModel(value);
  return { type: runtimeType.name, value, runtimeType };
}

export function fromTypedValue(v: SqlTypedValue): SqlPrimitive {
  return v.value;
}

export interface ExecuteResult {
  txDigest: string;
  statementType: "CREATE" | "INSERT" | "UPDATE" | "DELETE" | "UNKNOWN";
  affectedRows?: number;
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
  | "DELETE_ROW";

export interface StorageWriteEvent {
  table: string;
  op: StorageWriteOperation;
  affectedRows: number;
  mode: "simulator" | "onchain";
  at: number;
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

export interface WalrusSqlClientOptions {
  packageId: string;
  network: "sui-mainnet" | "sui-testnet" | "sui-devnet" | string;
  signerAddress?: string;
  mode?: "simulator" | "onchain";
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
  logging?: {
    level?: import("./logger.js").LogLevel;
    sink?: import("./logger.js").LogSink;
  };
}
