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
    metadata: {},
  },
  TIME: {
    family: "TEMPORAL",
    acceptsParameters: false,
    metadata: {},
  },
  TIMESTAMP: {
    family: "TEMPORAL",
    acceptsParameters: false,
    metadata: { hasTimeZone: false },
  },
  BOOLEAN: {
    family: "BOOLEAN",
    acceptsParameters: false,
    metadata: {},
  },
  BLOB: {
    family: "BINARY",
    acceptsParameters: false,
    metadata: { encoding: "binary" },
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
    type: "INNER" | "LEFT" | "RIGHT";
    table: string;
    leftField: string;
    rightField: string;
  };
  joins?: Array<{
    type: "INNER" | "LEFT" | "RIGHT";
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
