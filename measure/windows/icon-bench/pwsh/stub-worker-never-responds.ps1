# Test stub for scripts/verify-pwsh-failure-modes.mjs. Signals READY
# immediately (so PwshPool.start() succeeds) but then deliberately never
# responds to any request — simulates a worker stuck on a slow/hung
# extraction call, to prove the per-REQUEST timeout (not just the
# process-death path) actually fires.
[Console]::Out.WriteLine("READY")
[Console]::Out.Flush()
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    Start-Sleep -Seconds 3600
}
