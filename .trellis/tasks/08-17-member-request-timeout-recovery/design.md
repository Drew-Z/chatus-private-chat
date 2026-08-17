# Design: Member request timeout and recovery

Introduce one timeout-aware wrapper at the lowest shared non-streaming fetch boundary. It will create an internal `AbortController`, forward an external abort signal when present, clear timers/listeners in `finally`, and translate only its own deadline abort into a stable timeout error. Native caller aborts retain their existing semantics.

The default deadline is a client constant chosen to cover normal Worker latency while preventing indefinite hangs. Tests use an injected/overridden short deadline or fake timers. No automatic retry is added because several endpoints mutate state.
