# P3-VIEW-004 视图依赖分析与失效检测（底表/列变更）

## Scope

- `CREATE VIEW` 时新增依赖分析并写入 `view catalog`：
  - 依赖源对象（表/视图）`source`
  - 依赖列集合 `columns`（含 `*` 通配依赖）
- `ViewCatalogEntry.status` 从 `ACTIVE` 扩展为：
  - `ACTIVE`
  - `INVALID`
- `ViewCatalogEntry` 新增：
  - `dependencies`
  - `invalidReason`
  - `invalidatedAt`

## Invalidation Rules

- `DROP TABLE <base>`：
  - 直接依赖该底表的视图标记为 `INVALID`
  - 依赖这些视图的上游视图也会传递失效
- `ALTER TABLE <base> DROP COLUMN <col>`：
  - 依赖 `<base>.<col>` 或 `<base>.*` 的视图标记为 `INVALID`
  - 失效状态向依赖链上游传递

## Runtime Detection

- 对失效视图执行 `SELECT` 会被拒绝，并返回：
  - `ERR_UNSUPPORTED_SELECT: view is invalid: <VIEW_NAME> (...)`

## Regression Coverage

- `test/unit-p3-view-004-view-dependency-invalidation.ts`
  - 依赖元数据写入与读取
  - 列删除失效（含链式视图传递）
  - 底表删除失效（含链式视图传递）
  - 非依赖列删除不应误伤视图
