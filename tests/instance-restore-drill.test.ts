import { describe, expect, it } from "vitest";
import { decodeDurableObjectCaptureSnapshot } from "../src/services/durable-object-restore";
import { parseLegacySurfaceRegistryCapture, restoreIsolatedInstance } from "../src/services/instance-restore";
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
    expect(result.acceptance.writesOpen).toBe(false);
    expect(adapter.writesOpened).toBe(false);
    const restoredEntries = adapter.restoredEntries.flatMap(({ entries }) => entries);
    const conversation = restoredEntries.find(({ store, targetIdentity }) => (
      store === "conversation_team_agent" && targetIdentity === "do:conversation_team_agent:target-conversation-1"
    ));
    expect(conversation).toBeDefined();
    const conversationSnapshot = decodeDurableObjectCaptureSnapshot(
      conversation!.bytes,
      conversation!.schemaVersion,
    );
    expect(conversationSnapshot.schemaVersion).toMatch(/^team-agent-v\d+$/);
    expect(conversationSnapshot.tables).toContainEqual(expect.objectContaining({
      name: "chatus_conversations",
      rows: [expect.objectContaining({
        id: "conversation-restore-drill",
        route_id: "primary",
        message_count: 1,
      })],
    }));
    const userState = restoredEntries.find(({ store, targetIdentity }) => (
      store === "user_state" && targetIdentity === "do:user_state:target-user-1"
    ));
    expect(userState?.schemaVersion).toMatch(/^user-state-v\d+$/);
    const registry = await parseLegacySurfaceRegistryCapture(
      adapter.restoredLegacySurfaceRegistries[0]!.bytes,
    );
    expect(registry.surfaces.find(({ manifest }) => manifest.surfaceId === "legacy.api.chat-post"))
      .toMatchObject({
        state: {
          phase: "discovered",
          readControl: "enabled",
          writeControl: "enabled",
        },
      });
    expect(serialized).not.toContain("source-root-");
    expect(serialized).not.toContain("source-conversation-");
    expect(serialized).not.toContain("source-user-");
    expect(serialized).not.toContain("target-team-do");
    console.log(`RESTORE_DRILL_EVIDENCE:${serialized}`);
  });
});
