# CLIProxyAPI Provider-Pool Reference

## Snapshot

- Repository: `router-for-me/CLIProxyAPI`
- Reviewed commit: `db82d65d1cc3be6dc9662ee2b9a3810ac948d377`
- License: MIT
- Review date: 2026-07-21

## Reusable Ideas

- `config.example.yaml:374-384` documents repeated client aliases as one internal model pool. The client sees one alias, requests rotate across upstream model names, and retry advances only before output.
- `sdk/cliproxy/auth/selector.go:199-253` filters blocked credentials, groups ready candidates by integer priority, selects only the highest-priority group, and sorts it deterministically.
- `sdk/cliproxy/auth/selector.go:256-302` supplies round-robin and fill-first selection inside the eligible priority group.
- `sdk/cliproxy/auth/scheduler.go:197-241` shards scheduler state by provider and canonical model, excludes already-tried credentials, and returns a stable unavailable error when no candidate is ready.
- `internal/watcher/config_reload.go:29-85` debounces configuration updates, hashes content, ignores unchanged writes, and activates only a successfully parsed replacement.

## Deliberate Differences

- CLIProxyAPI's cooldown state represents a credential that failed or exhausted quota. It is not an active-request lease and does not enforce provider-wide exclusivity across models.
- Chatus provider capacity must be globally atomic across Worker isolates and teammates, so it uses one Durable Object per provider instance rather than an in-process selector mutex.
- CLIProxyAPI can use local YAML and auth files. Chatus keeps provider plaintext write-only at the admin boundary and stores AES-GCM ciphertext in KV under the existing master-key contract.
- Chatus orders offerings by administrator priority plus passive quality for the exact logical-model/provider pair. It does not use round-robin across different quality tiers and does not add synthetic health checks.
- Chatus retains the existing no-fallback-after-visible-output contract and holds a lease until a stream finishes, fails, or is cancelled.
