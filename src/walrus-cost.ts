/**
 * Walrus Query Cost Estimation Engine
 *
 * Estimates the on-chain cost (gas + latency) of a SQL query based on:
 * - Number of objects that need to be read/written
 * - Estimated bytes to download
 * - Gas price in USD
 * - Network latency
 *
 * Provides a costScore (0-100) for query plan comparison.
 */

export interface QueryCostConfig {
  maxCostScore: number;
  preference: "realtime" | "cost" | "balanced";
  gasPriceUSD: number;
  onCostExceeded: "throw" | "warn" | "proceed";
  gasPerRead: number;
  gasPerWrite: number;
}

export interface QueryCostEstimate {
  /** Estimated gas units for this query */
  estimatedGas: number;
  /** Estimated cost in USD at current gas price */
  estimatedGasCostUSD: number;
  /** Estimated end-to-end latency in ms */
  estimatedLatencyMs: number;
  /** Number of Walrus objects to read from chain */
  objectsToRead: number;
  /** Estimated bytes to download */
  bytesToDownload: number;
  /** Estimated number of write operations */
  operationsToWrite: number;
  /** Cost score 0-100 (lower = cheaper) */
  costScore: number;
  /** Breakdown tags for debugging */
  tags: string[];
  /** The query that was estimated */
  query: string;
  /** Estimation timestamp */
  at: number;
}

export type QueryType = "point" | "range" | "full_scan" | "indexed" | "join" | "aggregate" | "subquery";

/** Gas constants per operation type */
const GAS_PER_POINT_READ = 10;
const GAS_PER_RANGE_READ = 30;
const GAS_PER_FULL_SCAN = 100;
const GAS_PER_INDEXED_LOOKUP = 15;
const GAS_PER_JOIN = 200;
const GAS_PER_AGGREGATE = 80;
const GAS_PER_SUBQUERY = 100;
const GAS_PER_WRITE = 50;
const GAS_PER_BATCH_DISCOUNT = 0.7; // 30% discount for batched writes

/** Latency constants (ms) */
const LATENCY_PER_OBJECT_READ = 50;  // per Walrus object read
const LATENCY_PER_OBJECT_WRITE = 100; // per on-chain write
const LATENCY_RPC_OVERHEAD = 30;      // per RPC call overhead
const LATENCY_BATCH_DISCOUNT = 0.5;  // 50% latency discount for batching

/** Average object size estimates */
const AVG_OBJECT_BYTES = 1024; // 1KB avg per row/page object
const AVG_ROW_BYTES = 256;     // 256B per row

export class WalrusCostEstimator {
  constructor(private readonly config: QueryCostConfig) {}

  /**
   * Estimate the cost of a SELECT query.
   *
   * @param query SQL query string
   * @param queryType Classification of the query
   * @param tableRowCount Estimated row count per table involved
   * @param pageCount Number of pages (objects) for the target table
   * @param hasIndex Whether an applicable index exists
   */
  estimateSelect(
    query: string,
    queryType: QueryType,
    tableRowCount: number,
    pageCount: number,
    hasIndex: boolean,
  ): QueryCostEstimate {
    const upperQuery = query.toUpperCase();

    // Objects to read depends on query type
    let objectsToRead: number;
    let gasPerOp: number;
    let latencyMultiplier = 1;

    switch (queryType) {
      case "point":
        objectsToRead = 1;
        gasPerOp = GAS_PER_POINT_READ;
        break;
      case "indexed":
        objectsToRead = hasIndex ? Math.ceil(pageCount * 0.1) : Math.ceil(pageCount * 0.3);
        gasPerOp = GAS_PER_INDEXED_LOOKUP;
        break;
      case "range":
        objectsToRead = Math.ceil(pageCount * 0.3);
        gasPerOp = GAS_PER_RANGE_READ;
        break;
      case "join":
        objectsToRead = Math.ceil(pageCount * 1.5);
        gasPerOp = GAS_PER_JOIN;
        break;
      case "aggregate":
        objectsToRead = Math.ceil(pageCount * 0.5);
        gasPerOp = GAS_PER_AGGREGATE;
        break;
      case "subquery":
        objectsToRead = Math.ceil(pageCount * 0.8);
        gasPerOp = GAS_PER_SUBQUERY;
        break;
      case "full_scan":
      default:
        objectsToRead = pageCount;
        gasPerOp = GAS_PER_FULL_SCAN;
        break;
    }

    // Check for DISTINCT, GROUP BY, ORDER BY — adds overhead
    const hasGroupBy = /GROUP\s+BY/i.test(upperQuery);
    const hasOrderBy = /ORDER\s+BY/i.test(upperQuery);
    const hasDistinct = /\bDISTINCT\b/i.test(upperQuery);

    if (hasGroupBy) { gasPerOp *= 1.3; latencyMultiplier *= 1.2; }
    if (hasOrderBy) { gasPerOp *= 1.2; latencyMultiplier *= 1.1; }
    if (hasDistinct) { gasPerOp *= 1.4; latencyMultiplier *= 1.3; }

    // Preference-based adjustments
    if (this.config.preference === "realtime") {
      // Realtime preference: prefer fewer objects even if higher gas
      objectsToRead = Math.min(objectsToRead, Math.ceil(objectsToRead * 0.7));
      latencyMultiplier *= 0.8;
    } else if (this.config.preference === "cost") {
      // Cost preference: batch reads where possible
      gasPerOp *= 0.85;
      latencyMultiplier *= 1.2;
    }

    const estimatedGas = Math.ceil(objectsToRead * gasPerOp);
    const estimatedLatencyMs = Math.ceil(
      objectsToRead * LATENCY_PER_OBJECT_READ + LATENCY_RPC_OVERHEAD * latencyMultiplier,
    );
    const bytesToDownload = objectsToRead * AVG_OBJECT_BYTES;
    const estimatedGasCostUSD = this.gasToUSD(estimatedGas);

    const costScore = this.computeCostScore(estimatedGas, estimatedLatencyMs, objectsToRead);

    return {
      estimatedGas,
      estimatedGasCostUSD,
      estimatedLatencyMs,
      objectsToRead,
      bytesToDownload,
      operationsToWrite: 0,
      costScore,
      tags: [
        `query_type:${queryType}`,
        `objects:${objectsToRead}`,
        `pages:${pageCount}`,
        `rows:${tableRowCount}`,
        `index:${hasIndex ? "yes" : "no"}`,
        `group:${hasGroupBy ? "yes" : "no"}`,
        `order:${hasOrderBy ? "yes" : "no"}`,
        `distinct:${hasDistinct ? "yes" : "no"}`,
      ],
      query,
      at: Date.now(),
    };
  }

  /**
   * Estimate the cost of a DML (INSERT/UPDATE/DELETE) query.
   */
  estimateDml(
    query: string,
    operationCount: number,
    batchSize: number,
  ): QueryCostEstimate {
    const upperQuery = query.toUpperCase();
    const isBatch = batchSize > 1;

    let baseGas = operationCount * this.config.gasPerWrite;
    if (isBatch) {
      baseGas = Math.ceil(baseGas * GAS_PER_BATCH_DISCOUNT);
    }

    const estimatedGas = baseGas;
    const estimatedLatencyMs = Math.ceil(
      operationCount * LATENCY_PER_OBJECT_WRITE * (isBatch ? LATENCY_BATCH_DISCOUNT : 1),
    );
    const bytesToDownload = 0; // DML has no read
    const bytesToWrite = batchSize * AVG_ROW_BYTES;
    const estimatedGasCostUSD = this.gasToUSD(estimatedGas);

    const costScore = this.computeCostScore(estimatedGas, estimatedLatencyMs, operationCount);

    return {
      estimatedGas,
      estimatedGasCostUSD,
      estimatedLatencyMs,
      objectsToRead: 0,
      bytesToDownload,
      operationsToWrite: operationCount,
      costScore,
      tags: [
        `dml_type:${upperQuery.split(" ")[0]}`,
        `ops:${operationCount}`,
        `batch:${isBatch}`,
        `bytes_write:${bytesToWrite}`,
      ],
      query,
      at: Date.now(),
    };
  }

  /**
   * Check if a query exceeds the configured cost threshold.
   * Returns the check result with recommended action.
   */
  checkCostThreshold(estimate: QueryCostEstimate): {
    exceeds: boolean;
    action: "throw" | "warn" | "proceed";
    message: string;
  } {
    const exceeds = estimate.costScore > this.config.maxCostScore;
    return {
      exceeds,
      action: exceeds ? this.config.onCostExceeded : "proceed",
      message: exceeds
        ? `Query cost score ${estimate.costScore} exceeds threshold ${this.config.maxCostScore}. ` +
          `Estimated: ${estimate.estimatedGasCostUSD.toFixed(6)} USD, ${estimate.estimatedLatencyMs}ms latency`
        : `Query cost score ${estimate.costScore} within threshold ${this.config.maxCostScore}`,
    };
  }

  /**
   * Compute a normalized cost score 0-100.
   * Higher = more expensive.
   */
  computeCostScore(gas: number, latencyMs: number, objects: number): number {
    // Normalize each component to 0-100
    const gasScore = Math.min(100, (gas / 1000) * 100); // 1000 gas = 10 score
    const latencyScore = Math.min(100, (latencyMs / 5000) * 100); // 5000ms = 10 score
    const objectScore = Math.min(100, (objects / 100) * 100); // 100 objects = 10 score

    // Weighted average based on preference
    let w1: number, w2: number, w3: number;
    if (this.config.preference === "realtime") {
      w1 = 0.3; w2 = 0.5; w3 = 0.2; // heavily latency
    } else if (this.config.preference === "cost") {
      w1 = 0.6; w2 = 0.2; w3 = 0.2; // heavily gas
    } else {
      w1 = 0.4; w2 = 0.4; w3 = 0.2; // balanced
    }

    return Math.min(100, Math.round(gasScore * w1 + latencyScore * w2 + objectScore * w3));
  }

  /** Convert gas units to USD at configured gas price */
  private gasToUSD(gasUnits: number): number {
    return gasUnits * this.config.gasPriceUSD;
  }
}

/** Default cost estimator config */
export const DEFAULT_COST_CONFIG: QueryCostConfig = {
  maxCostScore: 80,
  preference: "balanced",
  gasPriceUSD: 0.001,
  onCostExceeded: "warn",
  gasPerRead: GAS_PER_POINT_READ,
  gasPerWrite: GAS_PER_WRITE,
};
