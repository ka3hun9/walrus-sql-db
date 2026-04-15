# Walrus Storage Architecture

Walrus 去中心化存储专项设计文档。

## 概述

Walrus 作为去中心化存储，与传统磁盘有本质区别，需要特殊设计。本文档描述四个专项优化的实现。

---

## Phase 1: 数据分页与内容寻址版本控制

### 核心概念

**分页存储 (Paged Storage)**

大表数据拆分为多个对象（页），每页最多 `pageSize` 行（默认 500 行），每页独立上传到 Walrus 链。

```
表 orders (10000 行)
├── page_0  (rows 0-499,   objectId: hash(page_0_data))
├── page_1  (rows 500-999,  objectId: hash(page_1_data))
├── page_2  (rows 1000-1499, objectId: hash(page_2_data))
└── ...
```

**内容寻址 (Content-Addressing)**

每个页面的唯一标识符 = `hash(page_content)`。相同内容永远产生相同的 objectId，支持：
- 去重：相同内容不上传两次
- 版本链：`previousPageHash` 字段形成 Git 一样的链

**版本链 (Version Chain)**

```
v1: GENESIS
v2: hash(v1 + page_0_data) → head = "abc123"
v3: hash(v2 + page_1_data) → head = "def456"
```

### API

```typescript
import { buildPagedMoveCall, getTableVersionHistory, buildTablePageManifest } from "walrus-sql-db";

// 构建分页 MoveCall
const req = buildPagedMoveCall({
  packageId: "0x...",
  table: "orders",
  pageIndex: 0,
  rows: [{ id: 1, amount: 100 }, ...],
  operation: "PAGE_INSERT",
});

// 查询版本历史
const history = getTableVersionHistory("orders");
// → { headHash, manifestVersion, pageChain: [...] }
```

### 配置

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `WALRUS_SQL_PAGE_SIZE` | 每页行数 | 500 |

---

## Phase 2: 客户端缓存 + 事务批量写入

### 读缓存增强

已有 LRU 缓存扩展为多表版本隔离：

```typescript
// 配置
{
  readCache: {
    evictionPolicy: "LRU" | "LFU",   // 淘汰策略
    maxMemoryMb: 64,                   // 最大内存占用
    staleWhileRevalidate: true,         // 过期时后台重验证
  }
}
```

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `WALRUS_SQL_CACHE_EVICTION` | LRU/LFU | LRU |
| `WALRUS_SQL_CACHE_MAX_MEMORY_MB` | 最大内存 MB | 64 |
| `WALRUS_SQL_CACHE_STALE_REVALIDATE` | 后台重验证 | false |

### 批量提交 (Batch Commit)

将多个 DML 操作缓存在内存中，达到阈值后一次性提交：

```typescript
import { WalrusBatchCommitter } from "walrus-sql-db";

const batch = new WalrusBatchCommitter(
  { enabled: true, maxDelayMs: 200, maxOperations: 50, maxBatchRows: 5000 },
  async (ops, batchId) => {
    // 所有 ops 打包为一次链上 MoveCall
    const { target, arguments: args } = buildBatchMoveCall(ops, packageId, module);
    return executor({ target, arguments: args });
  },
);

// INSERT 操作自动入队
client.execute("INSERT INTO orders ...");
client.execute("INSERT INTO orders ..."); // 继续积累
// 200ms 后或达到 50 ops 时自动 flush
```

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `WALRUS_SQL_BATCH_ENABLED` | 启用批量 | true |
| `WALRUS_SQL_BATCH_MAX_DELAY_MS` | 最大等待 ms | 200 |
| `WALRUS_SQL_BATCH_MAX_OPERATIONS` | 最大操作数 | 50 |
| `WALRUS_SQL_BATCH_MAX_ROWS` | 最大行数 | 5000 |

---

## Phase 3: 乐观锁并发控制

### 问题

多客户端可能同时修改同一行或同一页，需要检测冲突。

### 解决方案：版本号乐观锁

```typescript
import { OptimisticLockManager, OptimisticConflictError } from "walrus-sql-db";

const lock = new OptimisticLockManager({
  enabled: true,
  strategy: "LAST_WRITE_WINS",  // 或 FIRST_COMMIT_WINS / CLIENT_MERGE
  maxRetries: 3,
  lockTimeoutMs: 5000,
});

// 读操作 — 记录版本
lock.recordRead("orders", "page_0", "v2_abc123");

// 本地修改 — 记录待提交版本
const newVersion = hashHex(newRowContent);
lock.recordPending("orders", "page_0", newVersion);

// 提交前检测冲突
const conflict = lock.detectConflict("orders", "page_0", onchainVersion);
if (conflict) {
  // 根据 strategy 处理:
  // - LAST_WRITE_WINS: 忽略冲突，直接覆盖
  // - FIRST_COMMIT_WINS: 抛出错误
  // - CLIENT_MERGE: 尝试三向合并
}
```

### 冲突解决策略

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| `LAST_WRITE_WINS` | 后写者覆盖 | 简单场景，默认 |
| `FIRST_COMMIT_WINS` | 先提交者胜出 | 数据完整性优先 |
| `CLIENT_MERGE` | SDK 三向合并 | 需要更多逻辑 |

### 三向合并 (CLIENT_MERGE)

```typescript
import { threeWayMerge } from "walrus-sql-db";

const base = { id: 1, status: "pending", amount: 100 };
const local = { id: 1, status: "processing", amount: 100 };  // 本地改 status
const remote = { id: 1, status: "pending", amount: 200 };     // 远程改 amount

const merged = threeWayMerge(base, local, remote);
// → { id: 1, status: "processing", amount: 200 }
// 无冲突，两边修改不同字段，自动合并成功
```

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `WALRUS_SQL_LOCK_STRATEGY` | 冲突策略 | LAST_WRITE_WINS |
| `WALRUS_SQL_LOCK_MAX_RETRIES` | 最大重试 | 3 |
| `WALRUS_SQL_LOCK_TIMEOUT_MS` | 锁超时 ms | 5000 |

---

## Phase 4: 查询成本估算

### 成本模型

每个查询计算 0-100 的 `costScore`：

```
costScore = gasScore × 0.4 + latencyScore × 0.4 + objectScore × 0.2
```

| 指标 | 说明 |
|------|------|
| `estimatedGas` | 预估 gas 单位 |
| `estimatedGasCostUSD` | 预估 USD 成本 |
| `estimatedLatencyMs` | 预估端到端延迟 ms |
| `objectsToRead` | 需读取的 Walrus 对象数 |

### 使用示例

```typescript
import { WalrusCostEstimator } from "walrus-sql-db";

const estimator = new WalrusCostEstimator({
  maxCostScore: 80,
  preference: "balanced", // realtime / cost / balanced
  gasPriceUSD: 0.001,
  onCostExceeded: "warn", // throw / warn / proceed
});

// SELECT 成本估算
const selectCost = estimator.estimateSelect(
  "SELECT * FROM orders WHERE id = 1",
  "point",       // queryType: point/range/full_scan/join/aggregate/subquery
  10000,         // tableRowCount
  20,            // pageCount
  true,          // hasIndex
);

// DML 成本估算
const dmlCost = estimator.estimateDml(
  "INSERT INTO orders ...",
  1,             // operationCount
  10,            // batchSize
);

// 阈值检查
const { exceeds, action, message } = estimator.checkCostThreshold(selectCost);
if (exceeds && action === "throw") {
  throw new Error(`Query too expensive: ${message}`);
}
```

### EXPLAIN 扩展

成本信息集成到 `EXPLAIN` 输出：

```sql
EXPLAIN SELECT * FROM orders WHERE customer_id = 5;
-- 输出增加:
-- cost_score=12, gas_est=150, latency_est=80ms, objects=3, query_type=point
```

### 配置

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `WALRUS_SQL_MAX_COST_SCORE` | 最大成本评分 | 80 |
| `WALRUS_SQL_COST_PREFERENCE` | 偏好: realtime/cost/balanced | balanced |
| `WALRUS_SQL_GAS_PRICE_USD` | 手动 gas 价格 USD | 0.001 |
| `WALRUS_SQL_ON_COST_EXCEEDED` | 超出时: throw/warn/proceed | warn |
| `WALRUS_SQL_GAS_PER_READ` | 每次读取 gas | 10 |
| `WALRUS_SQL_GAS_PER_WRITE` | 每次写入 gas | 50 |

---

## 完整配置示例

```env
# Phase 1: 分页存储
WALRUS_SQL_PAGE_SIZE=500

# Phase 2: 批量提交
WALRUS_SQL_BATCH_ENABLED=true
WALRUS_SQL_BATCH_MAX_DELAY_MS=200
WALRUS_SQL_BATCH_MAX_OPERATIONS=50
WALRUS_SQL_BATCH_MAX_ROWS=5000

# Phase 3: 乐观锁
WALRUS_SQL_LOCK_STRATEGY=LAST_WRITE_WINS
WALRUS_SQL_LOCK_MAX_RETRIES=3
WALRUS_SQL_LOCK_TIMEOUT_MS=5000

# Phase 4: 成本估算
WALRUS_SQL_MAX_COST_SCORE=80
WALRUS_SQL_COST_PREFERENCE=balanced
WALRUS_SQL_GAS_PRICE_USD=0.001
WALRUS_SQL_ON_COST_EXCEEDED=warn

# 读缓存
WALRUS_SQL_CACHE_EVICTION=LRU
WALRUS_SQL_CACHE_MAX_MEMORY_MB=64
WALRUS_SQL_CACHE_STALE_REVALIDATE=false
```

---

## 架构依赖

```
src/walrus-storage.ts     — Phase 1: 分页存储引擎 (核心依赖)
       ↓
src/walrus-batch.ts       — Phase 2: 批量提交 (依赖 storage)
       ↓
src/walrus-optimistic-lock.ts — Phase 3: 乐观锁 (依赖 storage)
       ↓
src/walrus-cost.ts        — Phase 4: 成本估算 (依赖 storage)
       ↓
src/config.ts             — 配置解析 (所有新配置项)
       ↓
src/types.ts              — 类型定义
src/onchain.ts            — 链上交互 (扩展支持分页)
```
