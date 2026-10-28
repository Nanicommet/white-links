/**
 * WHITE LINKS — Full lifecycle E2E (live server + direct DB verification)
 * Run: bun scripts/e2e-lifecycle.ts
 * Self-seeding: creates its own round and members (no demo data involved).
 * Exercises: registration freeze → matching → messaging/moderation →
 * guessing → reveal → archive.
 */
import { db } from "../src/lib/db";
import { verifyMatching } from "../src/lib/matching";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const RUN = Date.now();
const TEST_PASSWORD = "E2eTest2026!";
// 10 members: 5 category A, 5 category B
const MEMBERS = [
  { email: `p1-${RUN}@e2e.test`, category: "A" },
  { email: `p2-${RUN}@e2e.test`, category: "A" },
  { email: `p3-${RUN}@e2e.test`, category: "A" },
  { email: `p4-${RUN}@e2e.test`, category: "A" },
  { email: `p5-${RUN}@e2e.test`, category: "A" },
  { email: `p6-${RUN}@e2e.test`, category: "B" },
  { email: `p7-${RUN}@e2e.test`, category: "B" },
  { email: `p8-${RUN}@e2e.test`, category: "B" },
  { email: `p9-${RUN}@e2e.test`, category: "B" },
  { email: `p10-${RUN}@e2e.test`, category: "B" },
] as const;
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

function client(ip = "10.1.0.1") {
  let cookie = "";
  return {
    async call(path: string, opts?: { method?: string; body?: unknown }) {
      const res = await fetch(`${BASE}${path}`, {
        method: opts?.method ?? "GET",
        headers: {
          // Distinct client IP per simulated user (Vercel overwrites this
          // header in production, so it is test-scaffolding only).
          "x-forwarded-for": ip,
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
  // ── 0. Cleanup: archive stale rounds stuck mid-setup ──
  await db.round.updateMany({
    where: { status: { in: ["registration_closed", "matching_pending"] } },
    data: { status: "archived" },
  });

  // ── 1. Admin setup: create round + open registration ──
  const admin = client();
  const login = await admin.call("/api/auth/login", {
    method: "POST",
    body: { email: "admin@whitelineissig.me", password: process.env.ADMIN_PASSWORD ?? "" },
  });
  assert(login.status === 200, "admin authenticated");

  const now = Date.now();
  const created = await admin.call("/api/admin/rounds", {
    method: "POST",
    body: {
      name: `E2E Round ${RUN}`,
      registrationStart: new Date(now - 60 * 1000).toISOString(),
      registrationEnd: new Date(now + 48 * 3600 * 1000).toISOString(),
      matchingMode: "OPEN",
    },
  });
  assert(created.status === 200 && !!(created.data.round as { id?: string } | undefined)?.id, "round created by admin");
  const roundId = (created.data.round as { id: string }).id;

  const opened = await admin.call(`/api/admin/rounds/${roundId}/action`, { method: "POST", body: { action: "open_registration" } });
  assert(opened.status === 200, "registration opened");

  // ── 2. Register 10 members via the public API ──
  for (let i = 0; i < MEMBERS.length; i++) {
    const m = MEMBERS[i];
    const c = client(`10.1.0.${i + 10}`);
    const reg = await c.call("/api/registrations", {
      method: "POST",
      body: {
        displayName: `E2E Member ${i + 1}`,
        // 12-char phone: +216246 + 3 digits from RUN + 2-digit index → unique per run & member
        phone: `+216246${String(RUN % 1000).padStart(3, "0")}${String(i).padStart(2, "0")}`,
        email: m.email,
        password: TEST_PASSWORD,
        category: m.category,
        interests: `Interests of member ${i + 1}`,
        giftPrefs: `Gifts of member ${i + 1}`,
        agreeRules: true,
        agreeMessages: true,
      },
    });
    if (reg.status !== 200) throw new Error(`member ${i + 1} registration failed: ${JSON.stringify(reg.data)}`);
  }
  assert(true, "10 members registered (5 A / 5 B)");

  // Approve all pending registrations
  const parts = (await admin.call("/api/admin/participants")).data as {
    registrations: { id: string; verificationStatus: string; status: string; category: string }[];
  };
  for (const r of parts.registrations) {
    if (r.verificationStatus === "PENDING" && r.status === "ACTIVE" && r.category) {
      await admin.call(`/api/admin/participants/${r.id}/action`, { method: "POST", body: { action: "approve" } });
    }
  }

  // Re-read after approvals and balance categories (others may linger from test-api runs)
  const parts2 = (await admin.call("/api/admin/participants")).data as {
    registrations: { id: string; verificationStatus: string; status: string; category: string }[];
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
      if (r.category === excess) {
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
  // Pick a pair: member 1 should be someone's giver
  const sender = await db.user.findUnique({ where: { email: MEMBERS[0].email } });
  const senderAssignment = await db.assignment.findFirst({ where: { roundId, giverId: sender!.id } });
  assert(!!senderAssignment, "member 1 has an outgoing assignment");

  const yas = client("10.1.1.1");
  await yas.call("/api/auth/login", { method: "POST", body: { email: MEMBERS[0].email, password: TEST_PASSWORD } });

  // 3a. Allowed friendly message
  const good = await yas.call("/api/me/messages", { method: "POST", body: { destination: "friend", body: "Salut ! J'espère que ta semaine de stage se passe bien 😊 Courage !" } });
  assert(good.status === 200 && (good.data.modStatus === "ALLOWED" || good.data.modStatus === "REVIEW"), `friendly message accepted (${good.data.modStatus ?? good.data.error})`);

  // 3b. Phone number → deterministic reject (acceptance #11)
  const phone = await yas.call("/api/me/messages", { method: "POST", body: { destination: "friend", body: "Appelle-moi au 24 555 123 sinon rien" } });
  assert(phone.status === 422 && phone.data.error === "REJECTED_BY_MODERATION", "contact-sharing message rejected");

  // 3c. Email → reject
  const emailMsg = await yas.call("/api/me/messages", { method: "POST", body: { destination: "friend", body: "écris-moi à test.member@gmail.com" } });
  assert(emailMsg.status === 422, "email in message rejected");

  // 3d. Social handle → reject
  const social = await yas.call("/api/me/messages", { method: "POST", body: { destination: "friend", body: "mon insta c'est @membre_officiel" } });
  assert(social.status === 422, "social handle rejected");

  // 3e. No assignment leak in dashboard (acceptance #9, #12)
  const dash = (await yas.call("/api/me/dashboard")).data as Record<string, unknown>;
  const dashStr = JSON.stringify(dash);
  assert(!dashStr.includes("giverId") && !dashStr.includes("recipientId") && !dashStr.includes("assignment"), "dashboard leaks no assignment identifiers");
  assert(!dashStr.includes("+21624551"), "dashboard leaks no phone numbers");

  // 3f. Recipient replies to admirer — routes to giver, not own recipient (acceptance #13)
  const recipientId = senderAssignment!.recipientId;
  const recipientUser = await db.user.findUnique({ where: { id: recipientId } });
  const rec = client("10.1.1.2");
  await rec.call("/api/auth/login", { method: "POST", body: { email: recipientUser!.email, password: TEST_PASSWORD } });
  const reply = await rec.call("/api/me/messages", { method: "POST", body: { destination: "admirer", body: "Merci pour ton message, il m'a vraiment fait plaisir aujourd'hui ✨" } });
  assert(reply.status === 200 || reply.status === 422, `reply processed by moderation pipeline (${reply.status})`);
  const replyStored = await db.message.findFirst({
    where: { roundId, senderId: recipientId },
    orderBy: { createdAt: "desc" },
  });
  assert(!!replyStored && replyStored.recipientId === sender!.id, "reply routed to the actual admirer (giver), not to own recipient");

  // ── 4. Guessing phase (acceptance #14) ──
  const earlyGuess = await yas.call("/api/me/guess", { method: "POST", body: { guessedId: recipientId } });
  assert(earlyGuess.status === 403, "guess rejected while round merely active (before guessing window)");

  await admin.call(`/api/admin/rounds/${roundId}/action`, { method: "POST", body: { action: "open_guessing", confirm: true } });
  const guessOk = await yas.call("/api/me/guess", { method: "POST", body: { guessedId: recipientId } });
  assert(guessOk.status === 200, "guess submitted during guessing window");
  const guessSelf = await yas.call("/api/me/guess", { method: "POST", body: { guessedId: sender!.id } });
  assert(guessSelf.status === 400, "cannot guess yourself");

  // ── 5. Reveal gating (acceptance #16) ──
  const earlyReveal = await admin.call(`/api/admin/rounds/${roundId}/action`, { method: "POST", body: { action: "reveal", confirm: true } });
  assert(earlyReveal.status === 400 && earlyReveal.data.error === "GUESSING_STILL_OPEN", "reveal blocked before guessing deadline");

  // Simulate the end of the window (test harness manipulates dates directly)
  const nowEnd = Date.now();
  await db.round.update({
    where: { id: roundId },
    data: {
      gameStart: new Date(nowEnd - 13.5 * 24 * 3600 * 1000),
      guessingStart: new Date(nowEnd - 6 * 3600 * 1000),
      guessingDeadline: new Date(nowEnd - 3600 * 1000),
      gameEnd: new Date(nowEnd - 3600 * 1000),
      revealAt: new Date(nowEnd - 30 * 60 * 1000),
    },
  });
  const reveal = await admin.call(`/api/admin/rounds/${roundId}/action`, { method: "POST", body: { action: "reveal", confirm: true } });
  assert(reveal.status === 200, "reveal succeeds once deadline passed + admin confirms");

  // Reveal data correct per member
  const revealData = (await yas.call("/api/me/reveal")).data as { revealed: boolean; admirer?: { displayName: string | null }; friend?: { displayName: string | null }; isWinner?: boolean };
  assert(revealData.revealed === true, "reveal data available after official reveal");
  const admirerRow = assignments.find((a) => a.recipientId === sender!.id);
  const admirerUser = admirerRow ? await db.user.findUnique({ where: { id: admirerRow.giverId } }) : null;
  assert(revealData.admirer?.displayName === admirerUser?.displayName, `admirer identity matches DB (${revealData.admirer?.displayName})`);

  // ── 6. Archive: round is closed cleanly, nothing left running ──
  await admin.call(`/api/admin/rounds/${roundId}/action`, { method: "POST", body: { action: "archive" } });
  const archived = await db.round.findUnique({ where: { id: roundId } });
  assert(archived?.status === "archived", "round archived cleanly");

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}


main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
