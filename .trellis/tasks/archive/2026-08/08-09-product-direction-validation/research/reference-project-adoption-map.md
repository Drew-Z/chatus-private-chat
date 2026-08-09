# Reference project adoption map

## Scope and source policy

This comparison informs Chatus product direction; it does not authorize source
copying or dependency adoption. Product concepts may be adapted to the existing
Cloudflare-native architecture. Any future code reuse requires a fresh
repository, file-level license, dependency, and security review.

Primary official sources checked on 2026-08-09:

- LobeHub repository and README: <https://github.com/lobehub/lobehub>
- LobeHub license: <https://github.com/lobehub/lobehub/blob/canary/LICENSE>
- DEEIX-Chat repository and README: <https://github.com/DEEIX-AI/DEEIX-Chat>
- DEEIX-Chat license: <https://github.com/DEEIX-AI/DEEIX-Chat/blob/dev/LICENSE>
- Open WebUI repository: <https://github.com/open-webui/open-webui>
- LibreChat repository: <https://github.com/danny-avila/LibreChat>
- Dify repository: <https://github.com/langgenius/dify>

External features and licenses can change. Recheck the exact branch and file
before implementation.

## Chatus comparison boundary

Chatus remains a general private work Agent for a self-hosting owner and trusted
members. Its differentiation is the combination of member isolation, logical
model/Provider governance, bounded fallback, explicit Skill/MCP permissions,
recoverable durable work, secret-safe evidence, and low-operations
Cloudflare-native deployment. It is not a public API proxy or a broad AI app
development platform.

## Adoption matrix

| Project | Adopt now in validation/product decisions | Adapt later only with evidence | Do not pursue as a parity goal |
| --- | --- | --- | --- |
| LobeHub | Agent as the visible unit of work; clear run status; Project/Workspace vocabulary evaluation; inspectable memory and Skill selection | Lightweight project grouping, scheduled work, and a focused Agent builder after repeated workflow demand | Large Agent/Skill marketplace, Agent Groups, broad channel matrix, or wholesale frontend/runtime replacement |
| DEEIX-Chat | Provider/model/route separation; runtime configuration; admin information architecture; request/run/upstream correlation; file/RAG/MCP/usage/audit boundaries | Provider capability metadata, richer cost/usage views, and storage adapters when the current scale proves a need | Go/PostgreSQL/Redis migration for its own sake, enterprise billing/subscription/payment breadth, or multi-node complexity without measured demand |
| Open WebUI | Self-hosted onboarding, member/group permission language, knowledge/file usability, and operator visibility | Additional RBAC grouping or knowledge-base workflows after the 2-10 member baseline | Offline/local-model platform breadth, marketplace breadth, or multi-node operations as default requirements |
| LibreChat | Multi-Provider chat clarity, BYOK boundaries, attachment flow, and familiar message actions | Presets/agents or additional adapters only when a validated workflow needs them | Exhaustive Provider/protocol compatibility or open consumer-chat scope |
| Dify | Explicit workflow/capability contracts, run traces, and separation between configuration and execution | A small visual composition surface only if non-technical owners cannot express a validated recurring workflow otherwise | Turning Chatus into a general enterprise AI-application builder, dataset platform, or hosted marketplace |

## Direct-reference conclusions

### LobeHub

Use LobeHub primarily as a product-interaction reference. Its current direction
organizes work around Agents, Projects, Workspaces, Skills, memory, schedules,
and visible Agent activity. Chatus should test whether these concepts make its
existing capabilities easier to understand, not import the surrounding breadth.

The current repository license is the LobeHub Community License rather than a
plain MIT grant. It is based on Apache 2.0 with additional commercial/derivative
conditions. Repository metadata may still contain older or inconsistent license
labels, so no LobeHub source should be copied based only on a package field or
historical assumption.

### DEEIX-Chat

The relevant project is `DEEIX-AI/DEEIX-Chat`. Its strongest direct reference is
the Provider, model, route, file/RAG, MCP, usage, audit, and administration
boundary. That aligns closely with capabilities Chatus already implements and
is useful for checking whether the current admin UX presents them coherently.

DEEIX-Chat uses Apache License 2.0. Future code reuse would still need to retain
license and copyright notices and mark modifications. Its Go service,
PostgreSQL/Redis options, enterprise billing, and multi-node deployment are not
evidence that Chatus needs the same architecture.

## Decision rules

- `adopt now` means evaluate or improve an existing Chatus product contract; it
  does not automatically mean add a new domain object or copy code.
- `adapt later` requires a repeated failure or demand in the three validated
  workflows and a separately approved Trellis task.
- `do not pursue` means the capability is outside the current differentiation or
  would add platform breadth without solving a validated small-team problem.
- When a competitor pattern conflicts with Chatus security, recovery, delivery,
  or Provider-governance contracts, the Chatus contract wins.
