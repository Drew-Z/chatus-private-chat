# Legacy browser shell rollout implementation plan

- [x] Run `trellis-before-dev`; map `/legacy/`, static assets, service worker,
      default navigation, local migration, smoke, deploy, and test callers.
- [x] Version only `legacy.browser.shell` with owner `frontend`, 14-day windows,
      and the minimum enforceable phase ceiling.
- [x] Add content-free caller instrumentation at every exact shell boundary.
- [x] Build deterministic React parity and local-storage/service-worker stale
      client fixtures across required viewports.
- [x] Preserve independent chat API telemetry and controls.
- [x] Extend the main-only production census workflow with the exact 14-day shell
      window and a fixed declared-caller/deployment-SHA anomaly policy.
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

## Local Parity Evidence

- `evidence.md` records complete legacy local-storage fingerprint isolation and
  a real-source service-worker harness without retaining user content.
- Service-worker coverage proves explicit legacy pre-cache caller attribution,
  separate root/React/legacy navigation caches, offline and error fallback,
  unchanged `401`/`403`/`410` responses, request exclusions, cache cleanup, and
  explicit update activation.
- The final local baseline passes 51 Vitest files / 789 tests, Agent Playwright
  3/3, and Workspace Playwright 110 passed / 55 configured matrix skips.
- Production census collection, routing rollback, both 14-day observation windows,
  read-disable, cleanup approval, and a new delivery remain open.

## Delivery Evidence

- PR [#57](https://github.com/Drew-Z/chatus-private-chat/pull/57) passed
  `changes`, `quality`, `workspace-browser`, and `agent-browser` on head
  `a7f414804558b02f8cce839cc57b1df92c65f789` in [run
  31344295863](https://github.com/Drew-Z/chatus-private-chat/actions/runs/31344295863).
  Five content-free path, quality, coverage, Workspace, and fake-Provider
  artifacts are retained through 2026-08-24.
- The squash merge produced exact main SHA
  `695ff9877d82e0bfa732ba59dc08d40f6c31073b`. GitHub Actions [run
  31344714210](https://github.com/Drew-Z/chatus-private-chat/actions/runs/31344714210)
  passed both stale-main guards, full quality gates, Worker deployment, and the
  production smoke after normal edge-propagation retries. Worker version
  `bb6bd337-78e4-499b-9b4e-de2fe295c3f5` is live.
- Deployment-path artifact `9046925221` is retained through 2026-09-09 and
  production-deployment artifact `9046988860` is retained through 2026-11-08.
  No local production deploy, live model/MCP call, or synthetic production probe
  was used.
- This delivery starts no observation clock by itself. Routing rollback rehearsal,
  the real 14-day write window, reversible read disable, and the later 14-day read
  window remain open, so this task stays `in_progress` and unarchived.
