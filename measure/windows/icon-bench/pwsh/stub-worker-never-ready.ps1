# Test stub for scripts/verify-pwsh-failure-modes.mjs. Deliberately never
# prints READY — simulates a worker that started (process alive, not dead)
# but is stuck compiling / hung before signaling ready, to prove
# PwshPool.start()'s own ready-timeout (distinct from the process-death
# path) actually fires.
Start-Sleep -Seconds 3600
