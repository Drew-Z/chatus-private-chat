# 管理员安全与错误恢复

## Goal

让 React 管理后台在退出、首次加载、长列表和破坏性操作上具有明确、安全、可恢复且可访问的行为。

## Requirements

- R1. logout 只有服务端确认 session 撤销成功后才退出 React authenticated 状态；失败保留后台并显示可重试错误。
- R2. 后台初始数据加载有互斥的 `loading | ready | error` 状态；error 提供 retry，不与伪 loading 同时显示。
- R3. operations 各列表显示 `当前显示 N / 总数`，搜索后计数正确，并能通过分页或展开访问第 21 条及以后。
- R4. 用统一、可访问的 React Dialog 替换 React admin 内全部 `window.confirm`。
- R5. Dialog 支持 cancel/confirm、焦点进入与恢复、Escape、busy/错误状态，危险动作有明确标题和目标。
- R6. 保持服务端 origin/CSRF 防护和 legacy `/admin.html` 回滚地址可用。
- R7. 测试使用本地 API/fixtures，不打印管理员 token 或成员内容。

## Acceptance Criteria

- [ ] AC1. logout 的网络、5xx 或撤销失败不会触发 `onLogout`，成功时清理 cookie/session 并进入登录页。
- [ ] AC2. AdminWorkspace 和 operations 初始加载分别覆盖 loading、ready、error、retry 成功行为测试。
- [ ] AC3. 每类运营列表在 21 条以上时显示正确 N/总数，并能访问最后一条；过滤后计数同步更新。
- [ ] AC4. React admin 代码中没有 `window.confirm`；所有原确认路径使用共享 Dialog。
- [ ] AC5. Dialog 的键盘、焦点恢复、cancel/confirm 和提交失败状态有自动化覆盖。
- [ ] AC6. Workspace Playwright、Worker API 测试和五项全量验证通过。

## Out of Scope

- 不在此任务实现首次配置引导或隐藏 legacy 导航；由后续子任务负责。
