/**
 * WHITE LINKS — Matching engine automated tests (acceptance tests 4–8, 17)
 * Run: bun scripts/test-matching.ts
 */
import { generateMatching, verifyMatching } from "../src/lib/matching";
import type { MatchParticipant } from "../src/lib/matching";

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${name}`);
  }
}

function mk(n: number, splitAt?: number): MatchParticipant[] {
  const half = splitAt ?? Math.ceil(n / 2);
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    category: i < half ? "A" : "B",
  }));
}

console.log("— Open mode basics —");
{
  const parts = mk(10);
  const res = generateMatching(parts, { mode: "OPEN" });
  assert(res.ok, "generates a matching for 10 participants");
  const v = verifyMatching(parts, res.pairs, { mode: "OPEN" });
  assert(v.valid, "invariants hold: bijection, no self, no dupes");
  assert(res.stats.reciprocalPairs === 0, "reciprocal pairs minimized to 0 for n=10");
}

console.log("— Deterministic uniqueness of givers/recipients across runs —");
for (let run = 0; run < 20; run++) {
  const parts = mk(8, 4);
  const res = generateMatching(parts, { mode: "OPEN" });
  const givers = new Set(res.pairs.map((p) => p.giverId));
  const recips = new Set(res.pairs.map((p) => p.recipientId));
  if (givers.size !== 8 || recips.size !== 8 || !res.ok) {
    assert(false, `run ${run}: unique givers & recipients`);
    break;
  }
  if (run === 19) assert(true, "20 runs × 8 participants: unique givers & recipients every time");
}

console.log("— No self-assignment (small n, stress) —");
{
  let allOk = true;
  for (let i = 0; i < 50; i++) {
    const parts = mk(5, 2);
    const res = generateMatching(parts, { mode: "OPEN" });
    if (!res.ok) { allOk = false; break; }
    if (res.pairs.some((p) => p.giverId === p.recipientId)) { allOk = false; break; }
  }
  assert(allOk, "50 stress runs with n=5: never self-assigns, always valid");
}

console.log("— Cross-category mode —");
{
  const parts = mk(10, 5);
  const res = generateMatching(parts, { mode: "CROSS_CATEGORY" });
  assert(res.ok, "cross-category matching with balanced groups");
  const v = verifyMatching(parts, res.pairs, { mode: "CROSS_CATEGORY" });
  assert(v.valid, "cross-category invariants hold");
}
{
  const parts = mk(9, 5); // 5 A vs 4 B
  const res = generateMatching(parts, { mode: "CROSS_CATEGORY" });
  assert(!res.ok && res.errors[0].startsWith("GROUP_IMBALANCE"), "refuses unbalanced groups with clear error (acceptance #4)");
}
{
  const parts = mk(8, 4);
  let crossOk = true;
  for (let i = 0; i < 30; i++) {
    const res = generateMatching(parts, { mode: "CROSS_CATEGORY" });
    if (!res.ok || res.pairs.some((p) => {
      const a = parseInt(p.giverId.slice(1)) < 4;
      const b = parseInt(p.recipientId.slice(1)) < 4;
      return a === b;
    })) {
      crossOk = false;
      break;
    }
  }
  assert(crossOk, "30 stress runs: every assignment crosses A↔B");
}

console.log("— Too few participants —");
{
  const res = generateMatching(mk(3), { mode: "OPEN" });
  assert(!res.ok && res.errors[0].startsWith("TOO_FEW_PARTICIPANTS"), "refuses n<4 with TOO_FEW_PARTICIPANTS");
}

console.log("— Exclusions respected —");
{
  const parts = mk(8);
  const res = generateMatching(parts, { mode: "OPEN", exclusions: { p0: ["p1", "p2", "p3"] } });
  assert(res.ok, "matching succeeds with exclusions");
  assert(!res.pairs.some((p) => p.giverId === "p0" && ["p1", "p2", "p3"].includes(p.recipientId)), "excluded pair never assigned");
}

console.log("— Reward preferences (acceptance #17) —");
{
  const parts = mk(12, 6);
  const res = generateMatching(parts, {
    mode: "OPEN",
    preferences: [
      { winnerId: "p0", rankedTargets: ["p6", "p7", "p8"] },
      { winnerId: "p1", rankedTargets: ["p6"] }, // conflict on p6
      { winnerId: "p2", rankedTargets: ["p9"] },
    ],
  });
  assert(res.ok, "matching succeeds with conflicting preferences");
  const v = verifyMatching(parts, res.pairs, { mode: "OPEN" });
  assert(v.valid, "invariants preserved despite preferences");
  assert(res.stats.honoredPreferences >= 2, `at least 2 of 3 preferences honored (${res.stats.honoredPreferences})`);
  const p6Givers = res.pairs.filter((p) => p.recipientId === "p6");
  assert(p6Givers.length === 1, "conflict target receives exactly one giver");
}

console.log("— Impossible constraints → clear error, never silent violation —");
{
  const parts = mk(6, 3);
  const res = generateMatching(parts, {
    mode: "CROSS_CATEGORY",
    exclusions: { p0: ["p3", "p4", "p5"] },
  });
  assert(!res.ok && res.errors.length > 0, "impossible constraint returns explicit error");
}

console.log("— Idempotent verification (acceptance #8 logic) —");
{
  const parts = mk(10);
  const res = generateMatching(parts, { mode: "OPEN" });
  const first = verifyMatching(parts, res.pairs, { mode: "OPEN" });
  const second = verifyMatching(parts, res.pairs, { mode: "OPEN" });
  assert(first.valid && second.valid && first.errors.length === 0 && second.errors.length === 0, "re-verification is stable (no state drift)");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
