# Capability Catalog And Adoption Implementation

## Dependency

None. This is the first implementation child of
`08-17-chatus-default-capability-packs`.

## Checklist

- [x] Load `trellis-before-dev` and the capability/frontend/platform specs.
- [x] Add exact shared activation, origin, disclosure, augmentation-assignment,
  and public/admin projection contracts with focused decoder tests.
- [x] Add the versioned catalog service and five bounded workflow definitions.
- [x] Add the unconfigured default seed without normalization-time injection.
- [x] Extend capability registry filtering while preserving omitted versus empty
  assignment semantics and the three-Skill selector ceiling.
- [x] Add catalog preview/install endpoints using editable config revision,
  collision refusal, atomic validation/write, and content-free audit.
- [x] Add exact client decoders and the administrator Catalog view with stale
  revision/conflict draft retention.
- [x] Add unit, Worker, client, and browser fixtures covering default/KV/secret,
  guest, inheritance, deny-all, collision, rename/delete, and responsive states.
- [x] Load `trellis-check`; run focused checks, then the required child quality
  gate with fake/local services only.
- [x] Update applicable specs, commit only this child plus inherited parent task
  metadata, and archive it before child 2 starts.

## Rollback

Remove the default seed and hide the Catalog view/endpoints. Do not delete
administrator-installed items or rewrite stored configuration.
