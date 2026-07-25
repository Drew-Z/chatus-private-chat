# Product Boundary Reconciliation

## Goal

Reconcile the parent productization task with the current shipped product boundary: Chatus is a standalone teammate work Agent with an optional, restricted public guest entry. Guests may use exactly one administrator-selected logical model under strict limits, while member-only work capabilities remain access-code gated.

## Background

- Before this task, the parent PRD described the product as fully non-anonymous and listed anonymous service as out of scope.
- The archived public guest child task and current code/docs intentionally added constrained anonymous sessions with one public route.
- README, operations docs, self-hosting docs, and frontend specs already describe the restricted guest model, so the parent task is now the inconsistent source.

## Requirements

### R1. Product Boundary

- Preserve Chatus as an independent web Agent, not a BIAU Operator subpage and not an OpenAI-compatible public API proxy.
- Define the public surface as a restricted guest entry, disabled by default, exposing at most one administrator-selected logical model.
- Keep full work capabilities behind member access-code login: assigned routes, Skills, tools, MCP, memory, feedback, export, file uploads, BYOK, and account controls.
- Public self-registration remains out of scope. Becoming a member still requires administrator-issued access.

### R2. Documentation Alignment

- Update the parent PRD and implementation plan so acceptance criteria no longer conflict with shipped guest access.
- Ensure README positioning does not describe the product as member-only while also documenting public guests.
- Do not weaken the guest security contract in `.trellis/spec/frontend/public-guest-access.md`.

### R3. Scope Control

- Do not change runtime code, quotas, guest config, provider routing, or authentication behavior in this task.
- Do not add public self-registration, payment, identity-provider login, or an OpenAI-compatible proxy API.
- Do not retire legacy surfaces or perform production deployment.

## Acceptance Criteria

- [x] Parent PRD R1, acceptance criteria, and out-of-scope language explicitly distinguish restricted guest entry from public registration/open consumer chat.
- [x] Parent implementation plan uses the same boundary language.
- [x] README product positioning is consistent with the restricted-guest/member-workspace model.
- [x] A grep for conflicting parent/product docs finds no remaining member-only/no-guest wording that contradicts the guest feature.
- [x] Trellis task validation and `git diff --check` pass.
