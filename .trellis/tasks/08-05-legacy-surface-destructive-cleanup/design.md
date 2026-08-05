# Legacy surface destructive cleanup design

## Approval Envelope

Each cleanup operation binds one surface ID to final census/parity/recovery/
rollback evidence, exact deletion inventory, approver, source and target SHA,
monitoring window and abort policy. The envelope is immutable after approval.

## Cleanup State Machine

```text
approved -> preview-verified -> deleting -> verifying -> completed
                               \-> failed-isolated -> forward-repair/restore
```

Operation fences and tombstones make retries idempotent and block resurrection.
Unknown targets or evidence drift invalidate approval before any deletion.

## Execution Boundary

Production cleanup runs only through GitHub Actions against an exact main SHA.
The workflow must retain bounded secret-safe preview/result artifacts and reject
docs-only/deployment mismatch. Local tooling may validate fixtures but cannot
perform production deletion.

## Rollback

Where physical restoration is safe, restore from the immediately proven archive;
otherwise forward-repair from the retained source evidence. Durable Object
migration tags and immutable audit history are never rolled back or deleted.
