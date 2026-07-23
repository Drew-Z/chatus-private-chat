import type { AdminMemberProjection } from "./api";

export function mergeAdminMemberProjection(
  members: AdminMemberProjection[],
  label: string,
  member: AdminMemberProjection | null,
): AdminMemberProjection[] {
  const next = members.filter((entry) => entry.label !== label && entry.label !== member?.label);
  if (member) next.push(member);
  return next.sort((left, right) => left.label.localeCompare(right.label));
}
