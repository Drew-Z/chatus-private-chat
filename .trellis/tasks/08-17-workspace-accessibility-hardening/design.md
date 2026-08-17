# Design: Workspace accessibility hardening

Strengthen the shared focus-ring tokens rather than styling individual controls. Expand interactive hit boxes through shared control classes while keeping visual icon sizes unchanged. Remove `aria-live` from the transcript container and expose a visually hidden, atomic status element whose text changes only for meaningful lifecycle events.

CSS transitions and programmatic scrolling continue to honor `prefers-reduced-motion`. Tests assert semantics and computed layout contracts rather than fragile color snapshots where possible.
