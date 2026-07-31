# Parser Workers and Security Research

Date: 2026-07-31

## Decision

Use three narrowly scoped parser dependencies:

- `unpdf@1.8.0` only for text extraction from a conservatively gated PDF subset.
- `@zip.js/zip.js@2.8.34` only through `@zip.js/zip.js/lib/zip-core-reader.js`; do not import the default, writer, filesystem, native, or WASM entry points in production.
- `saxes@6.0.0` only as a namespace-aware event parser around bounded OOXML parts.

The parsers are not security boundaries. Format identification, active-content rejection, resource budgets, output limits, cancellation, Queue state, and Provider isolation remain application-owned. A format is permanently failed when the gate cannot prove that it belongs to the supported subset.

## Package Evidence

| Package | License | Runtime dependencies | Published/modified | Unpacked size | Maintenance/security note |
| --- | --- | --- | --- | ---: | --- |
| `unpdf@1.8.0` | MIT | none; optional peer `@napi-rs/canvas` | 2026-07-24 | 2,141,143 B | Active. Its embedded serverless PDF.js is `6.1.200`; see the CVE decision below. |
| `@zip.js/zip.js@2.8.34` | BSD-3-Clause | none | 2026-07-22 | 4,831,245 B | Active. Reader metadata, strict local/central checks, CRC verification, overlap detection, cancellation, and Web Streams are available. |
| `saxes@6.0.0` | ISC | `xmlchars@^2.2.0` | 2021-11-07; registry metadata modified 2023-07-28 | 163,774 B | Repository is archived. Pure JS/CJS with no DOM, fs, native, or eval dependency. Keep behind a replaceable adapter. |

The GitHub repository advisory endpoints returned no published advisories for unpdf, zip.js, or saxes on 2026-07-31. PDF.js has the two advisories discussed below.

Reproduction commands:

```powershell
npm view unpdf@1.8.0 version license dependencies optionalDependencies peerDependencies dist.unpackedSize dist.fileCount time repository --json
npm view '@zip.js/zip.js@2.8.34' version license dependencies dist.unpackedSize dist.fileCount time repository --json
npm view saxes@6.0.0 version license dependencies dist.unpackedSize dist.fileCount time repository --json
smart-search fetch "https://api.github.com/repos/mozilla/pdf.js/security-advisories?per_page=100" --format content
smart-search fetch "https://api.github.com/repos/unjs/unpdf/security-advisories?per_page=100" --format content
smart-search fetch "https://api.github.com/repos/gildas-lormeau/zip.js/security-advisories?per_page=100" --format content
smart-search fetch "https://api.github.com/repos/lddubeau/saxes/security-advisories?per_page=100" --format content
```

## Workers Experiments

Experiments live under the ignored `.trellis/.runtime/async-ingest-research/` directory. They use no account, live Provider, production Queue/R2, or production deployment.

### Combined parser smoke

The initial Worker imported unpdf, zip.js's default entry, and saxes. TypeScript and Wrangler dry-run passed:

```text
Wrangler 4.116.0
Total Upload: 2726.61 KiB / gzip: 658.44 KiB
No bindings found.
--dry-run: exiting now.
```

Local Workerd results:

```json
{
  "pdf": {
    "attachmentsDetected": true,
    "encodedLaunchRejected": true,
    "javascriptDetected": true,
    "launchRejectedByGate": true,
    "launchVisibleThroughPublicApi": false,
    "objectStreamRejected": true,
    "pages": 1,
    "text": "Hello PDF"
  },
  "xml": {
    "depthRejection": "depth_exceeded",
    "doctypeRejection": "doctype_forbidden",
    "text": "Hello XML"
  },
  "zip": {
    "crcRejection": "Invalid signature",
    "declaredCompressionRatio": 904,
    "nestedDetected": true,
    "pathTraversalDetected": true,
    "text": "<w:document>Hello OOXML</w:document>"
  }
}
```

The default zip.js entry was rejected for production use because it includes inline WASM/worker codecs. A second Worker imported only `lib/zip-core-reader.js`, forced `useCompressionStream: true` and `useWebWorkers: false`, and wrote through a byte-counting `WritableStream`:

```text
Total Upload: 124.19 KiB / gzip: 27.37 KiB
compressed DEFLATE fixture -> 51 expanded bytes
text -> <w:document>Hello Deflate Core</w:document>
```

The reader-only bundle contains fallback worker branches and a WASM URI string, but no WebAssembly payload, native import, `node:fs`, eval, or dynamic `Function`. Runtime options keep the worker branches unreachable.

Important API correction: `checkOverlappingEntryOnly: true` intentionally performs only the overlap check and returns no extracted data. Production extraction must call each accepted entry once with `checkOverlappingEntry: true`; skipped entries may use the check-only form if their ranges still need validation.

### Patched PDF.js experiment

`pdfjs-dist@6.2.108` directly imported from `legacy/build/pdf.mjs` passed TypeScript and dry-run at 1014.55 KiB / gzip 203.84 KiB, but Workerd failed at module startup:

```text
Warning: Cannot polyfill DOMMatrix, rendering may be broken.
Uncaught ReferenceError: DOMMatrix is not defined
```

The official build therefore cannot replace unpdf's serverless build in this Worker. No patched unpdf release or prerelease existed on 2026-07-31.

### Commands

```powershell
npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022 --types @cloudflare/workers-types --skipLibCheck .trellis/.runtime/async-ingest-research/index.ts
npx wrangler deploy --dry-run -c .trellis/.runtime/async-ingest-research/wrangler.jsonc --outfile .trellis/.runtime/async-ingest-research/bundle.js --metafile .trellis/.runtime/async-ingest-research/bundle-meta.json
npx wrangler dev -c .trellis/.runtime/async-ingest-research/wrangler.jsonc --local
npx wrangler deploy --dry-run -c .trellis/.runtime/async-ingest-research/wrangler-zip-core.jsonc --outfile .trellis/.runtime/async-ingest-research/zip-core-bundle.js --metafile .trellis/.runtime/async-ingest-research/zip-core-meta.json
npx wrangler dev -c .trellis/.runtime/async-ingest-research/wrangler-zip-core.jsonc --local
```

## PDF CVE Decision

Unpdf `1.8.0` embeds PDF.js `6.1.200`. GitHub advisory `GHSA-hq66-cqwq-w95j` / `CVE-2026-16633`, published 2026-07-28, marks `pdfjs-dist >=5.6.83` vulnerable and `6.2.108` patched. The reported execution condition is a malicious PDF opened with viewer `enableScripting=true` and no script-blocking CSP.

Chatus does not instantiate the PDF.js viewer or scripting manager. More importantly, untrusted bytes do not reach unpdf until an application-owned lexical gate has decoded PDF name escapes and rejected all of these names:

```text
AA EmbeddedFile Encrypt Filespec ImportData JS JavaScript Launch ObjStm
OpenAction RichMedia SubmitForm XFA
```

Rejecting `ObjStm` is required: otherwise active dictionaries can be hidden inside compressed object streams and a raw name scan cannot prove the subset safe. The gate also rejects malformed names, encrypted PDFs, non-PDF magic, excessive indirect object declarations, and page/object/output/deadline limits. Tests must include escaped names such as `/Lau#6ech` and ensure rejection happens before unpdf is called.

This makes the advisory's script-bearing input and viewer execution path unreachable in Chatus. This is a conditional acceptance, not a claim that PDF.js `6.1.200` is generally safe. Upgrade unpdf as soon as its embedded PDF.js is at least `6.2.108`, rerun the malicious suite, and remove only those restrictions that a patched structured scanner can replace. If the lexical gate or pre-unpdf call ordering cannot be proven by tests, PDF support remains permanent-failed rather than shipping the parser.

`GHSA-wgrm-67xf-hhpq` / `CVE-2024-4367` affects PDF.js through `4.1.392` and is not applicable to the embedded version. The bundled output contained no `eval(` or dynamic `Function(` occurrence.

Sources:

- <https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j>
- <https://api.github.com/repos/mozilla/pdf.js/security-advisories?per_page=100>
- <https://github.com/unjs/unpdf>
- <https://raw.githubusercontent.com/unjs/unpdf/main/pdfjs.rolldown.config.ts>

## OOXML Security Contract

Before extraction:

- Require extension, MIME, ZIP magic, `[Content_Types].xml`, and package root agreement.
- Allow only methods 0 (store) and 8 (deflate); reject encryption, Zip64, split archives, duplicate normalized names, absolute paths, `..`, NUL, ambiguity, overlap, invalid CRC, appended/prepended payloads, and nested archive extension or magic.
- Reject macro-enabled content types, `vbaProject.bin`, ActiveX, OLE, embeddings, embedded packages, scripts, and any external relationship.
- Resolve OPC relationship targets inside the package root and allow only format-specific relationship types and part paths.
- Use strict local/central-directory agreement, CRC verification, overlap detection, `AbortSignal`, native `DecompressionStream`, and byte-counting `WritableStream` output.

Saxes rules:

- Use `xmlns: true` and match namespace URI plus local name, never attacker-controlled prefixes.
- Reject DOCTYPE immediately; never modify `parser.ENTITIES`; rethrow every parse error.
- Decode only UTF-8 with a fatal streaming `TextDecoder`.
- Maintain depth, element, attribute, domain-object, input-byte, output-character, and elapsed-time counters in application code.
- Create a new parser per XML part. Saxes removed its historical internal maximum-buffer guard, so ZIP part limits are mandatory.

The final implementation additionally requires the format-specific main-part override in `[Content_Types].xml`, one matching root `officeDocument` relationship, resolvable in-package internal relationship targets, and a conservative relationship namespace allow-list. A macro-enabled main content type is permanently rejected even when the archive omits an obvious `vbaProject.bin` entry.

## Final Resource Budgets

These constants are centralized and boundary-tested. The implementation tightened the exploratory limits where practical; the 10 MiB document upload and 250 MiB member limits remain the higher-level admission contract.

| Resource | Limit |
| --- | ---: |
| Upload selection | 50 files |
| Queue consumer batch / concurrency | 1 / 1 |
| Turn references | 10 exact versions |
| Text input | 1 MiB |
| PDF/Office input | 10 MiB |
| PDF pages | 200 |
| PDF indirect objects without `ObjStm` | 10,000 |
| ZIP entries | 512 |
| ZIP single expanded entry | 8 MiB |
| ZIP total expanded bytes | 32 MiB |
| ZIP declared/actual compression ratio | 100:1 |
| XML depth | 64 |
| XML elements per part | 100,000 |
| XML attributes per element | 128 |
| XML attributes per part | 200,000 |
| OOXML rows | 100,000 |
| OOXML cells | 50,000 |
| PPTX slides | 500 |
| Extracted output | 200,000 characters |
| Parser wall deadline | 5 seconds with periodic checks |

Central-directory sizes are attacker declarations and only provide an early rejection. Actual expanded bytes from the writable stream are authoritative. `Promise.race` is not a CPU preemption mechanism; cancellation checks and the Workers CPU limit are the final containment boundary.

Final repository dry-run after integration:

```text
Wrangler 4.110.0
Total Upload: 6373.10 KiB / gzip: 1293.30 KiB
Bindings: DOCUMENT_INGEST Queue, WORKSPACE_FILES R2, existing SQLite Durable Objects/KV/Assets
--dry-run: exiting now.
```

This is the complete application bundle, not the isolated parser experiment. The dry-run used the generic checked-in config and no Cloudflare account, remote Queue/R2, live model, or production deployment.

## Provider Boundary

Only UTF-8 extracted text from a `ready` exact generation may reach the fake or real Provider adapter. The resolver must verify extracted-object size and checksum, recheck authorization/tombstones, and cap the total turn characters. Original PDF/OOXML bytes, parser errors, object keys, native file parts, queued/failed/deleted versions, and active-content documents never cross that boundary.

An `extracting` generation owns a 60-second SQLite lease. Duplicate delivery waits; an expired lease may be reclaimed only by the same file/version/generation. This closes the Worker-termination window without using Queue message IDs as a business idempotency key.
