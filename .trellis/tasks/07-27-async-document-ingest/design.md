# Design: 异步 PDF Office 文档解析

## Preconditions and Research Gate

实现前先在 `research/` 固化候选 parser 的 Workers runtime API、依赖树、许可证/维护状态、bundle/dry-run 和恶意 fixture 结果。PDF 和三种 OOXML 可采用不同策略；任何库只要需要 DOM/canvas/fs/native/eval 或无法限制展开资源就不进入运行时。

## State and Queue

版本元数据增加 ingest generation、status、attempt、error class、extracted object/checksum。上传 finalize 后写 `queued` 并 send `{ownerId,fileId,versionId,generation}`。consumer CAS 到 extracting；成功写不可变 extracted text，再 CAS ready。transient error retry，permanent error failed+ack。DLQ consumer 对匹配 generation 写 failed。

## Retry Semantics

`max_retries: 3` 与业务 attempt 对齐并用测试锁定。人工 retry 只允许 failed -> queued 且 generation+1。消费者发现 ready/deleted/generation mismatch 直接 ack。Queue message id 仅用于诊断，不作为业务唯一键。

## Format Gate

先验证 extension/MIME/magic。OOXML 允许 ZIP 容器但只接受格式白名单 parts，拒绝宏、ActiveX、OLE、external relationships、embedded package、重复/冲突/path traversal entries、DTD/entity、超限 ratio/count/expanded bytes。PDF 拒绝 encrypted、JavaScript、Launch、EmbeddedFile、超限 pages/objects/streams。

## Quotas

Root TeamAgent 串行维护 retained bytes 和 document count，上传 admission 与 delete release 幂等。文本上限 1 MiB，文档 10 MiB，batch 50，member retained bytes 250 MiB。turn resolver 最多 10 个 ready 精确 versions，并另有 extracted chars 上限以保护 prompt。

## Provider Boundary

send 时读取 fixed version 的 ready extracted text，重新应用 authorization/revocation/size checks，构建确定性 `<attached_file>` 文本。未 ready/failed/deleted 返回明确 per-file 状态，不把二进制交给 Provider。

## Rollback

关闭 producer/consumer 后保留 queued/failed 元数据和 R2 originals；代码回滚不删对象。新版本可从 generation/state 继续或人工 retry。

