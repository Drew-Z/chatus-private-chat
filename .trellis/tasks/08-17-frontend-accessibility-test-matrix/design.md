# Design: Frontend accessibility test matrix

Keep visual-width scenarios data-driven rather than duplicating specs. Separate broad Chromium visual coverage from a smaller cross-engine semantic smoke suite to control runtime. Add axe-based scans if the dependency footprint is acceptable; otherwise use a locally bundled equivalent with the same violation-reporting contract.

Define projects for default motion and reduced motion instead of globally forcing reduced motion. Route interception must reject unhandled chat/provider endpoints so a fixture mistake cannot create model traffic.
