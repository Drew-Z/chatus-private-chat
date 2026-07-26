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
| [Component Guidelines](./component-guidelines.md) | DOM-region rendering, accessibility, and provider/logical-model administration | Ready |
| [Hook Guidelines](./hook-guidelines.md) | Browser events, lifecycle and fetch patterns | Ready |
| [State Management](./state-management.md) | Module, local-storage and server-state boundaries | Ready |
| [Quality Guidelines](./quality-guidelines.md) | Checks, security, testing and review gates | Ready |
| [Type Safety](./type-safety.md) | Strict Worker TypeScript and runtime validation | Ready |
| [Agent Streaming And Fallback](./agent-streaming.md) | AIChat streaming, route commitment, fallback and telemetry | Ready |
| [Multimodal Image Input](./multimodal-image-input.md) | Capability-aware image drafts, strict normalization, Agent persistence, provider conversion, and privacy | Ready |
| [Text File Attachments](./file-attachments.md) | Member-only UTF-8 file context uploads, mixed attachment drafts, deterministic provider text, and guest denial | Ready |
| [Member And Registry Capabilities](./capability-assignment.md) | Per-member assignment plus typed Skill, tool, MCP, secret, and discovery administration contracts | Ready |
| [Public Guest Access](./public-guest-access.md) | Restricted anonymous sessions, single public route enforcement, guest capability denial, quotas, cleanup, and workspace projection | Ready |

---

## Pre-Development Checklist

- Read `directory-structure.md` before creating or moving frontend files.
- Read `component-guidelines.md`, `hook-guidelines.md`, and `state-management.md` for changes to page behavior.
- Read `type-safety.md` for Worker/API/storage contract changes.
- Read `capability-assignment.md` for user capability fields, Skill selection, or administration assignment changes.
- Read `public-guest-access.md` for anonymous access, public route gating, guest capability projection, quotas, or cleanup changes.
- Read `agent-streaming.md` for AIChat, provider routing, fallback, cancellation, or stream telemetry changes.
- Read `multimodal-image-input.md` for image policy, composer attachments, Agent file parts, provider image conversion, or image export/deletion changes.
- Read `file-attachments.md` for generic file upload, `fileInput` policy, mixed attachment drafts, deterministic attached-file text, Agent persistence, or guest file denial changes.
- Read `component-guidelines.md` and `type-safety.md` for provider registry, model discovery, logical model, or offering editor changes.
- Always read `quality-guidelines.md` before implementation and review.

## Quality Check

- Confirm the implementation matches the applicable topic guides.
- Run every command listed in `quality-guidelines.md` before shipping.
- Verify privacy, conflict handling, accessibility, and release/service-worker contracts when touched.

---

**Language**: All documentation should be written in **English**.
