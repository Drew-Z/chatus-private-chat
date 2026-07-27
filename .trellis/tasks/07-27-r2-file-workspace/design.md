# Design: R2 文件工作区

## Ownership and Tables

Root TeamAgent 是单成员串行 mutation owner。新增：

- `workspace_files`: logical file、normalized path/name、current version、pin、tombstone、optimistic timestamp。
- `workspace_file_versions`: immutable version、R2 object key、size、media type、checksum、state、generation。
- `conversation_file_refs`: chat/message/file/version 精确引用。
- `workspace_file_operations`: upload/delete/reconcile outbox、operation id、attempt/error。

应用级 schema upgrader 用显式 version/PRAGMA 检查增加表和索引；旧行不迁移为 workspace 文件。

## Object Layout

对象 key 由 owner hash、随机 file id 和 version id 构成，不含原文件名或 label。上传流程：SQLite reserve `pending` -> R2 put -> SQLite finalize `ready`。失败操作保留可重试 generation；reconciler 删除 orphan object 或补齐 pending 状态。

## API Surface

- list/search 支持 cursor 和规范化 query。
- upload/create-version 接受 operation id、relative path、metadata 和 body，执行 quota admission 后写 R2。
- rename/pin/delete 带 `expectedUpdatedAt`。
- download 根据当前 member + file/version 查 exact key，再由 Worker 流式返回。
- conversation attach/detach 保存精确 version id；send boundary 再检查引用仍可用。

所有响应只投影公共 id、路径、状态、大小、checksum、版本和时间；不返回 object key。

## Directory and Name Rules

浏览器目录上传读取 `webkitRelativePath`，服务端是最终权威。路径用 `/`、NFC、分段长度/总长度限制；拒绝 `.`/`..`、绝对/盘符、NUL/control、空段和同目录规范化冲突。

## Deletion

逻辑 delete 先 tombstone，随后 outbox 删除 R2 versions。conversation delete 只删 refs；file delete 删除 versions；account purge 在清 Root 表前快照 object keys 并逐项确认。任何延迟消息看到 tombstone/generation mismatch 都 ack/忽略，不能复活。

## Compatibility and Rollback

现有 inline attachment 保留。R2 feature 可在 UI 隐藏，但元数据和对象不做破坏性回滚。代码回滚后对象仍安全留存，后续版本可 reconciliation。
