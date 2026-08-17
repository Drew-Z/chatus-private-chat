# Design: Admin model monitor UX resilience

Derive monitor-group filtering from the same normalized query used by other operations content. Enhance trend rows/bars with outcome segmentation or an adjacent success-rate/error measure and a textual summary for non-visual users.

Replace monolithic loading failure behavior with per-section result state. Shared loading may remain, but request settlement must preserve successful sections when peers fail. This child is frontend-only with respect to rollout governance: legacy API calls and controls are explicit no-touch zones.
