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

## K. A-TYPE-001 全链路 TypedValue 化补齐计划（阶段一收口）

> 目标：将 A-TYPE-001 从“运行时类型模型完成”升级为“**全链路 TypedValue 强制化**”，满足“所有值操作都经过 TypedValue”的验收口径。
>
> 通过标准：K 组条目全部完成并测试通过后。

### K1. 类型核心与不可变值模型
- [x] K-TVAL-001 定义统一 `TypedValue` 核心结构（type + value + metadata）并冻结不可变语义
- [x] K-TVAL-002 提供统一构造/校验工厂（fromLiteral/fromStorage/fromJs）
- [x] K-TVAL-003 提供统一比较接口（eq/lt/lte/gt/gte）并接入 NULL 3VL
- [ ] K-TVAL-004 提供统一算术/逻辑操作接口（add/sub/mul/div/and/or/not）及类型提升规则

### K2. 解析层接入
- [ ] K-TVAL-005 SQL 字面量在 AST 构建阶段统一产出 TypedValue（不再裸 primitive）
- [ ] K-TVAL-006 参数绑定（含默认值）统一转 TypedValue 并记录来源上下文
- [ ] K-TVAL-007 CAST 与隐式转换在解析/绑定阶段统一走 TypedValue 转换器

### K3. 执行层全链路替换
- [ ] K-TVAL-008 表达式求值器改造：所有中间值/结果值均为 TypedValue
- [ ] K-TVAL-009 谓词执行改造：比较/LIKE/IN/BETWEEN/EXISTS 全部接 TypedValue
- [ ] K-TVAL-010 聚合执行改造：COUNT/SUM/AVG/MIN/MAX 内部态和值均 TypedValue 化
- [ ] K-TVAL-011 JOIN/GROUP/ORDER/DISTINCT 键值规范化全部改为 TypedValue key codec

### K4. DML/DDL/约束链路改造
- [ ] K-TVAL-012 INSERT/UPDATE 写入前校验统一走 TypedValue（禁止旁路校验）
- [ ] K-TVAL-013 NOT NULL/UNIQUE/PRIMARY KEY 冲突检测统一消费 TypedValue
- [ ] K-TVAL-014 DEFAULT 值、ALTER ADD COLUMN 回填值统一走 TypedValue
- [ ] K-TVAL-015 错误信息增强：违反类型/约束时报错携带 TypedValue 上下文快照

### K5. 存储与序列化
- [ ] K-TVAL-016 TypedValue 序列化协议（含版本）定义并落地
- [ ] K-TVAL-017 反序列化与旧格式兼容读取（向后兼容迁移）
- [ ] K-TVAL-018 replay/cache/index 的键和值统一 TypedValue 编解码

### K6. 工程化与可观测
- [ ] K-TVAL-019 日志与调试输出支持 TypedValue 可读格式（含类型标签）
- [ ] K-TVAL-020 性能回归守门：TypedValue 引入后关键查询/写入开销在阈值内
- [ ] K-TVAL-021 Feature flag 迁移开关移除（最终仅保留 TypedValue 路径）

### K7. 测试与验收门
- [ ] K-TVAL-022 单测：TypedValue 构造、比较、算术、转换、NULL/错误路径全覆盖
- [ ] K-TVAL-023 集成：SELECT/JOIN/GROUP/HAVING/ORDER/LIMIT 全链路 TypedValue 回归
- [ ] K-TVAL-024 DML/DDL/约束：写入、更新、冲突检测、默认值回填回归
- [ ] K-TVAL-025 存储：序列化/反序列化/增量回放与缓存一致性回归
- [ ] K-TVAL-026 CI gate：新增 TypedValue 专项测试套件并纳入 `ci:full`

### K8. 最终里程碑（阶段一补齐）
- [ ] K-MILE-001 代码中所有值操作路径移除裸 primitive 快捷通道
- [ ] K-MILE-002 阶段一自检项 A-TYPE-001 验收通过（全链路 TypedValue）
- [ ] K-MILE-003 全测试管线绿灯（build + unit + integration + regression + benchmark）
- [ ] K-MILE-004 文档、示例、迁移说明同步完成

---

## 验收标准（Definition of Done）

任一条目勾选前必须同时满足：
1. 实现代码完成并通过 code review；
2. 关联测试用例新增并通过；
3. `npm run build` 与相关测试命令全绿；
4. 文档（能力说明/限制/错误码）已同步；
5. 不引入未解释的回归。
