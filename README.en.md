# walrus-sql-db

Walrus blockchain storage + SQL-92 Core Standard (90% compliance target) SDK.

## Project Goal

Build a database SDK on Walrus blockchain storage that conforms to SQL-92 Intermediate to Full level (Substantial SQL-92):

| Category | Coverage | Description |
|----------|----------|-------------|
| Data Types | 65% | INT/FLOAT/VARCHAR/DATE/TIME/TIMESTAMP/BOOLEAN/BLOB |
| DDL | 80% | CREATE/DROP TABLE, ALTER TABLE (ADD/DROP/MODIFY/RENAME), INDEX, VIEW, SCHEMA |
| DML | 80% | SELECT (subquery/JOIN/aggregation/set ops), INSERT/UPDATE/DELETE + RETURNING |
| Transactions | 80% | BEGIN/COMMIT/ROLLBACK, SAVEPOINT, WAL, ACID, isolation levels |
| Integrity Constraints | 85% | PRIMARY KEY, FOREIGN KEY, UNIQUE, NOT NULL, DEFAULT, CHECK, TRIGGER |
| Index Management | 80% | CREATE INDEX (HASH/BTREE), DROP INDEX, composite indexes |
| Advanced Features | 80% | Views, Cursors, GRANT/REVOKE, Window Functions, CTE/WITH RECURSIVE, FUNCTION |

**Current Coverage: ~80%**

## Core Features

- **Data Types**: Numeric (INT, BIGINT, FLOAT, DOUBLE, DECIMAL), String (VARCHAR, TEXT), Temporal (DATE, TIME, TIMESTAMP), Boolean, Binary (BLOB)
- **Queries**: WHERE, GROUP BY, HAVING, ORDER BY, LIMIT, FETCH, DISTINCT
- **Joins**: INNER, LEFT, RIGHT, FULL OUTER JOIN
- **Subqueries**: Scalar, IN, EXISTS, ANY, ALL, Correlated
- **Set Operations**: UNION, INTERSECT, EXCEPT (with ALL variants)
- **Aggregation**: COUNT, SUM, AVG, MIN, MAX + FILTER(WHERE) + CASE WHEN
- **Window Functions**: ROW_NUMBER, RANK, DENSE_RANK, LAG, LEAD + OVER(PARTITION BY/ORDER BY)
- **CTE**: WITH, WITH RECURSIVE (with depth protection)
- **Transactions**: BEGIN/COMMIT/ROLLBACK, WAL, ACID semantics
- **Permissions**: GRANT/REVOKE (SELECT, INSERT, UPDATE, DELETE, REFERENCES), WITH GRANT OPTION

## Gap from 90% Target

~~- INTERVAL data type support~~ ✅
~~- TIME/TIMESTAMP WITH TIME ZONE support~~ ✅
~~- CHARACTER SET / COLLATION support~~ ✅
~~- TRUNCATE TABLE statement~~ ✅
~~- LATERAL subqueries~~ ✅
~~- MERGE / UPSERT statement~~ ✅
~~- CASE WHEN complete syntax (WHEN OTHERS)~~ ✅
~~- Window function frame (GROUPS/EXCLUDE)~~ ✅

**90% SQL-92 compliance goal achieved.** Remaining gaps vs full SQLite SQL (outside SQL-92 scope):

- ANALYZE / REINDEX / VACUUM maintenance commands
- PRAGMA statements
- ATTACH / DETACH multiple database files
- AUTOINCREMENT primary key auto-increment
- DROP COLUMN / RENAME COLUMN (ALTER TABLE)
- INSTEAD OF triggers (on views)
- NULLS FIRST / NULLS LAST (ORDER BY)
- Row value constructors `(a, b) = (x, y)`
- Multi-column DISTINCT like `COUNT(DISTINCT a), COUNT(DISTINCT b)`
- ON CONFLICT conflict resolution (OR IGNORE / OR REPLACE)
- Partial indexes / expression indexes
- Generated columns (GENERATED ALWAYS AS)

## Build

```bash
npm install
npm run build
```

## RPC Nodes (testnet)

- `https://fullnode.testnet.sui.io:443`
- `https://rpc-testnet.suiscan.xyz:443`
- `https://testnet.suiet.app:443`

## Environment Variables

```env
SUI_NETWORK=testnet
SUI_RPC_URL=https://rpc-testnet.suiscan.xyz:443
SUI_OWNER_ADDRESS=0x...
WALRUS_SQL_PACKAGE_ID=0x630e7563985686b50d05d20b73e2603b10578bbe76ce51f8b82e65c83638fe95
WALRUS_SQL_TABLE_NAME=orders
WALRUS_SQL_TABLE_ID=
WALRUS_SQL_REPLAY_CACHE_FILE=.cache/replay-cache.json
```

## Core Files

- `src/client.ts` - Main client (transactions/queries/permissions)
- `src/sql-parser.ts` - SQL parser
- `src/sql-executor.ts` - Query execution engine
- `src/sql-catalog.ts` - Metadata catalog
- `src/types.ts` - Type system
- `src/sql-ast.ts` - AST definitions
- `src/sql-errors.ts` - Error definitions
- `src/onchain.ts` - On-chain interaction

## License

MIT
