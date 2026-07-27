# 异步 PDF Office 文档解析

## Goal

在 R2 精确文件版本之上，用 Queue/DLQ 安全、幂等地提取文本、PDF、DOCX、XLSX 和 PPTX 内容，并把恶意文档、资源放大和失败恢复作为首要验收边界。

## Requirements

- R1. 新增 `DOCUMENT_INGEST` Queue 和 DLQ；状态为 `queued | extracting | ready | failed | deleted`。
- R2. 支持纯文本、PDF、DOCX、XLSX、PPTX；拒绝宏/脚本、ActiveX/OLE、external relationship、embedded package 和嵌套压缩。
- R3. 默认限制：文本 1 MiB、PDF/Office 10 MiB、单批 50 文件、单成员 250 MiB、单轮最多引用 10 文件。
- R4. Queue 业务幂等键使用 document/version/generation，不依赖 Queue message id；最多重试 3 次，之后由 DLQ 将状态确定为 failed。
- R5. deleted 是终态；旧 generation、重复/并发消息和删除后的延迟消息不能复活内容或覆盖新 retry。
- R6. parser 依赖必须在落地前完成 Workers 兼容、bundle/dry-run、许可证/维护和恶意文档验证；无法安全验证的格式使用受限 OOXML ZIP/XML 提取或保持 failed，不降级为不设限解析。
- R7. 解析限制 entry/page/object/row/cell/slide/XML depth、expanded bytes、compression ratio、输出 chars 和 wall-clock/CPU；禁止 eval、外部 fetch、文件系统和 native binary。
- R8. 提取结果只作为确定性的受控文本上下文发送给 Provider；不传 native non-image file parts。
- R9. 上传配额、存储配额、解析状态和单轮引用限制分别核算；删除释放可释放额度，tombstone 仍保留权威。
- R10. 所有测试使用小型本地 fixtures 和 fake Provider，不调用 live model 或生产 Queue/R2。

## Acceptance Criteria

- [ ] AC1. 五种格式各有正常 fixture，状态按 queued -> extracting -> ready，精确 version 产生确定性文本。
- [ ] AC2. 宏/脚本、嵌套 archive、zip bomb、path traversal、外部关系、PDF JS/Launch/EmbeddedFile 和加密/损坏文档永久失败且不调用 Provider。
- [ ] AC3. 大小、批次、成员存储和单轮 10 文件限制在边界 ±1 有测试；并发 admission 不突破成员额度。
- [ ] AC4. transient failure 恰好最多重试 3 次，DLQ 置 failed；permanent failure 不重试；人工 retry 使用新 generation。
- [ ] AC5. 重复、并发、ready 后重复、extracting 时删除、deleted 后延迟和旧 generation 消息均幂等。
- [ ] AC6. parser 研究记录包含 Workers 兼容、恶意文档、license/maintenance、bundle size 和 dry-run 证据，选型理由可审计。
- [ ] AC7. Agent fake Provider 测试证明只收到受控 extracted text，单轮最多 10 个精确版本，用户消息配额仍只计一次。
- [ ] AC8. Queue/DLQ Vitest、恶意 fixtures、两类浏览器测试和五项全量验证通过。

## Out of Scope

- 不支持 `.docm`、`.xlsm`、`.pptm`、通用 archive、OCR 或图片型 PDF OCR。
