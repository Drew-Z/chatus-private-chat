import type { MemberModelAvailability } from "../lib/api";

export function ModelAvailabilityBadge({
  route,
  compact = false,
  refreshing = false,
}: {
  route?: MemberModelAvailability["routes"][number];
  compact?: boolean;
  refreshing?: boolean;
}) {
  const presentation = availabilityPresentation(route, refreshing);
  return (
    <span
      className={`model-availability-badge ${presentation.tone}`}
      title={presentation.description}
      aria-label={`模型状态：${presentation.label}`}
    >
      <span className="model-availability-dot" aria-hidden="true" />
      <span>{presentation.label}</span>
      {!compact && route && route.speed !== "unknown" && <small>{availabilitySpeedLabel(route.speed)}</small>}
    </span>
  );
}

export type AvailabilityPresentation = {
  label: string;
  description: string;
  tone: "healthy" | "degraded" | "unavailable" | "unknown" | "limited" | "stale" | "refreshing";
};

export function availabilityPresentation(
  route?: MemberModelAvailability["routes"][number],
  refreshing = false,
): AvailabilityPresentation {
  if (refreshing) return {
    label: "正在更新",
    description: "正在刷新最近真实任务的可用性；当前请求仍以实时结果为准。",
    tone: "refreshing",
  };
  if (!route || (route.status === "unknown" && route.observedAt === null)) return {
    label: "暂无观测",
    description: "最近 24 小时没有足够的真实 Chatus 任务观测，下一次请求仍以实时结果为准。",
    tone: "unknown",
  };
  if (route.status === "unavailable") return {
    label: "暂不可用",
    description: availabilityStatusDescription(route.status),
    tone: "unavailable",
  };
  if (route.status === "degraded") return {
    label: "有波动",
    description: availabilityStatusDescription(route.status),
    tone: "degraded",
  };
  if (route.confidence === "stale") return {
    label: "状态已过期",
    description: "历史观测已不够新鲜，不能代表当前线路状态；下一次请求仍以实时结果为准。",
    tone: "stale",
  };
  if (route.confidence === "limited") return {
    label: "样本较少",
    description: "当前状态只基于少量真实任务观测，可信度有限；下一次请求仍以实时结果为准。",
    tone: "limited",
  };
  return {
    label: "可用",
    description: availabilityStatusDescription(route.status),
    tone: "healthy",
  };
}

export function availabilityStatusLabel(status: MemberModelAvailability["routes"][number]["status"]): string {
  if (status === "healthy") return "可用";
  if (status === "degraded") return "有波动";
  if (status === "unavailable") return "暂不可用";
  return "状态未知";
}

export function availabilityConfidenceLabel(confidence: MemberModelAvailability["routes"][number]["confidence"]): string {
  if (confidence === "recent") return "近期观测";
  if (confidence === "limited") return "样本较少";
  return "状态已过期";
}

export function availabilityStatusDescription(status: MemberModelAvailability["routes"][number]["status"]): string {
  if (status === "healthy") return "最近 Chatus 任务运行正常，可继续使用。";
  if (status === "degraded") return "最近任务有波动，可以重试或切换其他模型。";
  if (status === "unavailable") return "最近连续任务失败，可以选择其他模型或稍后重试。";
  return "暂无足够的新鲜数据，下一次请求仍以实时结果为准。";
}

export function availabilitySpeedLabel(speed: MemberModelAvailability["routes"][number]["speed"]): string {
  if (speed === "fast") return "响应快";
  if (speed === "normal") return "响应正常";
  if (speed === "slow") return "响应偏慢";
  return "速度未知";
}
