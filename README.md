# walrus-sql-db

Walrus 链上存储 + SQL-92 核心标准（目标 90% 合规）SDK。

## 项目目标

基于 Walrus 区块链存储层，实现符合 SQL-92 中级到完全级别（Substantial SQL-92）的数据库 SDK，覆盖：

| 类别 | 覆盖率 | 说明 |
|------|--------|------|
| 数据类型 | 65% | INT/FLOAT/VARCHAR/DATE/TIME/TIMESTAMP/BOOLEAN/BLOB 等 |
| DDL | 80% | CREATE/DROP TABLE, ALTER TABLE (ADD/DROP/MODIFY/RENAME), INDEX, VIEW, SCHEMA |
| DML | 80% | SELECT (子查询/JOIN/聚合/集合操作), INSERT/UPDATE/DELETE + RETURNING |
| 事务 | 80% | BEGIN/COMMIT/ROLLBACK, SAVEPOINT, WAL, ACID, 隔离级别 |
| 完整性约束 | 85% | PRIMARY KEY, FOREIGN KEY, UNIQUE, NOT NULL, DEFAULT, CHECK, TRIGGER |
| 索引管理 | 80% | CREATE INDEX (HASH/BTREE), DROP INDEX, 复合索引 |
| 高级特性 | 80% | 视图, 游标, GRANT/REVOKE, 窗口函数, CTE/WITH RECURSIVE, FUNCTION |

**当前覆盖率：~80%**

## 核心特性

- **数据类型**: 数值 (INT, BIGINT, FLOAT, DOUBLE, DECIMAL), 字符串 (VARCHAR, TEXT), 时间 (DATE, TIME, TIMESTAMP), 布尔, 二进制 (BLOB)
- **查询**: WHERE, GROUP BY, HAVING, ORDER BY, LIMIT, FETCH, DISTINCT
- **连接**: INNER, LEFT, RIGHT, FULL OUTER JOIN
- **子查询**: 标量, IN, EXISTS, ANY, ALL, 相关子查询
- **集合操作**: UNION, INTERSECT, EXCEPT (含 ALL 变体)
- **聚合**: COUNT, SUM, AVG, MIN, MAX + FILTER(WHERE) + CASE WHEN
- **窗口函数**: ROW_NUMBER, RANK, DENSE_RANK, LAG, LEAD + OVER(PARTITION BY/ORDER BY)
- **CTE**: WITH, WITH RECURSIVE (递归深度保护)
- **事务**: BEGIN/COMMIT/ROLLBACK, WAL 写前日志, ACID 语义
- **权限**: GRANT/REVOKE (SELECT, INSERT, UPDATE, DELETE, REFERENCES), WITH GRANT OPTION

## 与目标差距 (距 90%)

~~- INTERVAL 数据类型支持~~ ✅
~~- TIME/TIMESTAMP WITH TIME ZONE 支持~~ ✅
~~- CHARACTER SET / COLLATION 支持~~ ✅
~~- TRUNCATE TABLE 语句~~ ✅
~~- 行列子查询 (LATERAL)~~ ✅
~~- MERGE / UPSERT 语句~~ ✅
~~- CASE WHEN 完整语法 (WHEN OTHERS)~~ ✅
~~- 窗口函数帧 (GROUPS/EXCLUDE)~~ ✅

**90% SQL-92 合规目标达成。** 以下为与完整 SQLite SQL 的剩余差距（SQL-92 范围外）：

- ANALYZE / REINDEX / VACUUM 维护命令
- PRAGMA 语句
- ATTACH / DETACH 多数据库文件
- AUTOINCREMENT 主键自动递增
- DROP COLUMN / RENAME COLUMN (ALTER TABLE)
- INSTEAD OF 触发器（视图上）
- NULLS FIRST / NULLS LAST（ORDER BY 排序）
- 行值构造 `(a, b) = (x, y)`
- 多列 DISTINCT 如 `COUNT(DISTINCT a), COUNT(DISTINCT b)`
- ON CONFLICT 冲突解决（OR IGNORE / OR REPLACE）
- 部分索引 / 表达式索引
- 生成列（GENERATED ALWAYS AS）

## 构建

```bash
npm install
npm run build
```

## RPC 节点 (testnet)

- `https://fullnode.testnet.sui.io:443`
- `https://rpc-testnet.suiscan.xyz:443`
- `https://testnet.suiet.app:443`

## 环境变量

```env
SUI_NETWORK=testnet
SUI_RPC_URL=https://rpc-testnet.suiscan.xyz:443
SUI_OWNER_ADDRESS=0x...
WALRUS_SQL_PACKAGE_ID=0x630e7563985686b50d05d20b73e2603b10578bbe76ce51f8b82e65c83638fe95
WALRUS_SQL_TABLE_NAME=orders
WALRUS_SQL_TABLE_ID=
WALRUS_SQL_REPLAY_CACHE_FILE=.cache/replay-cache.json
```

## 核心文件

- `src/client.ts` - 主客户端 (事务/查询/权限)
- `src/sql-parser.ts` - SQL 解析
- `src/sql-executor.ts` - 查询执行引擎
- `src/sql-catalog.ts` - 元数据目录
- `src/types.ts` - 类型系统
- `src/sql-ast.ts` - AST 定义
- `src/sql-errors.ts` - 错误定义
- `src/onchain.ts` - 链上交互

## License

MIT
