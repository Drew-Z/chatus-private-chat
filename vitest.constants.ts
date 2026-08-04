export const WORKERS_TEST_FILES = [
  "tests/document-ingest-queue.test.ts",
  "tests/document-ingest-state.test.ts",
  "tests/image-input.test.ts",
  "tests/provider-coordinator.test.ts",
  "tests/route-reliability.test.ts",
  "tests/team-agent-turn.test.ts",
  "tests/user-state.test.ts",
  "tests/worker-api.test.ts",
  "tests/workspace-file.test.ts",
] as const;

export const TRANSITIVE_WORKERS_TEST_FILES = [
  "tests/image-input.test.ts",
] as const;

export const TEST_COVERAGE_THRESHOLDS = {
  statements: 60,
  branches: 57,
  functions: 55,
  lines: 65,
} as const;
