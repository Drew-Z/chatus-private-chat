# Design: PR CI 与 Trellis 交付门禁

## PR CI

新增 `.github/workflows/ci.yml`。`changes` job 生成稳定 path flags；`quality` job 始终存在并执行五项基础检查；Workspace 和 Agent 浏览器 job 始终有稳定结果，通过 job-level 条件或内部 no-op summary 表达“不受影响”。失败时上传 Playwright trace/screenshot 和经过脱敏的日志，成功时上传 SHA manifest。

## Deployment

扩展 main workflow 的路径分类：只有代码、lockfile、Wrangler 或运行脚本变化才执行部署；docs/Trellis-only 生成 skip summary。部署 manifest 至少记录 `GITHUB_SHA`、lockfile hash、静态 bundle digest、构建时间。production acceptance 读取 deployed `release.json.commit`，输出非敏感 JSON summary artifact。

## Browser Artifacts

runner 接受调用方提供的 artifact/output 目录。调用方目录不在 finally 删除；临时凭据、env、Wrangler state 不进入目录。日志仍使用现有 redaction。

## Trellis Validation

新增纯读取 validation 模块和 CLI，全量扫描 active/archive task.json 与 workspace 索引。archive 先执行 validation，再修改状态/目录；校验失败无磁盘 mutation。任务元数据新增结构化 `waivers` 和 `validation`/`workCommit` 证据，保持旧 task.json 向后兼容。

## Archive Ordering

1. 解析任务和树。
2. 校验 AC、验证记录、work commit、children、waiver 和全库一致性。
3. 预检 git 状态/归档目标。
4. 写 completed 并移动。
5. 生成 archive commit；失败时恢复原路径和元数据。

## Compatibility

旧任务没有新字段时按空字段读取；已归档历史任务可通过显式 legacy waiver 或迁移工具进入一致性检查，不能因为新门禁永久锁死仓库。

## Rollback

PR CI 可回滚 workflow commit。archive 新逻辑必须在 mutation 前失败；mutation 后异常恢复原 task.json 和目录。部署仍不允许本地生产命令。

