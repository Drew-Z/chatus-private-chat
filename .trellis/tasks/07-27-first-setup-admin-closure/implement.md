# Implementation Plan: 首次配置与单后台闭环

## Ordered Checklist

- [ ] 加载 frontend/platform specs，确认管理员鉴权与安全投影规则。
- [ ] 为 setup-status/smoke 写认证、状态矩阵、敏感字段和零 upstream 测试。
- [ ] 实现安全 setup projection 与纯本地 smoke API。
- [ ] 扩展 frontend API 类型，新增 AdminSetupGuide 与状态刷新。
- [ ] 把六步引导连接到现有 Provider、模型、成员和权限面板。
- [ ] 补齐 React admin 日常动作入口，移除常规 `/admin.html` 导航。
- [ ] 保留 legacy URL 和返回新版入口，更新契约测试。
- [ ] 运行 `trellis-check`、Workspace Playwright 和五项全量验证。
- [ ] 更新 setup/admin specs，记录验证、提交、PR、合并并归档。

## Risky Files

- `src/worker.ts`
- `client/src/components/AdminApp.tsx`
- `client/src/components/AdminWorkspace.tsx`
- `client/src/components/AdminSetupGuide.tsx`
- `public/admin.html`

## Rollback Points

- API projection、React guide、legacy navigation 分开提交。
- 引导不可用时 `/admin.html` 仍是明确回滚路径。

