// PROOF-04 round-8 finding 1 — companion to eventloop-probe.mjs. That probe
// shows a pending timer cannot fire WHILE an execFileSync() call blocks.
// This probe checks the narrower, more relevant claim for mutate.mjs's
// loop shape: can a pending timer (and, by the same event-loop mechanism,
// a registered signal handler) fire in the brief JS-only GAP BETWEEN two
// consecutive execFileSync() calls, with nothing but ordinary synchronous
// statements in between (exactly what mutate.mjs's for-of loop does
// between one mutant's restore and the next mutant's write)?
//
// Usage: `node measure/windows/proof-04/gap-probe.mjs`
import { execFileSync } from "node:child_process";

const t0 = Date.now();
let fired = false;
setTimeout(() => {
  fired = true;
  console.log(`[timer callback] fired at t+${Date.now() - t0}ms`);
}, 50);
console.log(`t+${Date.now() - t0}ms: starting call 1 (~500ms)`);
execFileSync(process.execPath, ["-e", "const s=Date.now(); while(Date.now()-s<500){}"]);
console.log(`t+${Date.now() - t0}ms: call 1 returned. fired=${fired} (checking the GAP before call 2 starts)`);
console.log(`t+${Date.now() - t0}ms: starting call 2 (~500ms)`);
execFileSync(process.execPath, ["-e", "const s=Date.now(); while(Date.now()-s<500){}"]);
console.log(`t+${Date.now() - t0}ms: call 2 returned. fired=${fired}`);
console.log(`t+${Date.now() - t0}ms: end of synchronous script`);
