# Walrus SQL DB - 100% Full Compliance Checklist (v2)

> 目标：**100% 全量达标**（严格对齐 SQL-92 类型体系 + 解析/执行/存储一致性 + 完整 DDL/DML 能力 + 测试与工程化闭环）
>
> 判定规则：仅当 **实现完成 + 自动化测试全绿 + 回归通过 + 文档同步** 时，才可打勾。
>
> 基线要求：不得以“部分支持/兼容模式”替代 checklist 项目验收。

---

## A. 类型系统（SQL-92 全量）

- [x] A-TYPE-001 运行时类型系统从简化枚举升级为全量 SQL 类型能力模型（含元信息）
- [x] A-TYPE-002 SMALLINT：范围校验、转换、边界测试
- [x] A-TYPE-003 INT：范围校验、转换、边界测试
- [x] A-TYPE-004 BIGINT：大整数精度保持与边界校验
- [x] A-TYPE-005 DECIMAL(p,s)：精度/小数位约束、四舍五入/拒绝策略明确
- [x] A-TYPE-006 FLOAT：解析、精度行为与比较规则文档化
- [x] A-TYPE-007 DOUBLE：解析、精度行为与比较规则文档化
- [x] A-TYPE-008 CHAR(n)：定长填充/截断策略与一致性测试
- [x] A-TYPE-009 VARCHAR(n)：长度约束与边界测试
- [x] A-TYPE-010 DATE：格式与有效日期校验
- [x] A-TYPE-011 TIME：格式与有效时间校验
- [x] A-TYPE-012 TIMESTAMP：格式/时区策略/序列化一致性
- [x] A-TYPE-013 BOOLEAN：字面量与隐式转换边界
- [x] A-TYPE-014 BLOB：二进制编码/解码与存储一致性
- [x] A-TYPE-015 NULL 语义统一（比较/谓词/聚合/排序中的行为）
- [x] A-TYPE-016 CAST/隐式转换矩阵（类型对类型）与冲突策略
- [x] A-TYPE-017 解析层、表达式层、存储层类型表示完全一致

## B. 解析器能力（SELECT/表达式全量）

- [x] B-PARSE-001 SELECT 语法基线补齐（字段、别名、表达式）
- [x] B-PARSE-002 FROM 表别名（含 AS/省略 AS）
- [x] B-PARSE-003 JOIN：INNER/LEFT/RIGHT/FULL OUTER 解析正确
- [x] B-PARSE-004 WHERE：AND/OR/NOT 优先级与括号嵌套
- [x] B-PARSE-005 谓词 BETWEEN / NOT BETWEEN
- [x] B-PARSE-006 谓词 LIKE / NOT LIKE（含 ESCAPE）
- [x] B-PARSE-007 谓词 IN / NOT IN（值列表）
- [x] B-PARSE-008 谓词 IN / NOT IN（子查询）
- [x] B-PARSE-009 EXISTS / NOT EXISTS（相关/非相关）
- [x] B-PARSE-010 子查询比较（=, <>, >, >=, <, <= 与标量子查询）
- [x] B-PARSE-011 GROUP BY（单列/多列/表达式）
- [x] B-PARSE-012 HAVING（聚合与非聚合约束）
- [x] B-PARSE-013 聚合函数 COUNT/SUM/AVG/MIN/MAX 语法覆盖
- [x] B-PARSE-014 ORDER BY（多键、ASC/DESC、别名/表达式）
- [x] B-PARSE-015 LIMIT/OFFSET（含顺序约束与错误提示）

## C. 执行器能力（查询语义）

- [x] C-EXEC-001 FULL OUTER JOIN 语义执行正确（含空值补齐）
- [x] C-EXEC-002 谓词 BETWEEN / LIKE / IN / EXISTS 执行语义全量一致
- [x] C-EXEC-003 标量子查询执行（单行单列约束与错误处理）
- [x] C-EXEC-004 相关子查询执行（外层引用绑定正确）
- [x] C-EXEC-005 GROUP BY + HAVING 与聚合组合场景全覆盖
- [x] C-EXEC-006 ORDER BY + LIMIT/OFFSET 在复杂查询中的稳定行为
- [x] C-EXEC-007 NULL 三值逻辑在过滤/连接/聚合中的一致实现

## D. DML 全量能力（UPDATE/DELETE 复杂条件与子查询）

- [x] D-DML-001 UPDATE 支持复杂 WHERE（含 BETWEEN/LIKE/IN/EXISTS）
- [x] D-DML-002 UPDATE 支持子查询条件（标量/IN/EXISTS）
- [x] D-DML-003 UPDATE 支持 JOIN 变体（INNER/LEFT/RIGHT/FULL OUTER）
- [x] D-DML-004 DELETE 支持复杂 WHERE（含 BETWEEN/LIKE/IN/EXISTS）
- [x] D-DML-005 DELETE 支持子查询条件（标量/IN/EXISTS）
- [x] D-DML-006 DELETE 支持 JOIN 变体（INNER/LEFT/RIGHT/FULL OUTER）
- [x] D-DML-007 DML 在约束检查前后次序明确且可重复验证

## E. DDL 与 schema 变更

- [x] E-DDL-001 DROP TABLE 完整语义（不存在表/依赖场景错误）
- [x] E-DDL-002 ALTER TABLE ADD COLUMN（默认值/NOT NULL 冲突处理）
- [x] E-DDL-003 ALTER TABLE DROP COLUMN（主键/唯一索引依赖校验）
- [x] E-DDL-004 DDL 后 schema 缓存/索引/元数据一致性

## F. 约束与错误系统

- [x] F-CONST-001 PRIMARY KEY 自动索引创建与维护（增删改一致）
- [x] F-CONST-002 UNIQUE 约束冲突检测（单列/组合）
- [x] F-CONST-003 NOT NULL 约束在 DDL/DML 全路径生效
- [x] F-CONST-004 约束错误码体系统一（可机器解析）
- [x] F-CONST-005 解析错误/语义错误/执行错误分层且稳定
- [x] F-CONST-006 错误信息包含定位上下文（token/子句/字段）

## G. 存储层与一致性

- [x] G-STOR-001 类型值序列化/反序列化与精度无损策略
- [x] G-STOR-002 增量写入（Incremental write）稳定可回放
- [x] G-STOR-003 MessagePack/CBOR 存储格式切换一致性
- [x] G-STOR-004 read-after-write 一致性回归（高并发模拟）
- [x] G-STOR-005 WAL/重试/退避策略在失败注入下通过

## H. 测试体系（100% 验收门）

- [x] H-TEST-001 全量类型单测（正例/反例/边界）
- [x] H-TEST-002 解析器语法矩阵测试（子句组合笛卡尔覆盖）
- [x] H-TEST-003 执行器语义测试（对照基准引擎）
- [x] H-TEST-004 DDL/DML 复杂场景回归集（含子查询与 JOIN）
- [x] H-TEST-005 sqllogic 扩展集（阶段二新增语法）
- [x] H-TEST-006 性能基准（冷/热查询、写入吞吐）
- [x] H-TEST-007 CI 自动化：build + unit + integration + regression + benchmark gate
- [x] H-TEST-008 失败注入测试（网络/存储/超时/重试）

## I. 工程化与可运维

- [x] I-ENG-001 日志级别可配置并覆盖关键路径
- [x] I-ENG-002 配置管理（默认值、校验、环境覆盖）
- [x] I-ENG-003 模块边界文档与依赖图更新
- [x] I-ENG-004 发布前兼容性清单（向后兼容声明）

## J. 最终里程碑验收（全部必须通过）

- [x] J-MILE-001 复杂多表连接 + 分组聚合 + 排序分页查询验收通过
- [x] J-MILE-002 含子查询/复杂条件的 UPDATE/DELETE 验收通过
- [x] J-MILE-003 表结构变更（DROP/ALTER）全路径验收通过
- [x] J-MILE-004 类型系统全量 SQL-92 验收报告通过
- [x] J-MILE-005 约束与错误系统验收报告通过
- [x] J-MILE-006 全测试管线绿灯（本地+CI）
- [x] J-MILE-007 文档、示例、回归快照全部同步

## K. Collation + Charset 全量能力（新增，100%达标门）

### K1. 类型与元数据模型
- [ ] K-TYPE-001 Runtime type metadata 增加 collation/charset 字段并统一序列化
- [ ] K-TYPE-002 默认字符集与默认排序规则（database/schema/table/column 继承链）
- [ ] K-TYPE-003 CHAR/VARCHAR/TEXT 在 charset 与 length 交互规则下行为确定（字符长度 vs 字节长度策略）
- [ ] K-TYPE-004 非字符类型显式禁止 COLLATE/CHARSET 并返回标准化错误码

### K2. DDL 语法与 catalog 持久化
- [ ] K-DDL-001 CREATE TABLE 列级 `CHARACTER SET` / `COLLATE` 语法支持
- [ ] K-DDL-002 CREATE TABLE 表级默认 `CHARACTER SET` / `COLLATE` 语法支持
- [ ] K-DDL-003 ALTER TABLE 修改列/表 charset 与 collation（含兼容性校验）
- [ ] K-DDL-004 SHOW/DESCRIBE/系统元数据查询可见 charset/collation
- [ ] K-DDL-005 DDL 回放与增量存储中 charset/collation 元数据一致性

### K3. 解析器与 AST
- [ ] K-PARSE-001 SELECT 表达式级 `... COLLATE <name>` 解析与 AST 表达
- [ ] K-PARSE-002 ORDER BY 中 COLLATE 子句解析（列、别名、表达式）
- [ ] K-PARSE-003 WHERE/ON/HAVING 中字符串比较 COLLATE 覆盖解析
- [ ] K-PARSE-004 CAST/函数参数与 COLLATE 组合语法稳定
- [ ] K-PARSE-005 错误子句顺序与非法 collation token 的语法错误上下文

### K4. 比较/排序/分组语义执行
- [ ] K-EXEC-001 字符串比较语义接入 collation（=, <>, <, <=, >, >=）
- [ ] K-EXEC-002 ORDER BY 在不同 collation 下稳定且可重复
- [ ] K-EXEC-003 GROUP BY 分组键在不同 collation 下一致
- [ ] K-EXEC-004 DISTINCT/UNION 去重受 collation 控制并可预测
- [ ] K-EXEC-005 JOIN 键为字符串时按 collation 比较（INNER/LEFT/RIGHT/FULL）
- [ ] K-EXEC-006 LIKE/IN/EXISTS 与 collation 交互语义明确并实现

### K5. 约束与索引一致性
- [ ] K-CONST-001 UNIQUE/PRIMARY KEY 字符串键按 collation 进行冲突判定
- [ ] K-CONST-002 索引键规范化（normalization key）与比较语义一致
- [ ] K-CONST-003 复合键中混合 charset/collation 的冲突与拒绝策略
- [ ] K-CONST-004 约束错误信息输出具体 charset/collation 上下文

### K6. Charset 转换与写入策略
- [ ] K-CHARSET-001 写入时字符集合法性校验（非法码点/不可编码字符）
- [ ] K-CHARSET-002 跨 charset 转换策略（strict reject / explicit convert）
- [ ] K-CHARSET-003 隐式转换边界：字符列与数值/时间类型互转中的 charset 保留规则
- [ ] K-CHARSET-004 BLOB 与 TEXT 边界（binary vs charset text）规则与错误码

### K7. 配置与运维
- [ ] K-ENG-001 配置项：默认 charset/collation、可选白名单、严格模式开关
- [ ] K-ENG-002 日志与可观测：记录 collation 分支选择与 charset 转换失败原因
- [ ] K-ENG-003 兼容策略：老表无 charset/collation 元数据的迁移与默认回填

### K8. 测试与验收门
- [ ] K-TEST-001 单测：不同 collation 下比较、排序、分组、去重矩阵
- [ ] K-TEST-002 单测：charset 编码合法性、转换失败、边界字符集案例
- [ ] K-TEST-003 集成：DDL→DML→查询→回放全链路 charset/collation 一致性
- [ ] K-TEST-004 回归：JOIN/子查询/聚合/ORDER BY 与 collation 交互回归
- [ ] K-TEST-005 sqllogic 扩展：collation/charset fixture 套件
- [ ] K-TEST-006 性能基线：启用 collation 后排序/比较回归不超阈值
- [ ] K-TEST-007 文档与示例同步（含限制、默认行为、迁移指南）

### K9. 最终验收里程碑（新增）
- [ ] K-MILE-001 字符串语义（比较/排序/分组/去重/约束）在多 collation 下验收通过
- [ ] K-MILE-002 charset 合法性与转换策略验收通过
- [ ] K-MILE-003 老数据迁移与向后兼容验收通过
- [ ] K-MILE-004 全测试管线绿灯（含新增 K-TEST 套件）
- [ ] K-MILE-005 文档、示例、回归快照全部同步

---

## 验收标准（Definition of Done）

任一条目勾选前必须同时满足：
1. 实现代码完成并通过 code review；
2. 关联测试用例新增并通过；
3. `npm run build` 与相关测试命令全绿；
4. 文档（能力说明/限制/错误码）已同步；
5. 不引入未解释的回归。
