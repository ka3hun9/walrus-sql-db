import type { WalrusSqlClientOptions } from "./types.js";
import { WalrusSqlClient } from "./client.js";
import type { LogLevel } from "./logger.js";

export interface LoadClientConfigOptions {
  env?: NodeJS.ProcessEnv;
  overrides?: Partial<WalrusSqlClientOptions>;
}

const MODE_VALUES = ["simulator", "onchain"] as const;
const DIALECT_VALUES = ["ansi", "sqlite", "postgres", "mysql", "sqlserver"] as const;
const LOG_LEVEL_VALUES = ["debug", "info", "warn", "error", "silent"] as const;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : fallback;
}

function pick<T>(overrideValue: T | undefined, envValue: T | undefined, fallback: T | undefined): T | undefined {
  if (overrideValue !== undefined) return overrideValue;
  if (envValue !== undefined) return envValue;
  return fallback;
}

function ensureEnum<T extends string>(
  label: string,
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if ((allowed as readonly string[]).includes(normalized)) return normalized as T;
  throw new Error(`Invalid ${label}: ${value}. Allowed: ${allowed.join(", ")}`);
}

export function loadWalrusSqlClientOptions(options?: LoadClientConfigOptions): WalrusSqlClientOptions {
  const env = options?.env ?? process.env;
  const overrides = options?.overrides ?? {};

  const packageId = pick(overrides.packageId, env.WALRUS_SQL_PACKAGE_ID, undefined);
  if (!packageId) {
    throw new Error("Missing packageId. Set WALRUS_SQL_PACKAGE_ID or pass overrides.packageId.");
  }

  const network = pick(overrides.network, env.WALRUS_SQL_NETWORK, "sui-testnet")!;
  const mode = ensureEnum(
    "mode",
    pick<string | undefined>(overrides.mode, env.WALRUS_SQL_MODE, undefined),
    MODE_VALUES,
    "simulator",
  );
  const moduleName = pick(overrides.moduleName, env.WALRUS_SQL_MODULE, "walrus_sql");
  const dialect = ensureEnum(
    "dialect",
    pick<string | undefined>(overrides.dialect, env.WALRUS_SQL_DIALECT, undefined),
    DIALECT_VALUES,
    "ansi",
  );
  const signerAddress = pick(overrides.signerAddress, env.WALRUS_SQL_SIGNER_ADDRESS, undefined);

  const readCacheEnabled = pick(
    overrides.readCache?.enabled,
    env.WALRUS_SQL_READ_CACHE_ENABLED !== undefined
      ? parseBoolean(env.WALRUS_SQL_READ_CACHE_ENABLED, true)
      : undefined,
    true,
  );
  const readCacheMaxEntries = pick(
    overrides.readCache?.maxEntries,
    env.WALRUS_SQL_READ_CACHE_MAX_ENTRIES !== undefined
      ? Math.max(1, Math.floor(parseNumber(env.WALRUS_SQL_READ_CACHE_MAX_ENTRIES, 256)))
      : undefined,
    256,
  );
  const readCacheTtlMs = pick(
    overrides.readCache?.ttlMs,
    env.WALRUS_SQL_READ_CACHE_TTL_MS !== undefined
      ? Math.max(1, Math.floor(parseNumber(env.WALRUS_SQL_READ_CACHE_TTL_MS, 5_000)))
      : undefined,
    5_000,
  );

  const retryMaxAttempts = pick(
    overrides.walrusRetry?.maxAttempts,
    env.WALRUS_SQL_RETRY_MAX_ATTEMPTS !== undefined
      ? Math.max(1, Math.floor(parseNumber(env.WALRUS_SQL_RETRY_MAX_ATTEMPTS, 3)))
      : undefined,
    3,
  );
  const retryBaseDelayMs = pick(
    overrides.walrusRetry?.baseDelayMs,
    env.WALRUS_SQL_RETRY_BASE_DELAY_MS !== undefined
      ? Math.max(1, Math.floor(parseNumber(env.WALRUS_SQL_RETRY_BASE_DELAY_MS, 120)))
      : undefined,
    120,
  );
  const retryMaxDelayMs = pick(
    overrides.walrusRetry?.maxDelayMs,
    env.WALRUS_SQL_RETRY_MAX_DELAY_MS !== undefined
      ? Math.max(1, Math.floor(parseNumber(env.WALRUS_SQL_RETRY_MAX_DELAY_MS, 1_500)))
      : undefined,
    1_500,
  );

  const logLevel = ensureEnum(
    "log level",
    pick<string | undefined>(overrides.logging?.level, env.WALRUS_SQL_LOG_LEVEL, undefined),
    LOG_LEVEL_VALUES,
    "error",
  ) as LogLevel;
  const joinMemoryBudgetRows = pick(
    overrides.joinExecution?.memoryBudgetRows,
    env.WALRUS_SQL_JOIN_MEMORY_BUDGET_ROWS !== undefined
      ? Math.max(1, Math.floor(parseNumber(env.WALRUS_SQL_JOIN_MEMORY_BUDGET_ROWS, 4096)))
      : undefined,
    4096,
  );

  return {
    packageId,
    network,
    mode,
    moduleName,
    dialect,
    signerAddress,
    onchainExecutor: overrides.onchainExecutor,
    onchainQueryExecutor: overrides.onchainQueryExecutor,
    readCache: {
      enabled: readCacheEnabled,
      maxEntries: readCacheMaxEntries,
      ttlMs: readCacheTtlMs,
    },
    walrusRetry: {
      maxAttempts: retryMaxAttempts,
      baseDelayMs: retryBaseDelayMs,
      maxDelayMs: retryMaxDelayMs,
    },
    logging: {
      level: logLevel,
      sink: overrides.logging?.sink,
    },
    joinExecution: {
      memoryBudgetRows: joinMemoryBudgetRows,
    },
  };
}

export function createClientFromConfig(options?: LoadClientConfigOptions): WalrusSqlClient {
  return new WalrusSqlClient(loadWalrusSqlClientOptions(options));
}
