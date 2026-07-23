import { describe, expect, it } from "vitest";
import { mergeAdminMemberProjection } from "../client/src/lib/admin-members";

describe("typed admin member lifecycle state", () => {
  it("adds and sorts a newly created member without retaining duplicate labels", () => {
    const next = mergeAdminMemberProjection(
      [{ label: "zoe", displayName: "Zoe", configured: true, hasAccessCode: true }],
      "bill",
      { label: "bill", displayName: "Bill", configured: false, hasAccessCode: true },
    );
    expect(next.map((member) => member.label)).toEqual(["bill", "zoe"]);
  });

  it("updates access state without changing unrelated members", () => {
    const next = mergeAdminMemberProjection(
      [
        { label: "bill", displayName: "Bill", configured: true, hasAccessCode: false },
        { label: "zoe", displayName: "Zoe", configured: true, hasAccessCode: true },
      ],
      "bill",
      { label: "bill", displayName: "Bill", configured: true, hasAccessCode: true },
    );
    expect(next).toEqual([
      { label: "bill", displayName: "Bill", configured: true, hasAccessCode: true },
      { label: "zoe", displayName: "Zoe", configured: true, hasAccessCode: true },
    ]);
  });

  it("removes an access-only member after revocation", () => {
    const next = mergeAdminMemberProjection(
      [
        { label: "bill", displayName: "Bill", configured: false, hasAccessCode: true },
        { label: "zoe", displayName: "Zoe", configured: true, hasAccessCode: true },
      ],
      "bill",
      null,
    );
    expect(next).toEqual([
      { label: "zoe", displayName: "Zoe", configured: true, hasAccessCode: true },
    ]);
  });
});
