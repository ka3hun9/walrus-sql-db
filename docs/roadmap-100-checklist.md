# roadmap-100-checklist — Phase 4: SQL-92 核心扩展（Full Scope）

> 原则：不做最小可上线，按全量能力实施与验收。
> 判定：仅当“实现 + 测试 + 文档 + 基准”全部通过，条目才可勾选。
> 继承：阶段三统一验收标准保持不变（DoD 与门禁口径沿用）。

---

## P4-BOOT. 阶段四开工门槛（必须先完成）

- [x] P4-BOOT-001 提前接入 SQL-92 测试套件并跑通最小可执行子集（窗口函数/CTE 优先），形成可复用执行框架与报告路径
- [x] P4-BOOT-002 提前建立 P4 性能基线环境（窗口函数、递归 CTE、动态 SQL），产出首版基准报告并纳入持续跟踪

---

## P4-A. 窗口函数与高级聚合

- [x] P4-WIN-001 语法支持：`OVER (PARTITION BY ... ORDER BY ...)` 窗口定义与绑定
- [x] P4-WIN-002 `ROW_NUMBER()` 执行语义（分区内稳定排序与编号）
- [x] P4-WIN-003 `RANK()` / `DENSE_RANK()` 并列语义与空洞排名一致性
- [x] P4-WIN-004 `LAG()` / `LEAD()` 偏移、默认值、边界行行为
- [x] P4-WIN-005 窗口帧基础能力（`ROWS BETWEEN ...` 最小闭集）
- [x] P4-AGG-001 聚合 `FILTER (WHERE ...)` 子句
- [x] P4-AGG-002 `CASE WHEN` 在聚合表达式中的类型/NULL/短路语义
- [x] P4-AGG-003 窗口函数与聚合、排序、分页的组合兼容性

## P4-B. 公共表表达式（CTE）与递归查询

- [x] P4-CTE-001 `WITH` 基础能力（多 CTE、作用域、引用顺序）
- [x] P4-CTE-002 CTE 与主查询/子查询/视图展开的绑定一致性
- [x] P4-RCTE-001 `WITH RECURSIVE` 语法与执行骨架
- [x] P4-RCTE-002 递归锚点/递归步语义校验（列数、类型对齐）
- [x] P4-RCTE-003 递归终止条件与最大深度保护（防死循环）
- [x] P4-RCTE-004 层次化查询样例（树/路径）与结果稳定性
- [x] P4-RCTE-005 递归执行可观测性（迭代次数、行数、耗时）

## P4-C. 游标与动态 SQL

- [x] P4-CUR-001 游标语法：`DECLARE CURSOR` / `OPEN` / `FETCH` / `CLOSE`
- [x] P4-CUR-002 游标状态机（未打开/已打开/EOF/关闭后行为）
- [x] P4-CUR-003 `FETCH` 逐行读取一致性与错误码规范化
- [x] P4-DYN-001 `PREPARE` 预编译语义（参数占位与类型约束）
- [x] P4-DYN-002 `EXECUTE` 执行绑定（位置参数、NULL、类型转换）
- [x] P4-DYN-003 动态 SQL 与事务/权限/对象生命周期交互一致性
- [x] P4-DYN-004 动态 SQL 错误分层与注入边界防护（最小安全基线）

## P4-D. information_schema 与系统表

- [x] P4-INFO-001 `information_schema.tables`（schema/table/type/owner 基础字段）
- [x] P4-INFO-002 `information_schema.columns`（列类型、nullable、default）
- [x] P4-INFO-003 约束与索引元数据视图（最小 SQL-92 兼容集合）
- [x] P4-INFO-004 元数据与 DDL 变更实时一致性（CREATE/ALTER/DROP 后可见）
- [x] P4-INFO-005 系统视图查询性能基线与稳定性

## P4-E. 安全与权限

- [x] P4-SEC-001 `GRANT` / `REVOKE` 语法与权限模型（表/视图/模式最小集）
- [x] P4-SEC-002 用户与角色基础管理（若 SDK 面向多用户）
- [x] P4-SEC-003 权限校验链路接入（解析->计划->执行）
- [x] P4-SEC-004 权限元数据可查询与审计日志基础
- [x] P4-SEC-005 权限回归矩阵（越权/误拒绝/继承冲突）

## P4-F. 测试体系（SQL-92 核心一致性专项）

- [x] P4-TEST-001 单测：窗口函数语义矩阵（排序/并列/NULL/边界）
- [x] P4-TEST-002 单测：`FILTER` + `CASE` 聚合语义矩阵
- [x] P4-TEST-003 集成：CTE（多层引用、作用域、重名冲突）
- [x] P4-TEST-004 集成：递归 CTE（层次查询、终止条件、深度上限）
- [x] P4-TEST-005 集成：游标生命周期与逐行处理
- [x] P4-TEST-006 集成：PREPARE/EXECUTE 动态 SQL 参数绑定与错误码
- [x] P4-TEST-007 集成：information_schema 元数据一致性回归
- [x] P4-TEST-008 回归：新能力与既有 P1/P2/P3 语义兼容
- [ ] P4-TEST-009 标准套件：SQL-92 核心一致性测试接入与报告归档（boot套件已就绪）

## P4-G. 基准与里程碑验收

- [ ] P4-BENCH-001 窗口函数典型查询性能基线（吞吐/延迟/P95）
- [ ] P4-BENCH-002 递归 CTE 层级增长压力测试（深度/宽度/资源占用）
- [ ] P4-BENCH-003 动态 SQL 执行开销对照（prepare 命中收益）
- [ ] P4-BENCH-004 information_schema 查询稳定性与开销报告
- [ ] P4-MILE-001 窗口函数与高级聚合验收通过
- [ ] P4-MILE-002 CTE / 递归 CTE 验收通过
- [ ] P4-MILE-003 游标与动态 SQL 验收通过
- [ ] P4-MILE-004 information_schema 验收通过
- [ ] P4-MILE-005（可选）权限模型验收通过
- [ ] P4-MILE-006 SQL-92 核心一致性测试通过（标准套件）
- [ ] P4-MILE-007 功能覆盖率 ≥ 90%
- [ ] P4-MILE-008 全测试管线绿灯（build/unit/integration/regression/bench）
- [ ] P4-MILE-009 文档、示例、运维手册同步

---

## Phase 4 DoD（统一验收标准，沿用阶段三）

任一条目打勾前必须同时满足：
1. 代码实现完成并通过评审；
2. 关联自动化测试新增且通过；
3. `npm run build`（强制先清空 `dist/`）与相关测试全绿；
4. 文档同步（语义、限制、错误码、操作手册）；
5. 无未解释回归。

## Phase 4 Gate（口径不变）

- PR：`maxFailed = 0`、`maxMismatchRatio = 0`、`maxXpass = 0`
- Nightly：`maxMismatchRatio <= 0.02`、`maxXpass = 0`
