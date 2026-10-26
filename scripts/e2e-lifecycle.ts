/**
 * WHITE LINKS — Full lifecycle E2E (live server + direct DB verification)
 * Run: bun scripts/e2e-lifecycle.ts
 * Exercises: registration freeze → matching → messaging/moderation →
 * guessing → reveal → archive. Leaves a fresh demo round for the user.
 */
import { db } from "../src/lib/db";
import { verifyMatching } from "../src/lib/matching";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
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

function client() {
  let cookie = "";
  return {
    async call(path: string, opts?: { method?: string; body?: unknown }) {
      const res = await fetch(`${BASE}${path}`, {
        method: opts?.method ?? "GET",
        headers: {
          ...(opts?.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { cookie } : {}),
        },
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      let data: Record<string, unknown> = {};
      try {
        data = await res.json();
      } catch { /* ignore */ }
      return { status: res.status, data };
    },
  };
}

async function main() {
  // ── 0. Cleanup: archive stale demo rounds stuck mid-setup ──
  await db.round.updateMany({
    where: { isDemo: true, status: { in: ["registration_closed", "matching_pending"] } },
    data: { status: "archived" },
  });

  // ── 1. Admin setup ──
  const admin = client();
  const login = await admin.call("/api/auth/login", {
    method: "POST",
    body: { email: "admin@whitelineissig.me", password: process.env.ADMIN_PASSWORD ?? "WhiteLinks2026!" },
  });
  assert(login.status === 200, "admin authenticated");

  // Fresh demo seed (creates a registration_open demo round if none active)
  await admin.call("/api/admin/demo", { method: "POST" });
  const overview1 = (await admin.call("/api/admin/overview")).data as {
    round: { id: string; status: string } | null;
  };
  const roundId = overview1.round!.id;
  console.log(`  (demo round ${roundId} — ${overview1.round!.status})`);

  // Approve any pending registrations (test members registered earlier)
  const parts = (await admin.call("/api/admin/participants")).data as {
    registrations: { id: string; verificationStatus: string; status: string; category: string }[];
  };
  for (const r of parts.registrations) {
    if (r.verificationStatus === "PENDING" && r.status === "ACTIVE") {
      await admin.call(`/api/admin/participants/${r.id}/action`, { method: "POST", body: { action: "approve" } });
    }
  }

  // Re-read after approvals, then balance categories for the cross-mode demo
  const parts2 = (await admin.call("/api/admin/participants")).data as {
    registrations: { id: string; verificationStatus: string; status: string; category: string; isDemo: boolean }[];
  };
  const active = parts2.registrations.filter((r) => r.status === "ACTIVE" && r.verificationStatus === "APPROVED");
  const countA = active.filter((r) => r.category === "A").length;
  const countB = active.filter((r) => r.category === "B").length;
  const excess = countA > countB ? "A" : "B";
  let toRemove = Math.abs(countA - countB);
  if (toRemove > 0) {
    console.log(`  (balancing groups: removing ${toRemove} extra member(s) from category ${excess})`);
    for (const r of active) {
      if (toRemove === 0) break;
      if (r.category === excess && !r.isDemo) {
        await admin.call(`/api/admin/participants/${r.id}/action`, { method: "POST", body: { action: "remove" } });
        toRemove--;
      }
    }
    // Prefer removing demo members if non-demo were insufficient
    for (const r of active) {
      if (toRemove === 0) break;
      if (r.category === excess && r.isDemo) {
        await admin.call(`/api/admin/participants/${r.id}/action`, { method: "POST", body: { action: "remove" } });
        toRemove--;
      }
    }
  }

  // ── 1. Diagnostics + close registration ──
  const diag = (await admin.call(`/api/admin/rounds/${roundId}/action`, { method: "POST", body: { action: "diagnostics" } })).data as { canMatch: boolean; errors: string[]; byCategory: { A: number; B: number } };
  console.log(`  (diagnostics: A=${diag.byCategory.A} B=${diag.byCategory.B} canMatch=${diag.canMatch})`);

  const close = await admin.call(`/api/admin/rounds/${roundId}/action`, { method: "POST", body: { action: "close_registration" } });
  assert(close.status === 200, "registration closed by admin");

  // ── 2. Finalize matching (requires confirmation) ──
  const noConfirm = await admin.call(`/api/admin/rounds/${roundId}/action`, { method: "POST", body: { action: "finalize_matching" } });
  assert(noConfirm.status === 400 && noConfirm.data.error === "CONFIRMATION_REQUIRED", "finalize without confirm → rejected");

  const fin = (await admin.call(`/api/admin/rounds/${roundId}/action`, { method: "POST", body: { action: "finalize_matching", confirm: true } })).data as { ok: boolean; assigned?: number };
  assert(fin.ok === true && (fin.assigned ?? 0) > 0, `matching finalized (${fin.assigned} assignments)`);

  // Re-run finalize on an ACTIVE round → state machine rejects; assignments untouched (acceptance #8)
  const fin2 = await admin.call(`/api/admin/rounds/${roundId}/action`, { method: "POST", body: { action: "finalize_matching", confirm: true } });
  const assignmentCount = await db.assignment.count({ where: { roundId } });
  assert(fin2.status === 400 && assignmentCount === fin.assigned, `finalize idempotent: rejected re-entry, still ${assignmentCount} assignments`);

  // DB-level invariant verification (acceptance #5, #6, #7)
  const assignments = await db.assignment.findMany({ where: { roundId } });
  const givers = new Set(assignments.map((a) => a.giverId));
  const recips = new Set(assignments.map((a) => a.recipientId));
  const regs = await db.registration.findMany({ where: { roundId, status: "ACTIVE", verificationStatus: "APPROVED" } });
  assert(givers.size === assignments.length && recips.size === assignments.length, "DB: unique givers & unique recipients");
  assert(assignments.every((a) => a.giverId !== a.recipientId), "DB: no self-assignment");
  const round = await db.round.findUnique({ where: { id: roundId } });
  if (round?.matchingMode === "CROSS_CATEGORY") {
    const cat = new Map(regs.map((r) => [r.userId, r.category]));
    assert(assignments.every((a) => cat.get(a.giverId) !== cat.get(a.recipientId)), "DB: all assignments cross A↔B");
  }
  const verify = verifyMatching(
    regs.map((r) => ({ id: r.userId, category: r.category === "B" ? "B" : "A" })),
    assignments.map((a) => ({ giverId: a.giverId, recipientId: a.recipientId, honoredPreference: a.honoredPreference })),
    { mode: round?.matchingMode === "CROSS_CATEGORY" ? "CROSS_CATEGORY" : "OPEN" }
  );
  assert(verify.valid, "DB: full invariant verification passes");

  // ── 3. Messaging + moderation (acceptance #10, #11, #12) ──
  // Pick a pair: yasmine should be someone's giver
  const yasmine = await db.user.findUnique({ where: { email: "yasmine@demo.wlc" } });
  const yasmineAssignment = await db.assignment.findFirst({ where: { roundId, giverId: yasmine!.id } });
  assert(!!yasmineAssignment, "yasmine has an outgoing assignment");

  const yas = client();
  await yas.call("/api/auth/login", { method: "POST", body: { email: "yasmine@demo.wlc", password: "Demo2026!" } });

  // 3a. Allowed friendly message
  const good = await yas.call("/api/me/messages", { method: "POST", body: { destination: "friend", body: "Salut ! J'espère que ta semaine de stage se passe bien 😊 Courage !" } });
  assert(good.status === 200 && (good.data.modStatus === "ALLOWED" || good.data.modStatus === "REVIEW"), `friendly message accepted (${good.data.modStatus ?? good.data.error})`);

  // 3b. Phone number → deterministic reject (acceptance #11)
  const phone = await yas.call("/api/me/messages", { method: "POST", body: { destination: "friend", body: "Appelle-moi au 24 555 123 sinon rien" } });
  assert(phone.status === 422 && phone.data.error === "REJECTED_BY_MODERATION", "contact-sharing message rejected");

  // 3c. Email → reject
  const emailMsg = await yas.call("/api/me/messages", { method: "POST", body: { destination: "friend", body: "écris-moi à yasmine.test@gmail.com" } });
  assert(emailMsg.status === 422, "email in message rejected");

  // 3d. Social handle → reject
  const social = await yas.call("/api/me/messages", { method: "POST", body: { destination: "friend", body: "mon insta c'est @yasmine_officiel" } });
  assert(social.status === 422, "social handle rejected");

  // 3e. No assignment leak in dashboard (acceptance #9, #12)
  const dash = (await yas.call("/api/me/dashboard")).data as Record<string, unknown>;
  const dashStr = JSON.stringify(dash);
  assert(!dashStr.includes("giverId") && !dashStr.includes("recipientId") && !dashStr.includes("assignment"), "dashboard leaks no assignment identifiers");
  assert(!dashStr.includes("+21624551"), "dashboard leaks no phone numbers");

  // 3f. Recipient replies to admirer — routes to giver, not own recipient (acceptance #13)
  const recipientId = yasmineAssignment!.recipientId;
  const recipientUser = await db.user.findUnique({ where: { id: recipientId } });
  const rec = client();
  await rec.call("/api/auth/login", { method: "POST", body: { email: recipientUser!.email, password: "Demo2026!" } });
  const reply = await rec.call("/api/me/messages", { method: "POST", body: { destination: "admirer", body: "Merci pour ton message, il m'a vraiment fait plaisir aujourd'hui ✨" } });
  assert(reply.status === 200 || reply.status === 422, `reply processed by moderation pipeline (${reply.status})`);
  const replyStored = await db.message.findFirst({
    where: { roundId, senderId: recipientId },
    orderBy: { createdAt: "desc" },
  });
  assert(!!replyStored && replyStored.recipientId === yasmine!.id, "reply routed to the actual admirer (giver), not to own recipient");

  // ── 4. Guessing phase (acceptance #14) ──
  const earlyGuess = await yas.call("/api/me/guess", { method: "POST", body: { guessedId: recipientId } });
  assert(earlyGuess.status === 403, "guess rejected while round merely active (before guessing window)");

  await admin.call(`/api/admin/rounds/${roundId}/action`, { method: "POST", body: { action: "open_guessing" } });
  const guessOk = await yas.call("/api/me/guess", { method: "POST", body: { guessedId: recipientId } });
  assert(guessOk.status === 200, "guess submitted during guessing window");
  const guessSelf = await yas.call("/api/me/guess", { method: "POST", body: { guessedId: yasmine!.id } });
  assert(guessSelf.status === 400, "cannot guess yourself");

  // ── 5. Reveal gating (acceptance #16) ──
  const earlyReveal = await admin.call(`/api/admin/rounds/${roundId}/action`, { method: "POST", body: { action: "reveal", confirm: true } });
  assert(earlyReveal.status === 400 && earlyReveal.data.error === "GUESSING_STILL_OPEN", "reveal blocked before guessing deadline");

  // Simulate the end of the window (test harness manipulates dates directly)
  const now = Date.now();
  await db.round.update({
    where: { id: roundId },
    data: {
      gameStart: new Date(now - 13.5 * 24 * 3600 * 1000),
      guessingStart: new Date(now - 6 * 3600 * 1000),
      guessingDeadline: new Date(now - 3600 * 1000),
      gameEnd: new Date(now - 3600 * 1000),
      revealAt: new Date(now - 30 * 60 * 1000),
    },
  });
  const reveal = await admin.call(`/api/admin/rounds/${roundId}/action`, { method: "POST", body: { action: "reveal", confirm: true } });
  assert(reveal.status === 200, "reveal succeeds once deadline passed + admin confirms");

  // Reveal data correct per member
  const revealData = (await yas.call("/api/me/reveal")).data as { revealed: boolean; admirer?: { displayName: string | null }; friend?: { displayName: string | null }; isWinner?: boolean };
  assert(revealData.revealed === true, "reveal data available after official reveal");
  const admirerRow = assignments.find((a) => a.recipientId === yasmine!.id);
  const admirerUser = admirerRow ? await db.user.findUnique({ where: { id: admirerRow.giverId } }) : null;
  assert(revealData.admirer?.displayName === admirerUser?.displayName, `admirer identity matches DB (${revealData.admirer?.displayName})`);

  // ── 6. Archive + fresh demo round for the user ──
  await admin.call(`/api/admin/rounds/${roundId}/action`, { method: "POST", body: { action: "archive" } });
  const seed2 = (await admin.call("/api/admin/demo", { method: "POST" })).data as { ok: boolean; roundId?: string };
  assert(seed2.ok === true && !!seed2.roundId, "fresh demo round created for continued exploration");
  const status2 = (await anon.call("/api/rounds/current")).data as { round: { status: string } | null };
  assert(status2.round?.status === "registration_open", "landing will show an open registration");

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

const anon = client();

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
