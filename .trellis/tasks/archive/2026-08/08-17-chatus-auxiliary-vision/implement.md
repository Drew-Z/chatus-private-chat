# Auxiliary Vision Implementation

## Dependency

Start only after `08-17-chatus-capability-catalog-adoption` is complete, checked,
committed, and archived.

## Checklist

- [x] Load `trellis-before-dev` plus multimodal, streaming, Provider runtime,
  attempt-ledger, monitoring, backup/restore, and frontend quality specs.
- [x] Add helper config validation/admin route selection and derived public image
  mode while preserving native `supportsImages`.
- [x] Add `auxiliary_vision` to every closed attempt/monitor/finance decoder and
  label, without touching production observation artifacts.
- [x] Implement helper planning, lease, credential, budget, deadline, usage,
  cancellation, and ledger settlement through shared Provider services.
- [x] Implement forced trusted-tool and pre-answer paths with canonical image
  scope and no generic MCP image payload.
- [x] Add strict evidence decoding and private Agent persistence/lifecycle.
- [x] Add canonical public errors, draft-safe recovery, and admin/member states.
- [x] Test the full fake-Provider route and lifecycle matrices, including late
  results and required-ledger failures.
- [x] Load `trellis-check`, run focused and child quality gates, update specs,
  commit, and archive before starting web research.

## Rollback

Disable helper configuration and assisted public modes. No stored image, route,
or application-config downgrade is required.
