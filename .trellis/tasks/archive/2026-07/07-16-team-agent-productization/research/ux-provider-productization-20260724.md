# UX And Provider-Pool Productization Research

## Scope

Reviewed on 2026-07-24 after the typed React client was exercised with the `bill` member. The review covers message actions, slow or apparently non-streaming responses, model/provider administration, and comparable open-source products.

## Repository Evidence

- The legacy client already implements branch-preserving actions: create branch, edit and resend a user message, regenerate an assistant response, continue a length-truncated response, feedback, and retry after an error (`public/app.js:2405-2422`, `public/app.js:2624-2895`).
- The typed React message surface currently renders only one copy action (`client/src/components/MessageView.tsx:9-79`). The typed chat hook already exposes `setMessages`, `regenerate`, `stop`, `resumeStream`, and `sendMessage` through the installed AI SDK (`node_modules/@ai-sdk/react/src/use-chat.ts:15-47,157-184`), but `ChatWorkspace` currently uses only `sendMessage` and `stop` (`client/src/components/ChatWorkspace.tsx:390-407,434-468`).
- The typed client has a submitted/recovering status line, but no explicit first-token/queue phase (`client/src/components/ChatWorkspace.tsx:351,468`). A provider fallback intentionally primes the stream until the first visible part before committing a candidate (`src/services/fallback-language-model.ts:80-165`). This protects pre-output fallback but can make time-to-first-token feel like a stalled request when the upstream is slow or returns a non-streaming response.
- The backend provider pool is implemented: logical routes resolve multiple provider offerings, provider-wide exclusive/bounded leases are coordinated by Durable Objects, and candidates are ordered by administrator priority plus passive quality (`src/services/provider-router.ts`, `src/services/provider-lease.ts`, `src/services/route-reliability.ts`).
- Provider and offering administration remains in the legacy full backend (`public/admin.html:210-374`, `public/admin.js:1681-1989,2933-2982`); the typed admin currently focuses on member assignment and links to the full backend. Consequently the runtime pool exists, but the product-facing provider inventory, health, and route-to-offering workflow is still fragmented.
- Logical route labels are not necessarily upstream model IDs: the public route projection uses the route label while the provider offering carries the actual upstream model (`src/worker.ts:4418-4424`, `src/services/provider-router.ts:219-247`). A route can therefore look correct in the chat while an upstream model or endpoint is incompatible.

## External References

The following sources were fetched through Smart Search and should be treated as design references, not dependencies:

- assistant-ui ActionBar: <https://www.assistant-ui.com/docs/primitives/action-bar>
- assistant-ui message editing: <https://www.assistant-ui.com/docs/guides/editing>
- assistant-ui branching: <https://www.assistant-ui.com/docs/guides/branching>
- Vercel Chatbot message layout and thinking state: <https://github.com/vercel/chatbot/blob/main/components/chat/messages.tsx>
- Vercel Chatbot message actions/rendering: <https://github.com/vercel/chatbot/blob/main/components/chat/message.tsx>
- LibreChat README/features: <https://github.com/danny-avila/LibreChat>
- Open WebUI README/features: <https://github.com/open-webui/open-webui>
- LobeHub/LobeChat README/features: <https://github.com/lobehub/lobehub>
- LiteLLM routing and reliability docs: <https://docs.litellm.ai/docs/routing> and <https://docs.litellm.ai/docs/proxy/reliability>
- CLIProxyAPI provider-pool reference: <https://github.com/router-for-me/CLIProxyAPI>

## Reusable Patterns

1. Message actions are grouped in a compact, keyboard-accessible action bar. Copy is only one action; assistant messages normally also expose regenerate, feedback, and an overflow menu, while user messages expose edit/resend. Actions disable while a run is active and remain discoverable on touch layouts.
2. Editing a historical user message and regenerating an assistant response create a branch rather than destructively rewriting the visible transcript. A branch picker lets users move between alternatives without losing the original.
3. Slow generation has an explicit thinking/queued state before the first token, followed by streaming text updates and a stop control. The UI distinguishes submitted, waiting, streaming, recovering, and failed states.
4. Provider management is separated into a provider registry and logical model groups. One visible model alias can have multiple provider deployments; routing policies, fallback, retries, capacity, and health are managed behind that alias. Administrators should see offering order, credential readiness, latency/quality evidence, and recent failure class without seeing secrets.
5. Model discovery is provider-scoped and feeds offerings into a logical model editor. A user-facing picker should show logical models and a compact health/availability signal, not expose every physical credential or endpoint.

## Design Decisions For Chatus

- Keep the current Durable Object provider coordinator and route/provider quality telemetry; do not replace it with an external proxy in this slice.
- Treat the logical model/provider pool as a first-class admin workflow. The first release can keep the legacy backend as an implementation fallback, but the typed admin should expose provider inventory, logical models, offerings, credential status, capacity policy, and passive health in one navigable surface.
- Port the legacy branch semantics to the Agent model. Prefer a server-owned branch operation that copies a bounded transcript prefix into a new conversation with `parentChatId`; do not rely on client-only `setMessages` for durable history.
- Add explicit stream phases and elapsed/first-token telemetry to the client. Do not claim streaming when an upstream returns a single buffered response; report that state as `等待首字`/`已收到完整响应` and keep the stop/retry behavior clear.
- Preserve the existing no-fallback-after-visible-output and quota-once contracts. UI retry/regenerate is a new user-approved turn and must create a branch or an explicit replacement record, not silently reuse a consumed quota unit.

## Evidence Caveats

- Competitor feature summaries are based on official documentation or source pages fetched on 2026-07-24; exact current UI details can change and must be rechecked when implementation begins.
- The repository evidence is authoritative for Chatus. The apparent non-streaming behavior still needs a production route-status/trace sample to distinguish upstream buffering from client rendering or proxy buffering.
