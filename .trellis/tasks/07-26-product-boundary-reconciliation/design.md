# Product Boundary Reconciliation - Design

## Boundary Decision

The reconciled product boundary is:

- Chatus is a standalone web Agent for trusted teammates.
- A deployment may optionally enable a restricted public guest entry.
- Guest sessions are anonymous but not members. They receive one fixed logical model, short-lived server sessions, quotas, no BYOK, no Skills/tools/MCP, no memory, no feedback/export, no file upload, and no account controls.
- Public self-registration is still absent. Administrators create members and issue access codes.
- Chatus remains not a public OpenAI-compatible API proxy and not an open consumer chat service.

This matches the current code and specs while preserving the original security posture for durable work capabilities.

## Changed Artifacts

- Parent PRD: replace absolute "not public anonymous" wording with the restricted guest/member distinction.
- Parent implementation plan: align the product-positioning checklist item and checkpoint notes.
- README: adjust final positioning sentence if needed so the public guest entry is not contradicted.
- Child task docs: capture evidence and validation.

## Validation

This is a documentation/task-contract change. The useful validation is:

- `python ./.trellis/scripts/task.py validate .trellis/tasks/07-26-product-boundary-reconciliation`
- targeted grep for conflicting anonymous/public/private wording
- `git diff --check`

Full runtime gates are not required because no code, config, tests, or shipped assets change.
