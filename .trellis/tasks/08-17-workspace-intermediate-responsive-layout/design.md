# Design: Workspace intermediate responsive layout

Use two intermediate layout bands. At medium widths, keep the conversation rail but convert the inspector to an overlay/drawer. At narrower tablet widths, both auxiliary panels become dismissible overlays and the chat owns the full grid track. Persisted open state may request a panel, but responsive CSS/state reconciliation decides whether it consumes a column.

Use CSS grid `minmax()` and explicit `min-width: 0` contracts so content cannot force overflow. Existing mobile and wide breakpoints remain compatible.
