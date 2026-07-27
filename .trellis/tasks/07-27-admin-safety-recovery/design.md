# Design: 管理员安全与错误恢复

## Logout Contract

`adminLogout()` 不吞异常，返回明确成功或抛结构化 API 错误。服务端只有在 session KV 删除成功后返回 2xx；客户端成功后才调用 `onLogout()`。失败保留当前页面并展示 notice。清 cookie 与撤销语义保持一致，避免“UI 已退出、服务端仍有效”。

## Async View State

AdminWorkspace 和 operations 各自使用判别联合：`loading`、`ready(data)`、`error(message)`。refresh 可保留旧 data 并显示非阻塞 busy，但首次加载 error 不渲染 ready 内容或无限 loading。

## Long Lists

使用稳定页大小 20。状态包含 query/page；先过滤后分页。标题显示当前页或已展开项目数 N 与过滤后总数。提供上一页/下一页或“显示更多”，第 21 条有键盘可达入口。

## Confirmation Dialog

新增共享 `ConfirmDialog`，由调用方提供 title、description、confirm label、tone、pending 和错误。组件用 React 管理的 `<dialog>`，统一焦点与关闭约束。各面板只持有待执行 action，不复制 DOM/focus 逻辑。

## Tests

优先行为测试覆盖状态转换和 Dialog；现有 visual fixture 扩展 21+ 条和 error/retry。Worker logout 测试模拟 KV delete failure，确认 status/cookie/session 契约。

## Rollback

API 错误契约和共享 Dialog 可独立回滚；服务端 session 数据格式不变化。
