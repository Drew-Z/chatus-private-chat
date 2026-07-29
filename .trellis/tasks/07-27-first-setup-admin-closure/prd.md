# 首次配置与单后台闭环

## Goal

让管理员在 React 后台内完成从空实例到可用实例的首次配置和日常运营闭环，同时保留 `/admin.html` 作为可直接访问的回滚地址。

## Requirements

- R1. 新增管理员鉴权后的 `GET /api/admin/setup-status`，不调用模型，不返回 secret、ref、URL、model 名、成员 label、访问码或其他敏感标识。
- R2. setup status 用布尔、计数和有限枚举表达：健康、Provider/凭据、logical model/offering、首位成员、权限和 smoke readiness。
- R3. 引导顺序固定为：健康 -> Provider 密钥 -> logical model/offering -> 首位成员 -> 权限 -> 无模型 smoke。
- R4. `smoke` 仅验证本地配置/解析/绑定/权限闭环，不发送模型请求，不调用上游。
- R5. React admin 复用现有 Provider、模型、成员、权限面板，保存后刷新 setup status，可从引导跳到对应步骤。
- R6. 日常运营动作全部可在 React admin 完成后，隐藏指向 `/admin.html` 的常规导航；URL 仍可直接访问并保留从 legacy 回新版的回滚入口。
- R7. `ADMIN_TOKEN` 未配置时不开放匿名 setup-status；健康端点继续只输出安全布尔信息。

## Acceptance Criteria

- [x] AC1. 未认证 setup-status 返回 401；认证响应只有允许的键/计数/枚举，敏感字段扫描为零。
- [x] AC2. default/secret/KV 配置、缺凭据、缺 offering、无成员、权限未就绪和 ready 状态有 Worker API 测试。
- [x] AC3. setup-status 和 smoke 测试证明上游 fetch 调用次数为 0。
- [x] AC4. React 引导按六步顺序展示，保存各配置后状态刷新且可进入目标面板。
- [x] AC5. React admin 覆盖日常 Provider、模型、成员、权限和运营动作后，不再显示 `/admin.html` 常规入口。
- [x] AC6. `/admin.html` 可直接访问，legacy 明确保留回新版入口；相关回归测试通过。
- [x] AC7. Workspace Playwright、Worker API 和五项全量验证通过。

## Out of Scope

- 不定义 ADMIN_TOKEN 的在线 bootstrap/轮换流程。
- smoke 不做 live provider/model 测活。
