# Implementation plan: Member model availability UX

1. Trace the current availability and route-health data paths.
2. Replace swallowed errors with explicit workspace state and a retry action.
3. Separate header labels/presentation for availability and route health.
4. Add component tests for every availability state.
5. Run frontend checks, focused tests, typecheck, and `trellis-check`.
