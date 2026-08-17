# Design: Quota-aware member composer

Keep session ownership in `App` and pass a stable refresh callback with current usage to the member workspace. The turn lifecycle invokes refresh after reaching a terminal state in a `finally`-style path, but usage errors remain secondary to the chat result. Composer state derives `quotaExhausted` only from a complete, numeric server snapshot.

The UI uses the existing session endpoint and does not estimate token consumption locally.
