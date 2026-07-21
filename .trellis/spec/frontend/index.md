# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

These guidelines describe the transitional legacy browser frontend, the typed React/Vite client under `client/`, and their Cloudflare Worker boundary. Read the relevant topic before editing `client/`, `public/`, `src/worker.ts`, frontend tests, or browser build checks.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Static assets, page controllers, Worker and tests | Ready |
| [Component Guidelines](./component-guidelines.md) | DOM-region rendering and accessibility patterns | Ready |
| [Hook Guidelines](./hook-guidelines.md) | Browser events, lifecycle and fetch patterns | Ready |
| [State Management](./state-management.md) | Module, local-storage and server-state boundaries | Ready |
| [Quality Guidelines](./quality-guidelines.md) | Checks, security, testing and review gates | Ready |
| [Type Safety](./type-safety.md) | Strict Worker TypeScript and runtime validation | Ready |
| [Agent Streaming And Fallback](./agent-streaming.md) | AIChat streaming, route commitment, fallback and telemetry | Ready |
| [User Skill Assignment](./capability-assignment.md) | Per-member Skill projection, validation, and execution enforcement | Ready |

---

## Pre-Development Checklist

- Read `directory-structure.md` before creating or moving frontend files.
- Read `component-guidelines.md`, `hook-guidelines.md`, and `state-management.md` for changes to page behavior.
- Read `type-safety.md` for Worker/API/storage contract changes.
- Read `capability-assignment.md` for user capability fields, Skill selection, or administration assignment changes.
- Read `agent-streaming.md` for AIChat, provider routing, fallback, cancellation, or stream telemetry changes.
- Always read `quality-guidelines.md` before implementation and review.

## Quality Check

- Confirm the implementation matches the applicable topic guides.
- Run every command listed in `quality-guidelines.md` before shipping.
- Verify privacy, conflict handling, accessibility, and release/service-worker contracts when touched.

---

**Language**: All documentation should be written in **English**.
