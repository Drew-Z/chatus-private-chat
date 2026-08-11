# GitHub Actions minute optimization design

## Workflow Boundaries

The PR workflow remains the automated code-quality boundary. A small classification job always runs, emits `quality`, `workspace`, and `agent`, and lets documentation/Trellis-record-only PRs finish without dependency installation or tests. Runtime and governance changes continue through baseline quality and the existing path-aware browser jobs.

Per-PR concurrency cancels an obsolete run only when a newer commit targets the same pull request. Production deployment keeps a separate non-canceling mutation group.

## Production Deployment

`deploy.yml` becomes a manual production workflow. It accepts only a run dispatched from `refs/heads/main`; the existing early and late remote-main SHA guards remain authoritative. Removing the push trigger also removes the now-redundant deployment-classification and skip jobs. No local production deployment path is introduced.

## Dependabot

Weekly npm updates use one wildcard group and weekly GitHub Actions updates use one wildcard group. Each ecosystem allows one open PR, limiting the number of CI-triggering update branches while retaining routine dependency maintenance.

## Compatibility And Rollback

Application/runtime behavior is unchanged. Rollback is a single workflow commit revert: restore the `push: main` deployment trigger and the prior classifier/test expectations. Existing production revisions and Cloudflare state are unaffected until a separately approved manual deployment is run.

## Validation

YAML is parsed by the existing duplicate-key-safe structural tests. Tests must assert the exact trigger and job-level conditions rather than relying on text matching. Local validation uses fixtures and Wrangler dry-run only.
