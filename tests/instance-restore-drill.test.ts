import { describe, expect, it } from "vitest";
import { restoreIsolatedInstance } from "../src/services/instance-restore";
import {
  buildRestoreFixture,
  createRecordingRestoreAdapter,
  MemoryRestoreCheckpointStore,
} from "./helpers/instance-restore-fixture";

describe("isolated restore drill evidence", () => {
  it("restores two principals and retains only secret-safe exact-SHA evidence", async () => {
    const fixture = await buildRestoreFixture({ principalCount: 2 });
    const adapter = createRecordingRestoreAdapter(fixture);
    const result = await restoreIsolatedInstance({
      operationId: "restore-drill-representative",
      archive: fixture.archive,
      archiveKey: fixture.archiveKey,
      target: fixture.target,
      mappings: fixture.mappings,
      checkpoints: new MemoryRestoreCheckpointStore(),
      adapter,
      now: (() => {
        let value = 20_000;
        return () => value++;
      })(),
    });
    const serialized = JSON.stringify(result.drill);
    expect(result.drill.status).toBe("passed");
    expect(result.drill.unresolvedReferences).toBe(0);
    expect(result.drill.loss.lostItemCount).toBe(0);
    expect(result.drill.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(result.drill.phases).toHaveLength(11);
    expect(serialized).not.toContain("source-root-");
    expect(serialized).not.toContain("source-conversation-");
    expect(serialized).not.toContain("source-user-");
    expect(serialized).not.toContain("target-team-do");
    console.log(`RESTORE_DRILL_EVIDENCE:${serialized}`);
  });
});
