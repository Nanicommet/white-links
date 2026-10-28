/**
 * WHITE LINKS — E2E for the 2026-10-29 review fixes (live server + DB)
 * Run: bun scripts/e2e-review-fixes.ts
 *
 * Covers the code-review findings:
 *  1. Advance registration creates a round users can actually join (#1)
 *  2. Reveal is blocked while guessing is open / before deadline (#3)
 *  3. force_reveal requires confirm + a written reason (#3)
 *  4. open_guessing requires explicit confirmation (#4)
 *  5. Inbox GET never writes; POST marks read (#13/#19)
 *  6. normalizePhone handles pasted/doubled prefixes (#20)
 */
import { db } from "../src/lib/db";
import { normalizePhone } from "../src/lib/phone";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const RUN = Date.now();
const TEST_PASSWORD = "E2eTest2026!";
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

type CallInit = { method?: string; body?: unknown; headers?: Record<string, string> };

function client(ip = "10.2.0.1") {
  let cookie = "";
  return {
    async call(path: string, init: CallInit = {}) {
      const res = await fetch(`${BASE}${path}`, {
        ...init,
        body: init.body ? JSON.stringify(init.body) : undefined,
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": ip,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(init.headers ?? {}),
        },
      });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      let data: unknown = null;
      try { data = await res.json(); } catch { /* no body */ }
      return { status: res.status, data } as { status: number; data: never };
    },
  };
}

async function main() {
  console.log("── 0. normalizePhone unit checks (#20) ──");
  assert(normalizePhone("24555123") === "+21624555123", "plain 8-digit local");
  assert(normalizePhone("24 555 123") === "+21624555123", "spaced local");
  assert(normalizePhone("024555123") === "+21624555123", "leading zero local");
  assert(normalizePhone("+216 24 555 123") === "+21624555123", "pasted +216 prefix");
  assert(normalizePhone("+216216245551 23") === "+21624555123", "doubled +216 prefix");
  assert(normalizePhone("0021624555123") === "+21624555123", "00-prefixed international");
  assert(normalizePhone("21624555123") === "+21624555123", "bare 216 prefix");
  assert(normalizePhone("abc") === null, "garbage rejected");

  // ── Admin session ──
  const admin = client("10.2.9.9");
  const login = await admin.call("/api/auth/login", {
    method: "POST",
    body: { email: "admin@whitelineissig.me", password: process.env.ADMIN_PASSWORD ?? "" },
  });
  assert(login.status === 200, "admin authenticated");
  if (login.status !== 200) return process.exit(1);

  // ── 1. Advance registration: opens the next round for real (#1) ──
  console.log("── 1. Advance registration (#1) ──");
  const current = await db.round.create({
    data: {
      name: `E2E-ADV-${RUN}`,
      status: "active",
      registrationStart: new Date(Date.now() - 7 * 24 * 3600 * 1000),
      registrationEnd: new Date(Date.now() - 5 * 24 * 3600 * 1000),
      gameStart: new Date(Date.now() - 5 * 24 * 3600 * 1000),
      gameEnd: new Date(Date.now() + 6 * 3600 * 1000), // ends within 48h → next opens NOW
      matchingMode: "OPEN",
    },
  });
  const adv = await admin.call(`/api/admin/rounds/${current.id}/action`, {
    method: "POST",
    body: { action: "advance_registration" },
  });
  assert(adv.status === 200, "advance_registration accepted");
  const nextId = (adv.data as { roundId?: string }).roundId;
  const next = nextId ? await db.round.findUnique({ where: { id: nextId } }) : null;
  assert(!!next, "next round created");
  assert(next?.status === "registration_open", `next round is registration_open (got ${next?.status})`);

  // A user can actually register into it
  const member = client("10.2.1.1");
  const reg = await member.call("/api/registrations", {
    method: "POST",
    body: {
      displayName: `E2E Adv Tester ${RUN}`,
      phone: `24${String(RUN).slice(-6)}`,
      email: `adv-${RUN}@e2e.test`,
      password: TEST_PASSWORD,
      category: "A",
      agreeRules: true,
      agreeMessages: true,
    },
  });
  assert(reg.status === 200, "user can register into the advance round");

  // ── 2/3/4. Reveal & guessing guards (#3/#4) ──
  console.log("── 2. Reveal / guessing guards (#3/#4) ──");
  // 2a. reveal on an "active" round is now refused (was previously allowed)
  const earlyReveal = await admin.call(`/api/admin/rounds/${current.id}/action`, {
    method: "POST",
    body: { action: "reveal", confirm: true },
  });
  assert(earlyReveal.status === 400, "reveal refused while round is merely active");

  // 2b. force_reveal without confirm → 400; without reason → 400
  const forceNoConfirm = await admin.call(`/api/admin/rounds/${current.id}/action`, {
    method: "POST",
    body: { action: "force_reveal", reason: "club emergency test" },
  });
  assert(forceNoConfirm.status === 400, "force_reveal requires confirm");
  const forceNoReason = await admin.call(`/api/admin/rounds/${current.id}/action`, {
    method: "POST",
    body: { action: "force_reveal", confirm: true, reason: "" },
  });
  assert(forceNoReason.status === 400, "force_reveal requires a reason");

  // 2c. open_guessing without confirm → 400
  const ogNoConfirm = await admin.call(`/api/admin/rounds/${current.id}/action`, {
    method: "POST",
    body: { action: "open_guessing" },
  });
  assert(ogNoConfirm.status === 400, "open_guessing requires confirmation");

  // 2d. proper flow: open guessing → reveal BEFORE deadline refused
  const og = await admin.call(`/api/admin/rounds/${current.id}/action`, {
    method: "POST",
    body: { action: "open_guessing", confirm: true },
  });
  assert(og.status === 200, "open_guessing with confirm succeeds");
  const preDeadline = await admin.call(`/api/admin/rounds/${current.id}/action`, {
    method: "POST",
    body: { action: "reveal", confirm: true },
  });
  assert(preDeadline.status === 400 && (preDeadline.data as { error?: string }).error === "GUESSING_STILL_OPEN",
    "reveal blocked while guessing deadline is in the future");

  // 2e. force_reveal with confirm + reason succeeds and is audited
  const forced = await admin.call(`/api/admin/rounds/${current.id}/action`, {
    method: "POST",
    body: { action: "force_reveal", confirm: true, reason: "E2E: round cut short for test" },
  });
  assert(forced.status === 200, "force_reveal with reason succeeds");
  const forcedAudit = await db.auditLog.findFirst({
    where: { target: current.id, action: "REVEAL_FORCED" },
    orderBy: { createdAt: "desc" },
  });
  assert(!!forcedAudit && forcedAudit.action === "REVEAL_FORCED", "force reveal written to audit log");

  // ── 3. Inbox: GET never writes, POST marks read (#13/#19) ──
  console.log("── 3. Inbox read semantics (#13/#19) ──");
  // Simulate a live round: the inbox only surfaces rounds in
  // active/guessing_open/revealed/archived.
  await db.round.update({ where: { id: next!.id }, data: { status: "active" } });
  // Round is revealed → use the advance round instead: put the member and a
  // partner into the next round with an assignment between them.
  const partner = await db.user.create({
    data: {
      email: `adv-partner-${RUN}@e2e.test`,
      passwordHash: "x",
      displayName: `E2E Partner ${RUN}`,
      phone: `99${String(RUN).slice(-6)}`,
      role: "MEMBER",
      phoneVerified: true,
    },
  });
  const partnerReg = await db.registration.create({
    data: {
      roundId: next!.id,
      userId: partner.id,
      phone: partner.phone,
      category: "B",
      verificationStatus: "APPROVED",
      status: "ACTIVE",
      consentRulesAt: new Date(),
    },
  });
  void partnerReg;
  const memberUser = await db.user.findUnique({ where: { email: `adv-${RUN}@e2e.test` } });
  assert(!!memberUser, "member account exists");
  await db.registration.update({
    where: { roundId_userId: { roundId: next!.id, userId: memberUser!.id } },
    data: { verificationStatus: "APPROVED" },
  });
  await db.assignment.create({
    data: { roundId: next!.id, giverId: partner.id, recipientId: memberUser!.id },
  });
  const unreadMsg = await db.message.create({
    data: {
      roundId: next!.id,
      senderId: partner.id,
      recipientId: memberUser!.id,
      body: "E2E unread marker message",
      source: "WEB",
      modStatus: "ALLOWED",
      deliveryStatus: "SENT",
    },
  });

  await member.call("/api/auth/login", {
    method: "POST",
    body: { email: `adv-${RUN}@e2e.test`, password: TEST_PASSWORD },
  });

  // GET #1 must NOT clear readAt
  await member.call("/api/me/inbox");
  let afterGet = await db.message.findUnique({ where: { id: unreadMsg.id } });
  assert(afterGet?.readAt === null, "inbox GET does not mark messages as read");

  // POST must clear readAt
  const marked = await member.call("/api/me/inbox", { method: "POST" });
  assert(marked.status === 200 && (marked.data as { updated?: number }).updated! >= 1, "inbox POST marks messages read");
  afterGet = await db.message.findUnique({ where: { id: unreadMsg.id } });
  assert(afterGet?.readAt !== null, "readAt set after POST");

  // sendBlockReason present once the round is revealed (sending blocked)
  const forcedNext = await admin.call(`/api/admin/rounds/${next!.id}/action`, {
    method: "POST",
    body: { action: "force_reveal", confirm: true, reason: "E2E: close round to verify block reason" },
  });
  assert(forcedNext.status === 200, "round closed for block-reason check");
  const inbox = (await member.call("/api/me/inbox")).data as {
    canSend?: boolean;
    sendBlockReason?: string | null;
    threads?: unknown;
  };
  assert(inbox.threads !== null, "inbox threads exist");
  assert(inbox.canSend === false && inbox.sendBlockReason === "REVEALED",
    `explicit sendBlockReason (got ${inbox.sendBlockReason})`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
