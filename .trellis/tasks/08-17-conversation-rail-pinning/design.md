# Design: Conversation rail pinning

Use the existing conversation update method if it already accepts `pinned`; otherwise add the smallest backward-compatible client typing for the existing server field. Sort a derived list by pinned group and then the current recency comparator, leaving canonical server data unchanged.

The rail action is a real button with `aria-pressed` and a localized label. Apply optimistic state only if the current mutation pattern supports safe rollback; otherwise disable during the request and refresh after success. Errors must never remove or expose conversation content.
