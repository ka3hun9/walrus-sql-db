# P3-VIEW-001 `CREATE VIEW` / `DROP VIEW` 语法与 catalog 元数据

## Scope

- Parser:
  - 支持 `CREATE VIEW <name> AS <select-query>`
  - 支持 `DROP VIEW [IF EXISTS] <name>`
  - `CREATE VIEW` 当前要求 `AS` 后是 `SELECT`/`UNION`/`INTERSECT`/`EXCEPT` 语句族
- Runtime (`WalrusSqlClient`, simulator mode):
  - 执行 `CREATE VIEW` 时写入 view catalog
  - 执行 `DROP VIEW` 时删除 view catalog
  - 新增 `getViewCatalog(viewName?)` 读取 catalog 元数据

## Catalog Metadata

`ViewCatalogEntry` 字段：

- `name`: 标准化后的视图名（大写）
- `querySql`: 视图定义 SQL（`AS` 后查询体）
- `status`: 当前为 `ACTIVE`

## Current Boundaries

- 本项只覆盖语法与 catalog 元数据生命周期。
- 对视图执行 `SELECT`、查询重写、依赖分析、权限与命名冲突策略由后续 `P3-VIEW-00x` 项覆盖。
