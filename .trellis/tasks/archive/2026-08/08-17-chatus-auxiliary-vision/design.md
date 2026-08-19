# Auxiliary Vision Design

## Routing

The server derives image mode from the selected logical route, executable
offerings, member augmentation assignment, and helper readiness. Native routes
keep the current path. Tool-capable text routes force a request-bound trusted
`image_inspect` tool; no-tool text routes obtain evidence before constructing the
main Provider history. Helper fallback is limited to native-image offerings
inside its configured logical route.

## Provider Sequence

- Tool path: `main_answer` forced tool request -> `auxiliary_vision` ->
  `tool_continuation`.
- Pre-answer path: `auxiliary_vision` -> `main_answer`.

Every physical call uses the admitted turn budget, absolute deadline, capacity
lease, credential rules, usage capture, and required ledger settlement. A forced
tool refusal fails before visible answer output.

## Evidence And Lifecycle

The helper returns exact versioned JSON with bounded description, OCR lines, and
limitations. Only normalized evidence may be stored privately against validated
source image message IDs. Member export excludes it. Administrative capture and
restore include and revalidate it; orphan evidence is dropped. Branch copies
only evidence for copied source images, and conversation deletion removes it.

## Failure And Rollback

Configuration, admission, helper, decoding, timeout, and cancellation failures
settle before unsupported main I/O. Late completion cannot persist evidence or
start the main call. Disabling helper configuration returns assisted modes to
`none`; native behavior and stored conversations remain valid.
