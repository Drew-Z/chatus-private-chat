# Design: Member model availability UX

Promote model availability from an optional array into a small state object containing data, loading, error, and freshness. The workspace owns fetching/retry; the header receives display-ready state and renders aggregate availability separately from any route-health badge.

Refreshes keep the last successful data and attach a non-destructive stale warning. No new monitoring endpoint or synthetic check is introduced.
