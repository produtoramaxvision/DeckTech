// PROOF-01 round-8 support probe: discriminates a MISSING Start Menu root
// from an UNREADABLE (exists, but access-denied) one, using exactly the two
// Node calls list-apps.mjs itself relies on — existsSync() (the missing-root
// gate) and readdirSync() (the enumeration step where an unreadable root or
// subdirectory throws). This exists so the round-8 ADR evidence block that
// discriminates the two branches (round-7 finding 1's fatal-root claim had
// no run behind it; round-8 finding 1 closed that gap) is reproducible on
// any machine, not just pasted output from a session whose scratch directory
// is gone by the time someone reads the ADR.
//
// Usage: node scripts/probe-root-readability.mjs <path-to-check>
//
// Expected outputs:
//   existsSync: false                              -> path does not exist at
//                                                      all (list-apps.mjs's
//                                                      missing-root branch)
//   existsSync: true, readdirSync succeeded         -> readable root (normal
//                                                      case)
//   existsSync: true, readdirSync FAILED (EPERM/    -> exists but unreadable
//   EACCES/...)                                        (list-apps.mjs's
//                                                      root-unreadable
//                                                      branch — the one
//                                                      round-7 claimed was
//                                                      fatal but never ran)
import { existsSync, readdirSync } from "node:fs";

const root = process.argv[2];
if (!root) {
  console.error("[probe-root-readability] usage: node scripts/probe-root-readability.mjs <path>");
  process.exit(1);
}

console.log("root arg:", JSON.stringify(root));
console.log("existsSync:", existsSync(root));
try {
  const entries = readdirSync(root, { withFileTypes: true });
  console.log("readdirSync succeeded:", entries.length);
} catch (err) {
  console.log("readdirSync FAILED:", err.code, err.errno, err.message);
}
