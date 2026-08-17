# Design: Member draft storage resilience

Create a small storage utility with typed safe read/write/remove operations and use it for workspace persistence. Draft state remains React-owned; persistence is scheduled with a short debounce, canceled/replaced as the draft changes, and flushed before conversation identity changes or component teardown when possible.

Failures are deliberately silent from the user's perspective because storage is an enhancement, not a requirement for sending messages. The helper may report a boolean for tests/diagnostics but must not log stored content.
