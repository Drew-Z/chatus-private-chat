import { describe, expect, it } from "vitest";
import { OPERATIONS_PAGE_SIZE, paginateOperations } from "../client/src/components/AdminOperationsPanel";

describe("admin operations pagination", () => {
  const entries = Array.from({ length: 21 }, (_, index) => `entry-${index + 1}`);

  it("uses a stable 20-item page and exposes item 21", () => {
    const first = paginateOperations(entries, 1);
    expect(OPERATIONS_PAGE_SIZE).toBe(20);
    expect(first).toMatchObject({ page: 1, pageCount: 2, displayed: 20, total: 21 });
    expect(first.items).toEqual(entries.slice(0, 20));

    const second = paginateOperations(entries, 2);
    expect(second).toMatchObject({ page: 2, pageCount: 2, displayed: 1, total: 21 });
    expect(second.items).toEqual(["entry-21"]);
  });

  it("clamps stale pages after filtering and keeps empty counts exact", () => {
    expect(paginateOperations(["filtered-entry"], 4)).toMatchObject({
      items: ["filtered-entry"],
      page: 1,
      pageCount: 1,
      displayed: 1,
      total: 1,
    });
    expect(paginateOperations([], 4)).toMatchObject({
      items: [],
      page: 1,
      pageCount: 1,
      displayed: 0,
      total: 0,
    });
  });
});
