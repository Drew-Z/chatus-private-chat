# Cloudflare R2 and Durable Objects verification (2026-07-29)

## Sources checked

- Cloudflare R2 Workers API reference: <https://developers.cloudflare.com/r2/api/workers/workers-api-reference/>
- Cloudflare Durable Objects rules: <https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/>
- Cloudflare Durable Objects SQLite API: <https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/>
- Wrangler configuration schema from the installed `wrangler@4.110.0`
- Latest published `@cloudflare/workers-types@5.20260729.1`

## Implementable conclusions

- `R2Bucket.put` accepts `ReadableStream`, `ArrayBuffer`, `ArrayBufferView`, `string`, `null`, or `Blob`; bounded uploads can use an `ArrayBuffer` so the object length is known.
- `R2Bucket.get` returns `R2ObjectBody | null` without conditions, and download responses should stream `object.body` instead of buffering the stored object.
- `R2Bucket.delete` accepts one key or an array and is idempotent for reconciliation purposes.
- `R2PutOptions` supports MD5, SHA-1, SHA-256, SHA-384, or SHA-512, but only one checksum may be supplied. Workspace uploads will use SHA-256.
- R2 object keys remain server-only and should contain random public-independent IDs rather than original filenames or member labels.
- The checked Wrangler schema models `r2_buckets` as an array with required `binding`; `bucket_name`, `preview_bucket_name`, `jurisdiction`, and `remote` are optional. The production generator must inject the bucket name while the checked-in configuration stays usable for local/dry-run tests.
- Durable Objects SQLite does not support `PRAGMA user_version`. Track application schema with `_sql_schema_migrations`.
- Use constructor `blockConcurrencyWhile()` only for schema readiness. SQL invariants that require atomicity belong in synchronous `transactionSync()` callbacks; do not hold a SQL transaction or constructor block across R2 I/O.
- The cross-service lifecycle therefore remains reserve metadata -> R2 put/delete -> finalize metadata/outbox. Reconciliation must handle every boundary failure and generation/tombstone checks must prevent resurrection.

## Local test boundary

- `wrangler dev` and the Workers Vitest pool provide local binding simulation by default. Tests must use the local R2 binding and fake Provider only; no remote R2 bucket, live model, synthetic production probe, or local production deployment is permitted.
