# Runtime Handoff Contract

## States

### ZOYA_ACTIVE
The normal Tauri ZOYA window owns the Carlotta renderer and normal application UI.

### MATE_ACTIVE
The Mate-based desktop companion owns the desktop companion presentation. ZOYA's companion renderer must not run concurrently.

## ZOYA → Mate

1. ZOYA receives a minimize-to-companion request.
2. ZOYA prepares its UI/runtime for handoff.
3. ZOYA launches the Mate companion runtime.
4. ZOYA verifies the companion process has started.
5. ZOYA minimizes/hides its normal window.

## Mate → ZOYA

1. Mate exposes **Maximize ZOYA** in its context menu.
2. Mate requests ZOYA restoration.
3. ZOYA is restored/maximized.
4. Mate exits after ZOYA is confirmed available.

## Safety rules

- Never intentionally run two Carlotta companion renderers at once.
- Do not remove the existing Tauri companion implementation during Phase 1.
- Process startup/shutdown must be recoverable if either runtime exits unexpectedly.
- The Mate runtime must remain replaceable without coupling its Unity implementation to React components.
