# Legacy browser shell rollout implementation plan

- [x] Run `trellis-before-dev`; map `/legacy/`, static assets, service worker,
      default navigation, local migration, smoke, deploy, and test callers.
- [x] Version only `legacy.browser.shell` with owner `frontend`, 14-day windows,
      and the minimum enforceable phase ceiling.
- [x] Add content-free caller instrumentation at every exact shell boundary.
- [ ] Build deterministic React parity and local-storage/service-worker stale
      client fixtures across required viewports.
- [x] Preserve independent chat API telemetry and controls.
- [ ] Rehearse route rollback, stop shell-owned writes, and retain 14-day write
      observation evidence.
- [ ] Disable shell reads reversibly and retain 14-day read observation evidence.
- [ ] Advance only this record to `approved_for_cleanup`; delete no assets/API/data.
- [x] Run `trellis-check`, focused/full unit tests, Workspace Playwright, local
      fake Provider Agent tests, dry-run, diff, and Trellis consistency.
- [ ] Update browser/legacy/compatibility/delivery specs; commit, PR, retain
      exact-SHA evidence, verify AC, and archive.

## Rollback Point

Restore the retained shell routing and service-worker path without changing API
authority, preserve counters, and restart the affected observation window.
