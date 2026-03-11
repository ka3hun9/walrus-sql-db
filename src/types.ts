export type SqlPrimitive = string | number | boolean | null;
export type SqlRow = Record<string, SqlPrimitive>;

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

export interface OnchainQueryRequest {
  sql: string;
  table: string;
  fields: string[] | ["*"];
  where?: string;
}

export type OnchainQueryExecutor = (req: OnchainQueryRequest) => Promise<QueryResult>;

export interface WalrusSqlClientOptions {
  packageId: string;
  network: "sui-mainnet" | "sui-testnet" | "sui-devnet" | string;
  signerAddress?: string;
  mode?: "simulator" | "onchain";
  moduleName?: string;
  onchainExecutor?: import("./onchain.js").OnchainExecutor;
  onchainQueryExecutor?: OnchainQueryExecutor;
}
