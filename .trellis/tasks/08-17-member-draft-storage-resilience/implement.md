# Implementation plan: Member draft storage resilience

1. Inventory workspace storage keys and lifecycle reads/writes.
2. Add a content-safe best-effort storage helper.
3. Replace direct calls and debounce draft writes with cleanup/flush behavior.
4. Add unit/component tests with throwing and malformed storage doubles.
5. Run frontend checks, focused tests, typecheck, and `trellis-check`.
