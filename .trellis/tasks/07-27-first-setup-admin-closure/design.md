# Design: 首次配置与单后台闭环

## API Boundary

`GET /api/admin/setup-status` 位于现有 admin session guard 后。响应只含 `ready`、`configSource` 和各步骤的 `ready/count/status`。凭据复用 `inspectAdminProviderCredential` 的安全枚举；成员只使用数量；配置 source 用于区分默认占位与显式配置。

`POST /api/admin/setup-smoke` 同样需要 admin session 和 same-origin。它运行纯本地检查：配置 schema、enabled logical route 的 candidate 解析、credential reference availability、成员/权限投影和必需 binding 可访问性。不得 fetch provider。

## Readiness

- health: Worker、KV/DO 必需配置可用。
- provider: 至少一个启用 Provider 且凭据状态可用。
- model: 至少一个启用 logical route 与启用 offering 可解析。
- member: 至少一个配置成员。
- permission: 至少一种明确访问路径就绪。
- smoke: 最近一次本地 smoke 对当前配置 revision 成功。

## React Flow

AdminApp 认证后先取 setup status。未 ready 显示 `AdminSetupGuide`；ready 进入 AdminWorkspace。Guide 使用紧凑 stepper 和现有面板/导航回调，不复制表单。Workspace 保留“首次配置”状态入口供重新检查，但不链接 legacy。

## Legacy Boundary

`/admin.html` 静态资源和 API 继续工作，作为明确回滚 URL。legacy 顶部保留“返回新版后台”。React 导航移除“完整后台”链接；已迁移 legacy 功能不再在新版中导向旧页面。

## Rollback

setup API additive；移除 React legacy 链接可单独回滚。引导错误时管理员仍可直接进入已存在的 `/admin.html`。

