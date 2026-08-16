import type { MemberModelAvailability } from "../lib/api";

export function ModelAvailabilityBadge({
  route,
  compact = false,
}: {
  route?: MemberModelAvailability["routes"][number];
  compact?: boolean;
}) {
  if (!route) return <span className="model-availability-badge unknown"><span className="model-availability-dot" aria-hidden="true" />暂无状态</span>;
  return (
    <span
      className={`model-availability-badge ${route.status}`}
      title={availabilityStatusDescription(route.status)}
      aria-label={`模型状态：${availabilityStatusLabel(route.status)}`}
    >
      <span className="model-availability-dot" aria-hidden="true" />
      <span>{availabilityStatusLabel(route.status)}</span>
      {!compact && route.speed !== "unknown" && <small>{availabilitySpeedLabel(route.speed)}</small>}
    </span>
  );
}

export function availabilityStatusLabel(status: MemberModelAvailability["routes"][number]["status"]): string {
  if (status === "healthy") return "可用";
  if (status === "degraded") return "有波动";
  if (status === "unavailable") return "暂不可用";
  return "状态未知";
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
