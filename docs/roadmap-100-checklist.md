# roadmap-100-checklist — Phase 2: 事务与数据一致性（Full Scope）

> 原则：不做最小可上线，按全量能力实施与验收。
> 判定：仅当“实现 + 测试 + 文档 + 基准”全部通过，条目才可勾选。
> 推进方式：一项完成立刻做下一项，单会话连续推进。

---

## P2-A. 事务模型（BEGIN / COMMIT / ROLLBACK）

- [x] P2-TXN-001 语法支持：BEGIN / COMMIT / ROLLBACK（含嵌套事务策略声明）
- [x] P2-TXN-002 会话级事务上下文（状态机：idle/active/committing/aborted）
- [x] P2-TXN-003 事务内写集暂存（insert/update/delete）
- [x] P2-TXN-004 原子提交：事务变更整体成功或整体失败
- [x] P2-TXN-005 回滚语义：显式回滚与异常自动回滚一致
- [x] P2-TXN-006 DDL in TX 策略（允许/禁止/延迟生效）与一致实现

## P2-B. 日志与提交路径（WAL/事务日志 + 批量上链）

- [x] P2-LOG-001 事务日志结构定义（txnId, writeSet, pre/post image, checksum）
- [x] P2-LOG-002 写前日志（WAL）落盘/持久化策略与恢复入口
- [x] P2-LOG-003 提交批处理器：将事务变更聚合成一次链上写入
- [x] P2-LOG-004 失败补偿：提交中断可重放/可回滚/幂等重试
- [x] P2-LOG-005 日志截断与归档策略（checkpoint + retention）

## P2-C. 隔离级别与并发控制（至少 READ COMMITTED）

- [x] P2-ISO-001 READ COMMITTED 读视图定义并实现
- [x] P2-ISO-002 行级锁管理器（S/X 锁）或 OCC 版本冲突检测器
- [x] P2-ISO-003 死锁检测/超时机制（wait-for graph 或 timeout）
- [x] P2-ISO-004 脏读禁止验证（跨会话并发回归）
- [x] P2-ISO-005 不可重复读行为与文档（RC 允许）
- [x] P2-ISO-006 并发写冲突检测与标准化错误码

## P2-D. 持久性与一致性（Walrus 版本化特性）

- [x] P2-DUR-001 提交生成新版本存储对象（immutable object）
- [x] P2-DUR-002 版本链元数据（prevVersion/currentVersion/commitDigest）
- [x] P2-DUR-003 崩溃恢复：基于 WAL + version chain 恢复到一致状态
- [x] P2-DUR-004 读路径支持按“最新已提交版本”可重复解析
- [x] P2-DUR-005 链上确认延迟场景的一致读策略（pending/confirmed）

## P2-E. 外键约束（FK）

- [x] P2-FK-001 SQL 解析：FOREIGN KEY（列级/表级）
- [x] P2-FK-002 catalog 元数据：引用表/列、匹配规则、删除更新动作
- [x] P2-FK-003 INSERT/UPDATE 引用完整性检查（事务内可见性正确）
- [x] P2-FK-004 ON DELETE CASCADE 实现
- [x] P2-FK-005 ON DELETE RESTRICT/NO ACTION 实现
- [x] P2-FK-006 ON UPDATE CASCADE/RESTRICT 策略实现
- [x] P2-FK-007 FK 环与级联深度保护（防止无限级联）

## P2-F. 执行器与存储联动

- [x] P2-EXE-001 执行计划接入事务上下文（读已提交 + 本事务写）
- [x] P2-EXE-002 索引/约束检查在事务提交点二次验证
- [x] P2-EXE-003 批量提交与回放路径统一（线上/恢复同逻辑）
- [x] P2-EXE-004 事务统计与可观测（txn latency, lock wait, abort ratio）

## P2-G. 测试体系（事务与一致性专项）

- [x] P2-TEST-001 单测：事务状态机、WAL 编解码、冲突检测
- [x] P2-TEST-002 并发集成：多会话 RC 语义（脏读/写冲突/回滚可见性）
- [x] P2-TEST-003 恢复测试：崩溃注入后 WAL 恢复一致性
- [x] P2-TEST-004 FK 回归：级联删除/限制策略/循环引用保护
- [x] P2-TEST-005 链上延迟注入：pending 与 confirmed 读策略一致性
- [x] P2-TEST-006 sqllogic 扩展：事务/FK fixture 套件

## P2-H. 基准与里程碑验收

- [x] P2-BENCH-001 TPC-C 类最小工作负载实现（仓库本地可重复运行）
- [ ] P2-BENCH-002 含事务冲突场景的吞吐/延迟基线报告
- [ ] P2-BENCH-003 长跑稳定性（N 小时无一致性错误）
- [ ] P2-MILE-001 事务 ACID 验收通过（含异常与恢复）
- [ ] P2-MILE-002 FK 全路径验收通过（含 CASCADE）
- [ ] P2-MILE-003 Walrus 链上版本一致性验收通过
- [ ] P2-MILE-004 TPC-C 类基准可运行且数据一致性通过
- [ ] P2-MILE-005 全测试管线绿灯（build/unit/integration/regression/bench）
- [ ] P2-MILE-006 文档、示例、运维手册同步

---

## Phase 2 DoD（统一验收标准）

任一条目打勾前必须同时满足：
1. 代码实现完成并通过评审；
2. 关联自动化测试新增且通过；
3. `npm run build` 与相关测试全绿；
4. 文档同步（语义、限制、错误码、操作手册）；
5. 无未解释回归。
