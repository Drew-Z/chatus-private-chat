# Legacy browser shell rollout design

## Boundary

This task owns browser navigation to `/legacy/`, its static entry assets,
service-worker reachability, and exact shell-use evidence. It does not own the
legacy chat API or storage source of truth.

## Rollout Flow

1. Version only the shell record with `frontend`, 14-day windows, and a bounded
   phase ceiling.
2. Instrument route, asset, browser, service-worker, deployment, and test use.
3. Freeze a supported-flow matrix and reconcile it against React Workspace.
4. Migrate service-worker/default-route/smoke callers while retaining passive
   evidence for stale clients.
5. Rehearse routing rollback, stop shell-owned writes if any, observe, disable
   reads, and observe again.

## Data and Privacy

Evidence includes only caller class, access class, UTC bucket, exact SHA, and
bounded counts. Local-storage/conversation contents, prompts, models, labels,
tokens, and URLs never enter legacy telemetry.

## API Compatibility

Shell callers of `legacy.api.chat-post` and `legacy.api.cloud-chats` remain
counted by those records. Shell read-disable completion becomes a prerequisite
for their later write/read disable, but not for their instrumentation or parity.

## Rollback

The routing switch restores the retained shell and service-worker reachability
without changing API/storage authority. Any unexplained stale-client hit resets
the read observation.
