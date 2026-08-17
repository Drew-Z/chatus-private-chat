# Implementation plan: Member request timeout and recovery

1. Identify the common non-streaming JSON request boundary and current error normalization.
2. Add composed abort/deadline handling with unconditional cleanup.
3. Route all ordinary API requests through it without changing streaming transport.
4. Add focused unit tests for timeout classification and caller abort behavior.
5. Run frontend checks, focused tests, typecheck, and `trellis-check`.
