export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export type LogEntry = {
  level: "debug" | "info" | "warn" | "error";
  scope?: string;
  message: string;
  meta?: Record<string, unknown>;
  timestamp: string;
};

export type LogSink = (entry: LogEntry) => void;

export type Logger = {
  readonly level: LogLevel;
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
  child: (scope: string) => Logger;
};

const PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

type CreateLoggerOptions = {
  level?: LogLevel;
  sink?: LogSink;
  scope?: string;
};

type TypedValueLike = {
  type: string;
  value: unknown;
  metadata?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTypedValueLike(value: unknown): value is TypedValueLike {
  if (!isRecord(value)) return false;
  if (typeof value.type !== "string") return false;
  if (!Object.prototype.hasOwnProperty.call(value, "value")) return false;
  if (!Object.prototype.hasOwnProperty.call(value, "metadata")) return false;
  return isRecord(value.metadata);
}

function stringifyMetaValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (typeof value === "undefined") return "undefined";
  if (value instanceof Date) return value.toISOString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatTypedValueForLog(value: TypedValueLike): string {
  const metadata = isRecord(value.metadata) ? value.metadata : undefined;
  const source = typeof metadata?.source === "string" ? metadata.source : "unknown";
  const context = typeof metadata?.sourceContext === "string" && metadata.sourceContext.trim()
    ? `; context=${metadata.sourceContext}`
    : "";
  return `TypedValue<${value.type}>(${stringifyMetaValue(value.value)}) [source=${source}${context}]`;
}

function normalizeLogMetaValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth <= 0) return "[Truncated]";
  if (isTypedValueLike(value)) return formatTypedValueForLog(value);
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (Array.isArray(value)) return value.map((item) => normalizeLogMetaValue(item, seen, depth - 1));
  if (!isRecord(value)) return value;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return "[Circular]";

  seen.add(value);
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = normalizeLogMetaValue(entry, seen, depth - 1);
  }
  seen.delete(value);
  return out;
}

function normalizeLogMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const normalized = normalizeLogMetaValue(meta, new WeakSet<object>(), 6);
  if (isRecord(normalized) && !Array.isArray(normalized)) return normalized;
  return { value: normalized };
}

export function createLogger(options?: CreateLoggerOptions): Logger {
  const level = options?.level ?? "error";
  const sink = options?.sink ?? (() => {});
  const scope = options?.scope;

  const emit = (entryLevel: "debug" | "info" | "warn" | "error", message: string, meta?: Record<string, unknown>): void => {
    if (PRIORITY[entryLevel] < PRIORITY[level]) return;
    if (level === "silent") return;
    sink({
      level: entryLevel,
      scope,
      message,
      meta: normalizeLogMeta(meta),
      timestamp: new Date().toISOString(),
    });
  };

  return {
    level,
    debug: (message, meta) => emit("debug", message, meta),
    info: (message, meta) => emit("info", message, meta),
    warn: (message, meta) => emit("warn", message, meta),
    error: (message, meta) => emit("error", message, meta),
    child: (childScope: string) =>
      createLogger({
        level,
        sink,
        scope: scope ? `${scope}.${childScope}` : childScope,
      }),
  };
}
