import { createHash } from "node:crypto";

export type OnchainStatementType = "CREATE" | "INSERT" | "UPDATE" | "DELETE";

export interface MoveCallRequest {
  target: string;
  arguments: string[];
  typeArguments?: string[];
  gasBudget?: number;
  statementType: OnchainStatementType;
}

export interface OnchainExecutionResult {
  digest: string;
  raw?: unknown;
}

export type OnchainExecutor = (req: MoveCallRequest) => Promise<OnchainExecutionResult>;

export function buildMoveCall(params: {
  packageId: string;
  moduleName?: string;
  sql: string;
}): MoveCallRequest {
  const moduleName = params.moduleName ?? "walrus_sql";
  const sql = params.sql.trim().replace(/\s+/g, " ");
  const upper = sql.toUpperCase();

  if (upper.startsWith("CREATE TABLE")) {
    const m = sql.match(/CREATE TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\((.+)\)/i);
    if (!m) throw new Error(`Unsupported CREATE TABLE syntax: ${sql}`);
    const table = m[1];
    const schema = m[2];
    return {
      target: `${params.packageId}::${moduleName}::create_table`,
      arguments: [table, schema],
      statementType: "CREATE",
    };
  }

  const fakeRowHash = hashHex(`row:${sql}`);
  const fakeManifest = hashHex(`manifest:${sql}`);
  const fakeIndex = hashHex(`index:${sql}`);

  if (upper.startsWith("INSERT INTO")) {
    return {
      target: `${params.packageId}::${moduleName}::insert`,
      arguments: [fakeRowHash, fakeManifest, fakeIndex],
      statementType: "INSERT",
    };
  }

  if (upper.startsWith("UPDATE")) {
    return {
      target: `${params.packageId}::${moduleName}::update`,
      arguments: [fakeRowHash, fakeManifest, fakeIndex],
      statementType: "UPDATE",
    };
  }

  if (upper.startsWith("DELETE FROM")) {
    return {
      target: `${params.packageId}::${moduleName}::delete`,
      arguments: [fakeRowHash, fakeManifest, fakeIndex],
      statementType: "DELETE",
    };
  }

  throw new Error(`Unsupported on-chain statement: ${sql}`);
}

function hashHex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
