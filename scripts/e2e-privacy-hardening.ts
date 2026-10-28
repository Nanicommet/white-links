/**
 * WHITE LINKS — Targeted E2E for the privacy-hardening fixes:
 *  1. Rejected messages NEVER reach the recipient's inbox (moderation bypass fix)
 *  2. Sender still sees their own rejected message + explanation
 *  3. Admin password reset instantly invalidates the member's old session
 *  4. Member can log in again with the temp password
 * Run: bun scripts/e2e-privacy-hardening.ts   (server must be running)
 */
import { db } from "../src/lib/db";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const RUN = Date.now();
let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ FAIL: ${name}`); }
}

function client(ip = "10.2.0.1") {
  let cookie = "";
  return {
    async call(path: string, opts?: { method?: string; body?: unknown }) {
      const res = await fetch(`${BASE}${path}`, {
        method: opts?.method ?? "GET",
        headers: {
          "x-forwarded-for": ip,
          ...(opts?.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { cookie } : {}),
        },
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      let data: Record<string, unknown> = {};
      try { data = await res.json(); } catch { /* ignore */ }
      return { status: res.status, data };
    },
  };
}

async function main() {
  // ── Admin ──
  const admin = client("10.2.9.9");
  const login = await admin.call("/api/auth/login", {
    method: "POST",
    body: { email: "admin@whitelineissig.me", password: process.env.ADMIN_PASSWORD ?? "" },
  });
  assert(login.status === 200, "admin authenticated");

  // ── Round with 4 members (minimum) ──
  const round = await admin.call("/api/admin/rounds", {
    method: "POST",
    body: {
      name: `Privacy Hardening ${RUN}`,
      registrationStart: new Date(Date.now() - 3600_000).toISOString(),
      registrationEnd: new Date(Date.now() + 3600_000).toISOString(),
      matchingMode: "OPEN",
    },
  });
  const roundId = (round.data.round as { id: string }).id;
  await admin.call(`/api/admin/rounds/${roundId}/action`, { method: "POST", body: { action: "open_registration" } });

  const members = [
    { email: `h1-${RUN}@e2e.test`, name: "Hardening One" },
    { email: `h2-${RUN}@e2e.test`, name: "Hardening Two" },
    { email: `h3-${RUN}@e2e.test`, name: "Hardening Three" },
    { email: `h4-${RUN}@e2e.test`, name: "Hardening Four" },
  ];
  const memberClients: ReturnType<typeof client>[] = [];
  for (let i = 0; i < members.length; i++) {
    const c = client(`10.2.0.${i + 1}`);
    memberClients.push(c);
    const res = await c.call("/api/registrations", {
      method: "POST",
      body: {
        displayName: members[i].name,
        phone: `+21690010${String(100 + i)}`,
        email: members[i].email,
        password: "Hardening2026!",
        category: i % 2 === 0 ? "A" : "B",
        interests: "testing",
        giftPrefs: "",
        agreeRules: true,
        agreeMessages: true,
      },
    });
    assert(res.status === 200, `member ${i + 1} registered`);
  }

  const parts = (await admin.call(`/api/admin/participants?roundId=${roundId}`)).data as {
    registrations: { id: string; email: string }[];
  };
  for (const r of parts.registrations) {
    await admin.call(`/api/admin/participants/${r.id}/action`, { method: "POST", body: { action: "approve" } });
  }
  await admin.call(`/api/admin/rounds/${roundId}/action`, { method: "POST", body: { action: "close_registration" } });
  const fin = await admin.call(`/api/admin/rounds/${roundId}/action`, { method: "POST", body: { action: "finalize_matching", confirm: true } });
  assert(fin.status === 200, "matching finalized (4 assignments)");

  // Identify the actual pair: giver1 → recipient1 (from DB)
  const allAssignments = await db.assignment.findMany({ where: { roundId } });
  const pair = allAssignments[0];
  const idxOf = (userId: string) => {
    const reg = members.findIndex(async (m) => (await db.user.findUnique({ where: { email: m.email } }))?.id === userId);
    return reg;
  };
  // Resolve client per user id via email lookup
  const users = await Promise.all(members.map((m) => db.user.findUnique({ where: { email: m.email } })));
  const clientOf = (userId: string) => memberClients[users.findIndex((u) => u!.id === userId)];
  void idxOf;

  const giver = clientOf(pair.giverId);
  const recipient = clientOf(pair.recipientId);
  const giverUser = users.find((u) => u!.id === pair.giverId)!;
  assert(!!giver && !!recipient, "resolved matched pair clients");

  // ── FIX 2: rejected message must not reach the recipient ──
  const rejected = await giver.call("/api/me/messages", {
    method: "POST",
    body: { destination: "friend", body: `Contact me at mailme-${RUN}@example.com please` },
  });
  assert(rejected.status === 422, "contact-exchange message rejected by moderation (422)");

  const recipientInbox = (await recipient.call("/api/me/inbox")).data as {
    threads: { friend: { messages: { id: string }[] }; admirer: { messages: { id: string }[] } };
  };
  const recipientMsgCount = recipientInbox.threads.friend.messages.length + recipientInbox.threads.admirer.messages.length;
  assert(recipientMsgCount === 0, "recipient inbox contains ZERO rejected messages (bypass closed)");

  const giverInbox = (await giver.call("/api/me/inbox")).data as {
    threads: { friend: { messages: { id: string; mine: boolean; modStatus: string; modExplanation: string | null }[] } };
  };
  const own = giverInbox.threads.friend.messages.find((m) => m.mine);
  assert(!!own && own.modStatus === "REJECTED" && !!own.modExplanation, "sender still sees own REJECTED message with explanation");

  // ── allowed message DOES reach the recipient ──
  // NOTE: marker uses base36 (never 6+ consecutive digits) so the
  // deterministic phone-number filter does not reject the marker itself.
  const marker = RUN.toString(36);
  const allowed = await giver.call("/api/me/messages", {
    method: "POST",
    body: { destination: "friend", body: `Bonjour ! petit message de bienvenue ${marker}` },
  });
  assert(allowed.status === 200, "friendly message accepted");
  const recipientInbox2 = (await recipient.call("/api/me/inbox")).data as {
    threads: { friend: { messages: { body: string }[] }; admirer: { messages: unknown[] } };
  };
  const gotIt = (recipientInbox2.threads.friend.messages.some((m) => m.body.includes(marker))
    || recipientInbox2.threads.admirer.messages.length > 0);
  assert(gotIt, "allowed message reaches the recipient inbox");

  // ── FIX 3: admin password reset kills the old session immediately ──
  const meBefore = await giver.call("/api/auth/me");
  assert(meBefore.status === 200, "giver session valid before reset");
  const regRow = await db.registration.findFirst({ where: { roundId, userId: pair.giverId } });
  await admin.call(`/api/admin/participants/${regRow!.id}/action`, { method: "POST", body: { action: "reset_password" } });
  const meAfter = await giver.call("/api/auth/me");
  assert(meAfter.status === 401, "OLD session instantly invalid after password reset (401)");

  // ── FIX 4 continuation: temp password login works (pick temp from audit? we reset again to grab it) ──
  const re2 = await admin.call(`/api/admin/participants/${regRow!.id}/action`, { method: "POST", body: { action: "reset_password" } });
  const tempPwd = (re2.data as { tempPassword?: string }).tempPassword;
  const fresh = client("10.2.0.51");
  const relogin = await fresh.call("/api/auth/login", {
    method: "POST",
    body: { email: giverUser.email, password: tempPwd },
  });
  assert(relogin.status === 200, "member logs in with admin-issued temp password");
  const meFresh = await fresh.call("/api/auth/me");
  assert(meFresh.status === 200, "new session valid after re-login");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main()
  .catch((e) => { console.error(e); process.exit(1); });
