// PROOF-04 round-8 finding 1 — does a blocking execFileSync() call starve
// the Node.js event loop for its whole duration, or can a pending JS
// callback (a timer, and by the same mechanism a registered signal
// handler) run while it blocks?
//
// mutate.mjs (measure/windows/proof-04/mutate.mjs) mutates a source file to
// disk, then calls execFileSync() to run the test suite against the
// mutant, then restores the original file in a `finally`. A round-7 ADR
// revision additionally claimed process.on("SIGINT"/"SIGTERM") handlers
// "do receive and can act on" a Ctrl-C during that same window. This probe
// checks that claim directly instead of asserting it: schedule a 50ms
// setTimeout immediately before a ~2000ms execFileSync, then observe when
// the timer callback actually runs.
//
// Usage: `node measure/windows/proof-04/eventloop-probe.mjs`
import { execFileSync } from "node:child_process";

const t0 = Date.now();
let fired = "NOT YET (still pending)";
setTimeout(() => {
  fired = `fired at t+${Date.now() - t0}ms`;
  console.log(`50ms timer actually fired at: ${fired}`);
}, 50);
console.log(`t0=${t0}, scheduling execFileSync for ~2000ms of blocking work now`);
execFileSync(process.execPath, ["-e", "const start=Date.now(); while(Date.now()-start<2000){}"]);
console.log(`execFileSync returned at t+${Date.now() - t0}ms`);
console.log(`50ms timer actually fired at: ${fired}`);
