# R2 文件工作区

## Goal

为成员提供持久、可搜索、可版本固定且可安全清理的文件工作区，以 R2 保存不可变对象、Root TeamAgent SQLite 保存权威元数据，并为异步文档解析建立稳定输入边界。

## Requirements

- R1. 新增 R2 binding `WORKSPACE_FILES`，生产资源仍只由 GitHub Actions 配置/部署。
- R2. Root TeamAgent SQLite 保存文件、不可变版本、会话固定引用和幂等操作/清理 outbox 元数据。
- R3. 支持文件列表、搜索、目录上传、重命名、固定、删除、下载和失败重试。
- R4. 目录上传保留规范化相对路径；拒绝绝对路径、`..`、空段、控制字符和大小写/Unicode 冲突。
- R5. 文件版本不可变；覆盖或重试创建新 version。会话固定 `fileId + versionId`，发送时只解析/读取该精确版本，不跟随 current version 漂移。
- R6. R2 key 不可猜且包含 owner/file/version 派生边界；客户端永远不接触 bucket 凭据或任意 object key。
- R7. 删除使用 tombstone 和幂等 outbox；conversation 删除清理引用，文件删除清理所有版本，账户永久删除级联清理全部对象、元数据和待处理操作。
- R8. R2 与 SQLite 非事务边界必须通过 pending/finalized/deleting 状态、operation id 和 reconciliation 恢复，不能宣称原子跨服务写入。
- R9. 保留当前小型 inline 文本附件兼容路径；新 workspace 引用不把二进制 data URL 持久化到会话。
- R10. 新增 schema/索引必须支持既有 Root DO 幂等升级，且不重写现有 Durable Object migration tag。

## Acceptance Criteria

- [x] AC1. Wrangler、Env、deployment config 和 contract 测试包含 `WORKSPACE_FILES`，docs/Trellis-only 与本地测试不要求生产账号。
- [x] AC2. Root SQLite 从旧 schema 幂等升级，文件/版本/引用/操作表及索引完整，重复启动无错误。
- [x] AC3. API 和 React UI 完成列表、搜索、目录上传、重命名、固定、删除、下载和重试；权限始终限制为当前成员。
- [x] AC4. 同一文件至少两个版本时，会话发送仍使用固定旧 version；重命名/current version 变化不改变历史引用。
- [x] AC5. 并发重复上传、R2 put 后 finalize 失败、delete 失败和重复 retry 均幂等，不复活 tombstone，不覆盖其他版本。
- [x] AC6. conversation 删除、文件删除和账户永久删除分别证明引用、版本对象、outbox 和 R2 对象无不应残留；部分失败可重试。
- [x] AC7. 路径穿越、同形/大小写冲突、越权 file/version ID、任意 object key 和错误 expected version 被拒绝。
- [x] AC8. Workspace Playwright、Agent fake Provider（精确版本上下文）和五项全量验证通过。

## Out of Scope

- 本任务不解析 PDF/Office；只建立对象、元数据和精确版本读取边界。
- 不实现跨成员文件分享或 ACL。
