export function buildAdminReportCsv(stats, generatedAt = new Date()) {
  const rows = [
    ["Chatus 运营报表"],
    ["生成时间", generatedAt.toISOString()],
    ["统计日期", stats?.day || ""],
    [],
    ["每日趋势"],
    ["日期", "请求数", "错误数", "错误率(%)", "Fallback", "限流"],
  ];

  for (const day of [...(stats?.trend || [])].reverse()) {
    rows.push([day.day, day.requests, day.errors, day.errorRate, day.fallbacks, day.rateLimited]);
  }

  rows.push([], ["线路统计（近7日）"], ["线路ID", "显示名称", "模型", "成功", "失败", "错误率(%)"]);
  for (const route of stats?.routeStats || []) {
    rows.push([route.id, route.label, route.model, route.ok7d, route.error7d, route.errorRate7d]);
  }

  rows.push([], ["用户概况"], [
    "用户label", "显示名称", "状态", "今日已用", "每日额度", "今日剩余", "默认线路",
    "可用线路数", "BYOK", "活跃会话", "记忆字符数", "7日请求", "7日错误", "7日错误率(%)",
  ]);
  for (const user of stats?.users || []) {
    rows.push([
      user.label,
      user.displayName,
      user.enabled === false ? "已暂停" : "启用",
      user.used,
      user.dailyLimit,
      user.remaining,
      user.defaultRoute,
      Array.isArray(user.allowedRoutes) ? user.allowedRoutes.length : 0,
      user.allowBringYourOwnKey ? "是" : "否",
      user.activeSessions,
      user.memoryChars,
      user.requests7d,
      user.errors7d,
      user.errorRate7d,
    ]);
  }

  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function csvCell(value) {
  let text = value == null ? "" : String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  if (typeof value === "string" && /^[\t ]*[=+\-@]/.test(text)) text = `'${text}`;
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
