# Implementation plan: Frontend accessibility test matrix

1. Inspect Playwright projects, CI install commands, and existing route fixtures.
2. Add intermediate-width data cases and motion variants.
3. Add an accessibility scan dependency/helper and representative member/admin assertions.
4. Add a bounded non-Chromium smoke project and explicit provider-request guard.
5. Run the affected browser suites without live endpoints, then `trellis-check`.
