# P3-SET-004 - 集合操作与排序/分页/投影兼容性

## Scope

完成 Phase 3 对集合操作在复合查询尾部排序/分页与投影列对齐行为的兼容性闭环，覆盖 `UNION`、`INTERSECT ALL`、`EXCEPT ALL` 及链式混合集合操作场景。

## What was added

- 新增 Phase 3 单测 `test/unit-p3-set-004-setop-order-page-projection-compat.ts`：
  - 验证集合操作输出列名/列序遵循左分支投影（右分支别名和列序不同仍按位置对齐）
  - 验证复合查询尾部 `ORDER BY` 在集合合并后生效
  - 验证复合查询尾部 `LIMIT/OFFSET` 在集合合并后分页生效
  - 覆盖 `UNION`、`INTERSECT ALL`、`EXCEPT ALL` 与链式混合集合操作（`UNION ALL ... EXCEPT ...`）的兼容路径
- 与既有 `P3-SET-001/002/003` 语义测试形成互补：
  - `001/002/003` 聚焦集合语义与算子正确性
  - `004` 聚焦集合结果与排序/分页/投影兼容性

## Validation

- Build:
  - `npm run build`
- Unit:
  - `npx tsx test/unit-p3-set-004-setop-order-page-projection-compat.ts`
  - `npx tsx test/unit-p3-set-003-except-except-all.ts`
  - `npx tsx test/unit-p3-set-002-intersect-intersect-all.ts`
  - `npx tsx test/unit-p3-set-001-union-union-all.ts`
- Validation log:
  - `reports/p3-set-004-validation.log`
